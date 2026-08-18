// refresh-data.mjs
//
// Receives a freshly-rebuilt CRM_DATA blob from the browser-side "Data Refresh" tool
// (see netlify_datarefresh.js, loaded by the app), swaps it into the live index.html
// between the /* CRM_DATA_START */ ... /* CRM_DATA_END */ sentinel markers, and commits
// the result to GitHub via the Contents API. Netlify's existing GitHub-connected
// auto-deploy then picks up the push and redeploys the site (typically ~1-2 minutes) —
// this function does NOT talk to Netlify at all, only to GitHub.
//
// This is a completely separate concern from data.mjs (which is a Netlify-Blobs-backed
// store for day-to-day editable app state — prices, deals, orders, contacts, etc.).
// CRM_DATA itself is baked into the page at deploy time, not stored in Blobs, so the only
// way to "update" it is to commit a new index.html and let a redeploy happen.
//
// Required environment variables (set in Netlify site settings -> Environment variables):
//   GITHUB_TOKEN       - a GitHub Personal Access Token with write access to the repo
//                         (fine-grained: Contents = Read and write, on this one repo).
//                         Never typed into chat/AI tools - set directly in Netlify.
//   GITHUB_REPO        - "owner/repo", e.g. "yourmatesbrewing/sales-hub"
//   GITHUB_BRANCH       - optional, defaults to "main"
//   GITHUB_FILE_PATH    - optional, defaults to "index.html"
//   UPLOAD_TOOL_SECRET  - a passphrase the Data Refresh tab must send. Anyone who has this
//                         value can push a new dataset to the live site, so treat it like a
//                         shared team password, not a public value.

const GITHUB_API = 'https://api.github.com';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Secret',
    },
  });
}

// Decompress a gzip-compressed, base64-encoded payload back into a UTF-8 string.
// The browser sends gzip+base64 (rather than raw JSON) so a ~5MB+ CRM_DATA blob stays
// comfortably under Netlify Functions' synchronous request-body limit (~6MB) even as the
// dataset grows over time - JSON like this typically compresses 5-10x.
async function gunzipBase64ToString(b64) {
  const zlib = await import('node:zlib');
  const buf = Buffer.from(b64, 'base64');
  const out = await new Promise((resolve, reject) => {
    zlib.gunzip(buf, (err, result) => (err ? reject(err) : resolve(result)));
  });
  return out.toString('utf8');
}

const REQUIRED_KEYS = ['meta', 'outlets', 'products', 'groups', 'groupOrder', 'groupSummary', 'outletSummary', 'dailyVolume', 'familyGroups', 'vipContactsSeed'];

function sanityCheckCrmData(obj) {
  if (!obj || typeof obj !== 'object') return 'payload is not a JSON object';
  for (const k of REQUIRED_KEYS) {
    if (!(k in obj)) return `payload is missing required key "${k}" - refusing to publish a dataset that looks truncated or malformed`;
  }
  if (!obj.meta || !obj.meta.salesDataFrom || !obj.meta.salesDataTo) return 'payload.meta is missing salesDataFrom/salesDataTo - refusing to publish';
  const outletCount = Object.keys(obj.outlets || {}).length;
  if (outletCount < 100) return `payload has only ${outletCount} outlets, which looks far too low for a real export - refusing to publish (safety threshold: 100)`;
  return null; // ok
}

async function githubRequest(path, token, options = {}) {
  const res = await fetch(GITHUB_API + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ymt-sales-hub-refresh-data-function',
      ...(options.headers || {}),
    },
  });
  let bodyJson = null;
  try { bodyJson = await res.json(); } catch (_err) { /* no body / not JSON */ }
  return { ok: res.ok, status: res.status, body: bodyJson };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { GITHUB_TOKEN, GITHUB_REPO, UPLOAD_TOOL_SECRET } = process.env;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
  const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'index.html';

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return json({ error: 'Server is not configured: GITHUB_TOKEN and GITHUB_REPO environment variables must be set in Netlify site settings before the Data Refresh tool can publish changes.' }, 500);
  }
  if (!UPLOAD_TOOL_SECRET) {
    return json({ error: 'Server is not configured: UPLOAD_TOOL_SECRET environment variable must be set in Netlify site settings before the Data Refresh tool can be used (this protects the tool from being triggered by anyone who finds the URL).' }, 500);
  }

  const providedSecret = req.headers.get('x-upload-secret') || '';
  if (providedSecret !== UPLOAD_TOOL_SECRET) {
    return json({ error: 'Invalid or missing upload passphrase.' }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { crmDataGzipBase64, updatedBy, stats } = body || {};
  if (!crmDataGzipBase64 || typeof crmDataGzipBase64 !== 'string') {
    return json({ error: 'Missing crmDataGzipBase64 in request body' }, 400);
  }

  // ---- Decompress + validate the new dataset before touching GitHub at all ----
  let crmDataText;
  try {
    crmDataText = await gunzipBase64ToString(crmDataGzipBase64);
  } catch (err) {
    return json({ error: 'Could not decompress crmDataGzipBase64: ' + err.message }, 400);
  }

  let crmDataObj;
  try {
    crmDataObj = JSON.parse(crmDataText);
  } catch (err) {
    return json({ error: 'Decompressed payload is not valid JSON: ' + err.message }, 400);
  }

  const sanityError = sanityCheckCrmData(crmDataObj);
  if (sanityError) return json({ error: sanityError }, 400);

  try {
    // ---- 1. Fetch the current deployed file from GitHub (need its sha + content) ----
    const getRes = await githubRequest(
      `/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_FILE_PATH)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      GITHUB_TOKEN
    );
    if (!getRes.ok) {
      return json({ error: `Could not read ${GITHUB_FILE_PATH} from GitHub (status ${getRes.status}): ${getRes.body && getRes.body.message ? getRes.body.message : 'unknown error'}` }, 502);
    }
    const { sha: currentSha, content: currentContentB64 } = getRes.body;
    const currentHtml = Buffer.from(currentContentB64, 'base64').toString('utf8');

    // ---- 2. Swap the CRM_DATA blob between the sentinel markers ----
    // Deliberately done via indexOf + string slicing/concatenation, NOT String.replace()
    // with a replacement string - this codebase has previously hit a real bug where
    // String.replace(pattern, replacementString) interprets literal '$'' sequences inside
    // the replacement string (which app JS legitimately contains, e.g. in money formatting)
    // as special patterns and corrupts the output. Slicing + concatenation has no such
    // special-character interpretation, so it's used here on purpose.
    const startMarker = '/* CRM_DATA_START */';
    const endMarker = '/* CRM_DATA_END */';
    const startIdx = currentHtml.indexOf(startMarker);
    const endIdx = currentHtml.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      return json({ error: `Could not find CRM_DATA_START/CRM_DATA_END markers in ${GITHUB_FILE_PATH} on branch ${GITHUB_BRANCH}. The file may be out of date - re-splice it with the current netlify_shell.html template before using this tool.` }, 500);
    }
    const before = currentHtml.slice(0, startIdx + startMarker.length);
    const after = currentHtml.slice(endIdx);
    const newHtml = before + '\nconst CRM_DATA = ' + crmDataText + ';\n' + after;

    // ---- 3. Commit the updated file back to GitHub ----
    const outletCount = Object.keys(crmDataObj.outlets || {}).length;
    const dateRange = crmDataObj.meta && crmDataObj.meta.salesDataFrom && crmDataObj.meta.salesDataTo
      ? `${crmDataObj.meta.salesDataFrom} to ${crmDataObj.meta.salesDataTo}`
      : 'unknown range';
    const commitMessage = `Data refresh via site upload tool: ${outletCount} outlets, sales ${dateRange}` + (updatedBy ? ` (by ${updatedBy})` : '');

    const putRes = await githubRequest(`/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_FILE_PATH)}`, GITHUB_TOKEN, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(newHtml, 'utf8').toString('base64'),
        sha: currentSha,
        branch: GITHUB_BRANCH,
      }),
    });

    if (!putRes.ok) {
      return json({ error: `Could not commit updated ${GITHUB_FILE_PATH} to GitHub (status ${putRes.status}): ${putRes.body && putRes.body.message ? putRes.body.message : 'unknown error'}` }, 502);
    }

    return json({
      ok: true,
      commitSha: putRes.body && putRes.body.commit ? putRes.body.commit.sha : null,
      commitUrl: putRes.body && putRes.body.commit ? putRes.body.commit.html_url : null,
      message: 'Committed to GitHub. Netlify will auto-deploy the update, typically within 1-2 minutes.',
      stats: stats || null,
    });
  } catch (err) {
    return json({ error: 'Unexpected error while publishing: ' + err.message }, 500);
  }
};
