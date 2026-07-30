/**
 * app.js — main application: state, routing, and all view rendering for
 * the Your Mates Brewing Beer Pricing Strategy tool.
 */
"use strict";

const App = (function () {
  const State = {
    skus: [],
    cogsHistory: [],
    bannerGroups: [],
    banners: [],
    bannerTermsHistory: [],
    pricingHistory: [],
    calendarDeals: [],
    distributorPricing: [],
    periods: [],
    currentPeriod: null,
    viewPeriod: null, // period being viewed/edited across the app (defaults to currentPeriod)
  };

  // ---------------------------------------------------------------- utils
  function fmt$(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const neg = n < 0;
    const s = Math.abs(n).toFixed(2);
    return (neg ? "-$" : "$") + s;
  }
  function fmtPct(n, dp) {
    if (n == null || Number.isNaN(n)) return "—";
    return (n * 100).toFixed(dp != null ? dp : 1) + "%";
  }
  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Small round product photo (falls back to a plain grey circle if the SKU
  // has no image on file or the hotlinked image fails to load — e.g. a SKU
  // no longer sold on yourmatesbrewing.com).
  function skuThumbHTML(sku, size) {
    const cls = size === "lg" ? "sku-thumb-lg" : size === "sm" ? "sku-thumb-sm" : "";
    if (sku && sku.image) {
      return `<img class="sku-thumb ${cls}" src="${esc(sku.image)}" alt="" onerror="this.outerHTML='<span class=&quot;sku-thumb-fallback ${cls}&quot; style=&quot;background:#8a9490&quot;>${esc((sku.name || "?").slice(0, 2).toUpperCase())}</span>'">`;
    }
    const initials = esc((sku && sku.name ? sku.name : "?").slice(0, 2).toUpperCase());
    return `<span class="sku-thumb-fallback ${cls}" style="background:#8a9490">${initials}</span>`;
  }
  // Colour-badge for a banner or banner-group — used everywhere a retailer
  // reference shows up instead of scraping/embedding third-party logos.
  function badgeHTML(entity, size) {
    const cls = size === "lg" ? "badge-circle-lg" : size === "sm" ? "badge-circle-sm" : "";
    const color = (entity && entity.badgeColor) || "#8a9490";
    const initials = esc((entity && entity.badgeInitials) || (entity && entity.name ? entity.name.slice(0, 2).toUpperCase() : "?"));
    return `<span class="badge-circle ${cls}" style="background:${esc(color)}">${initials}</span>`;
  }
  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function uid() {
    return "id" + Math.random().toString(36).slice(2, 10);
  }
  function periodIndex(periodId) {
    return State.periods.findIndex((p) => p.id === periodId);
  }
  function periodLabel(periodId) {
    const p = State.periods.find((p) => p.id === periodId);
    return p ? p.label : periodId;
  }
  function sortedPeriodIds() {
    return State.periods.map((p) => p.id);
  }
  function skuById(id) {
    return State.skus.find((s) => s.id === id);
  }
  function bannerById(id) {
    return State.banners.find((b) => b.id === id);
  }

  /** Most recent record from `rows` (each with a .period) at or before asOfPeriod. */
  function latestAsOf(rows, asOfPeriod) {
    const asOfIdx = asOfPeriod ? periodIndex(asOfPeriod) : Infinity;
    let best = null;
    let bestIdx = -1;
    rows.forEach((r) => {
      const idx = periodIndex(r.period);
      if (idx <= asOfIdx && idx > bestIdx) {
        best = r;
        bestIdx = idx;
      }
    });
    return best;
  }

  function latestCogs(skuId, asOfPeriod) {
    return latestAsOf(
      State.cogsHistory.filter((c) => c.skuId === skuId),
      asOfPeriod
    );
  }
  function cogsSeries(skuId) {
    return State.cogsHistory
      .filter((c) => c.skuId === skuId)
      .slice()
      .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  }
  function latestBannerTerms(bannerId, asOfPeriod) {
    return latestAsOf(
      State.bannerTermsHistory.filter((b) => b.bannerId === bannerId),
      asOfPeriod
    );
  }
  function latestPricing(skuId, bannerId, asOfPeriod) {
    return latestAsOf(
      State.pricingHistory.filter((p) => p.skuId === skuId && p.bannerId === bannerId),
      asOfPeriod
    );
  }
  function pricingSeries(skuId, bannerId) {
    return State.pricingHistory
      .filter((p) => p.skuId === skuId && p.bannerId === bannerId)
      .slice()
      .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  }
  // Every configured deal type gets its own target margin — not shared by
  // pack type / deal type combo — so two "carton / promo" deal types (say,
  // Promo 1 (Carton) and Promo 2 (Carton)) can have different targets.
  // Keyed by dealTypeId; legacy/custom deals with no matching deal type
  // (deal.dealTypeId not set, or removed since) simply have no target.
  function targetMarginForDealType(bannerTerms, dealTypeId) {
    if (!bannerTerms || !dealTypeId) return null;
    const m = (bannerTerms.targetMargins || []).find((t) => t.dealTypeId === dealTypeId);
    return m ? m.targetPct : null;
  }

  // Independent-banner list pricing can be shared across every banner routed
  // through the same distributor (set once per SKU/distributor on the SKU
  // Tool page, instead of re-entering the same figure on every banner card).
  // "Direct" (or no distributor set) keeps the old behaviour: list price is
  // just whatever's stored on that banner's own pricing row.
  const DISTRIBUTOR_CODES = ["ALM", "ILG", "Paramount", "EDG", "CLG"];
  // Every $ figure in this app (List Price, COGS, discount, scan deal, pick
  // fee, etc.) is entered ex GST, matching how Your Mates invoices — Shelf
  // RRP is the one exception, entered GST-inclusive since that's what's on
  // the shelf tag. GST_RATE converts Shelf RRP to ex GST before it's
  // compared against the (ex GST) banner cost price for Banner Margin.
  const GST_RATE = 0.1;
  function latestDistributorPrice(distributor, skuId, asOfPeriod) {
    return latestAsOf(
      State.distributorPricing.filter((p) => p.distributor === distributor && p.skuId === skuId),
      asOfPeriod
    );
  }
  function usesSharedDistributorPricing(banner) {
    return !!(banner && banner.groupId === "independent" && banner.distributor && DISTRIBUTOR_CODES.includes(banner.distributor));
  }
  /** What list price actually applies right now for this SKU/banner — from the shared distributor price if one's set, else the banner's own pricing row. */
  function effectiveListPrice(sku, banner, asOfPeriod, pricingRow) {
    if (usesSharedDistributorPricing(banner)) {
      const dp = latestDistributorPrice(banner.distributor, sku.id, asOfPeriod);
      if (dp) return dp.listPrice;
    }
    return pricingRow ? pricingRow.listPrice : 0;
  }
  /** Resolve packType/dealType/label for a deal, preferring the banner's configured deal type. */
  function dealMeta(banner, deal) {
    const dt = banner && banner.dealTypes ? banner.dealTypes.find((d) => d.id === deal.dealTypeId) : null;
    if (dt) return { packType: dt.packType, dealType: dt.dealType, label: dt.label, defaultPackQty: dt.defaultPackQty };
    // fallback inference for custom/legacy deals
    const label = deal.label || "";
    const packType = /carton/i.test(label) ? "carton" : /2 ?for ?\$/i.test(label) ? "2for$" : "multipack";
    const dealType = deal.dealType === "everyday" ? "everyday" : "promo";
    return { packType, dealType, label, defaultPackQty: deal.packQty || 1 };
  }

  /** Full computed metrics for a single deal line, using live COGS + banner terms. */
  function computeDeal(sku, banner, pricingRow, deal, asOfPeriod) {
    const cogs = latestCogs(sku.id, asOfPeriod);
    const terms = latestBannerTerms(banner.id, asOfPeriod);
    const meta = dealMeta(banner, deal);
    const targetPct = targetMarginForDealType(terms, deal.dealTypeId);
    const listPrice = effectiveListPrice(sku, banner, asOfPeriod, pricingRow);
    const result = Calc.evaluateDeal({
      listPrice,
      discountPerCarton: deal.discountPerCarton || 0,
      feeWaterfall: terms ? terms.feeWaterfall : [],
      distributorFeePct: terms ? terms.distributorFeePct : 0,
      scanDeal: deal.scanDeal || 0,
      shelfRRP: deal.shelfRRP,
      cogs: cogs ? { productCogs: cogs.productCogs } : { productCogs: 0 },
      bannerTerms: terms || {},
      targetMarginPct: targetPct,
      packQty: deal.packQty || meta.defaultPackQty || 1,
      gstRate: GST_RATE,
    });
    return Object.assign({ deal, meta, cogsFound: !!cogs, termsFound: !!terms }, result);
  }

  // -------------------------------------------------------------- routing
  const routes = {};
  function route(path, renderFn) {
    routes[path] = renderFn;
  }
  function navigate(hash) {
    window.location.hash = hash;
  }
  async function onHashChange() {
    const hash = window.location.hash.replace(/^#\/?/, "") || "dashboard";
    const [base, ...rest] = hash.split("/");
    const fn = routes[base] || routes["dashboard"];
    document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === base));
    const main = document.getElementById("main");
    main.innerHTML = '<div class="loading">Loading…</div>';
    try {
      await fn(rest, main);
    } catch (err) {
      console.error(err);
      main.innerHTML = `<div class="card"><h2>Something went wrong</h2><pre class="err">${esc(err.stack || err.message)}</pre></div>`;
    }
  }

  function periodSelectorHTML(selected) {
    let opts = State.periods.map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${esc(p.label)}${p.id === State.currentPeriod ? " (current)" : ""}</option>`).join("");
    return `<select id="period-select" class="select">${opts}</select>`;
  }
  function attachPeriodSelector(main) {
    const sel = document.getElementById("period-select");
    if (sel)
      sel.addEventListener("change", (e) => {
        State.viewPeriod = e.target.value;
        onHashChange();
      });
  }

  // ------------------------------------------------------------- Dashboard
  route("dashboard", async (rest, main) => {
    const period = State.viewPeriod;
    let totalDeals = 0,
      metDeals = 0,
      missingTargets = 0,
      gpSum = 0,
      gpCount = 0;
    const alerts = [];

    State.banners.forEach((banner) => {
      State.skus.forEach((sku) => {
        const pr = latestPricing(sku.id, banner.id, period);
        if (!pr) return;
        pr.deals.forEach((deal) => {
          const m = computeDeal(sku, banner, pr, deal, period);
          totalDeals++;
          if (m.gpPct != null) {
            gpSum += m.gpPct;
            gpCount++;
          }
          if (m.meetsTarget === true) metDeals++;
          else if (m.meetsTarget === false) {
            alerts.push({ sku, banner, deal, m });
          } else if (m.targetMarginPct == null) {
            missingTargets++;
          }
        });
      });
    });

    const avgGp = gpCount ? gpSum / gpCount : null;
    const groupCards = State.bannerGroups
      .map((g) => {
        const banners = State.banners.filter((b) => b.groupId === g.id);
        return `<a class="card card-link" href="#/banner/${g.id}">
        <h3>${badgeHTML(g)} ${esc(g.shortName)}</h3>
        <p class="muted">${banners.length} banner${banners.length !== 1 ? "s" : ""}</p>
      </a>`;
      })
      .join("");

    alerts.sort((a, b) => (a.m.gapToTargetDollar || 0) - (b.m.gapToTargetDollar || 0));
    const topAlerts = alerts.slice(0, 8);

    main.innerHTML = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <div class="period-control">Viewing: ${periodSelectorHTML(period)}</div>
      </div>
      <div class="stat-grid">
        <div class="card stat"><div class="stat-value">${State.skus.length}</div><div class="stat-label">SKUs</div></div>
        <div class="card stat"><div class="stat-value">${State.banners.length}</div><div class="stat-label">Banners</div></div>
        <div class="card stat"><div class="stat-value">${totalDeals}</div><div class="stat-label">Priced deals (${esc(periodLabel(period))})</div></div>
        <div class="card stat"><div class="stat-value">${fmtPct(avgGp)}</div><div class="stat-label">Avg YM GP%</div></div>
        <div class="card stat ${metDeals < totalDeals - missingTargets ? "stat-warn" : ""}"><div class="stat-value">${metDeals}/${totalDeals - missingTargets}</div><div class="stat-label">Deals meeting banner target</div></div>
      </div>
      <h2>Banner groups</h2>
      <div class="card-grid">${groupCards}</div>
      <h2>Deals not meeting banner margin target</h2>
      ${
        topAlerts.length === 0
          ? `<p class="muted">No shortfalls found for ${esc(periodLabel(period))} 🎉</p>`
          : `<table class="table">
        <thead><tr><th>SKU</th><th>Banner</th><th>Deal</th><th>Shelf RRP (inc GST)</th><th>Banner Margin</th><th>Target</th><th>Scan deal needed</th></tr></thead>
        <tbody>${topAlerts
          .map(
            (a) => `<tr>
          <td>${skuThumbHTML(a.sku, "sm")}${esc(a.sku.name)}</td><td>${badgeHTML(a.banner, "sm")}${esc(a.banner.name)}</td><td>${esc(a.deal.label)}</td>
          <td>${fmt$(a.deal.shelfRRP)}</td>
          <td class="neg">${fmtPct(a.m.bannerMarginPct)}</td>
          <td>${fmtPct(a.m.targetMarginPct)}</td>
          <td class="neg">+${fmt$(a.m.gapToTargetDollar)} / unit</td>
        </tr>`
          )
          .join("")}</tbody>
      </table>`
      }
      <p class="muted small">${missingTargets} deal(s) have no target margin set for their banner yet — set these on the banner's Terms panel.</p>
    `;
    attachPeriodSelector(main);
  });

  // ------------------------------------------------------------ COGS Master
  route("cogs", async (rest, main) => {
    const period = State.viewPeriod;
    const rows = State.skus
      .map((sku) => {
        const series = cogsSeries(sku.id);
        const current = latestCogs(sku.id, period);
        return { sku, series, current };
      })
      .sort((a, b) => a.sku.name.localeCompare(b.sku.name) || a.sku.packFormat.localeCompare(b.sku.packFormat));

    main.innerHTML = `
      <div class="page-header">
        <h1>COGS Master <span class="badge">Source of truth</span></h1>
        <div class="period-control">Viewing: ${periodSelectorHTML(period)}</div>
      </div>
      <p class="muted">Product COGS is the single source of truth per SKU — banner pages pull this automatically and layer on banner-specific freight/distributor/other charges (as a % of COGS). Update every 6 months via the <a href="#/cpi-update">CPI Update</a> tool, or edit an individual SKU below.</p>
      <table class="table">
        <thead><tr><th>SKU</th><th>Pack Format</th><th>Channel</th>
          ${State.periods.map((p) => `<th>${esc(p.label)}</th>`).join("")}
          <th></th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
            <td>${skuThumbHTML(r.sku)}<strong>${esc(r.sku.name)}</strong><div class="muted small">${esc(r.sku.style)}</div></td>
            <td>${esc(r.sku.packFormat)}</td>
            <td>${esc(r.sku.channel)}</td>
            ${State.periods
              .map((p) => {
                const entry = r.series.find((c) => c.period === p.id);
                const isCurrentView = p.id === (r.current ? r.current.period : null);
                return `<td class="${isCurrentView ? "col-highlight" : ""}">${entry ? fmt$(entry.productCogs) : '<span class="muted">—</span>'}</td>`;
              })
              .join("")}
            <td><button class="btn-sm" data-add-cogs="${r.sku.id}">Edit</button></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div id="modal-root"></div>
    `;
    attachPeriodSelector(main);
    main.querySelectorAll("[data-add-cogs]").forEach((btn) => btn.addEventListener("click", () => openAddCogsModal(btn.dataset.addCogs)));
  });

  function openAddCogsModal(skuId) {
    const sku = skuById(skuId);
    const modalRoot = document.getElementById("modal-root");
    const nextPeriodDefault = State.currentPeriod;
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h3>Edit COGS — ${esc(sku.name)} (${esc(sku.packFormat)})</h3>
          <label>Period
            <select id="cogs-period">${State.periods.map((p) => `<option value="${p.id}" ${p.id === nextPeriodDefault ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
          </label>
          <label>Product COGS ($)
            <input type="number" step="0.01" id="cogs-value" value="${latestCogs(sku.id, null) ? latestCogs(sku.id, null).productCogs : ""}" />
          </label>
          <label>Source / note
            <input type="text" id="cogs-source" placeholder="e.g. Recipe cost review, excise increase" />
          </label>
          <div class="modal-actions">
            <button class="btn-secondary" id="cogs-cancel">Cancel</button>
            <button class="btn-primary" id="cogs-save">Save</button>
          </div>
        </div>
      </div>`;
    document.getElementById("cogs-cancel").onclick = () => (modalRoot.innerHTML = "");
    document.getElementById("cogs-save").onclick = async () => {
      const period = document.getElementById("cogs-period").value;
      const productCogs = parseFloat(document.getElementById("cogs-value").value);
      const source = document.getElementById("cogs-source").value || "Manual update";
      if (Number.isNaN(productCogs)) return;
      const existing = State.cogsHistory.find((c) => c.skuId === skuId && c.period === period);
      const record = existing ? Object.assign({}, existing, { productCogs, source }) : { skuId, period, productCogs, source };
      const id = await DB.put("cogsHistory", record);
      record.id = record.id || id;
      const idx = State.cogsHistory.findIndex((c) => c.skuId === skuId && c.period === period);
      if (idx >= 0) State.cogsHistory[idx] = record;
      else State.cogsHistory.push(record);
      modalRoot.innerHTML = "";
      onHashChange();
    };
  }

  // ------------------------------------------------------------ SKU Tool
  function slugify(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "");
  }
  function uniqueSkuId(name, packFormat) {
    const base = slugify(name + "-" + (packFormat || "")).slice(0, 40) || "sku";
    let id = base,
      n = 1;
    while (State.skus.some((s) => s.id === id)) {
      n++;
      id = base + "-" + n;
    }
    return id;
  }

  route("sku-tool", async (rest, main) => {
    const period = State.viewPeriod;
    const skusSorted = State.skus.slice().sort((a, b) => a.name.localeCompare(b.name) || (a.packFormat || "").localeCompare(b.packFormat || ""));
    const independentBanners = State.banners
      .filter((b) => b.groupId === "independent")
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    function skuRowHtml(sku) {
      return `<tr>
        <td>${skuThumbHTML(sku)}<strong>${esc(sku.name)}</strong><div class="muted small">${esc(sku.style || "")}</div></td>
        <td>${esc(sku.packFormat || "")}</td>
        <td>${sku.unitsPerCarton || 1}</td>
        <td>${esc(sku.channel || "")}</td>
        <td>${esc(sku.category || "")}</td>
        <td><button class="btn-xs" data-edit-sku="${sku.id}">Edit</button> <button class="btn-xs" data-remove-sku="${sku.id}">Remove</button></td>
      </tr>`;
    }
    function distPriceCellHtml(sku, distributor) {
      const dp = latestDistributorPrice(distributor, sku.id, period);
      return `<td>${dp ? fmt$(dp.listPrice) : '<span class="muted">Not set</span>'} <button class="btn-xs" data-edit-dist-price="${sku.id}" data-distributor="${distributor}">Edit</button></td>`;
    }

    main.innerHTML = `
      <div class="page-header">
        <h1>SKU Tool</h1>
        <div class="period-control">Viewing: ${periodSelectorHTML(period)}</div>
      </div>

      <div class="page-header"><h2>SKUs</h2><button class="btn-primary btn-sm" id="add-sku-btn">+ Add SKU</button></div>
      <p class="muted small">Add a new product/pack format here before it can be priced on any banner page, or remove one that's discontinued (removing a SKU also removes its COGS history, pricing, distributor prices and any promo calendar deals). Product COGS itself still lives on the <a href="#/cogs">COGS Master</a> page.</p>
      <div class="table-scroll"><table class="table">
        <thead><tr><th>SKU</th><th>Pack format</th><th>Units/carton</th><th>Channel</th><th>Category</th><th></th></tr></thead>
        <tbody>${skusSorted.map(skuRowHtml).join("")}</tbody>
      </table></div>

      <div class="page-header"><h2>Distributor list pricing — Independent Bottleshops</h2></div>
      <p class="muted small">Set a SKU's list price once per distributor here instead of re-entering it on every independent banner that routes through the same one. Any independent banner assigned to a distributor below automatically uses whatever's set here — that banner's own List Price field on its pricing card becomes read-only.</p>
      <div class="table-scroll"><table class="table table-compact">
        <thead><tr><th>SKU</th>${DISTRIBUTOR_CODES.map((d) => `<th>${d}</th>`).join("")}</tr></thead>
        <tbody>${skusSorted.map((sku) => `<tr><td>${skuThumbHTML(sku, "sm")}${esc(sku.name)} <span class="muted small">${esc(sku.packFormat || "")}</span></td>${DISTRIBUTOR_CODES.map((d) => distPriceCellHtml(sku, d)).join("")}</tr>`).join("")}</tbody>
      </table></div>

      <div class="page-header"><h2>Banner → distributor assignment</h2></div>
      <p class="muted small">Pick which distributor each independent banner routes through. "Direct" keeps that banner's own List Price field editable as normal, unaffected by the shared pricing above.</p>
      <table class="table table-compact">
        <thead><tr><th>Banner</th><th>Distributor</th></tr></thead>
        <tbody>${independentBanners
          .map(
            (b) => `<tr><td>${badgeHTML(b, "sm")}${esc(b.name)}</td><td>
          <select class="select banner-distributor-select" data-banner="${b.id}">
            <option value="Direct" ${!b.distributor || b.distributor === "Direct" ? "selected" : ""}>Direct (own pricing)</option>
            ${DISTRIBUTOR_CODES.map((d) => `<option value="${d}" ${b.distributor === d ? "selected" : ""}>${d}</option>`).join("")}
          </select>
        </td></tr>`
          )
          .join("")}</tbody>
      </table>

      <div id="modal-root"></div>
    `;
    attachPeriodSelector(main);
    main.querySelectorAll("[data-edit-sku]").forEach((btn) => btn.addEventListener("click", () => openEditSkuModal(skuById(btn.dataset.editSku))));
    main.querySelectorAll("[data-remove-sku]").forEach((btn) => btn.addEventListener("click", () => confirmRemoveSku(btn.dataset.removeSku)));
    document.getElementById("add-sku-btn").addEventListener("click", () => openEditSkuModal(null));
    main.querySelectorAll("[data-edit-dist-price]").forEach((btn) => btn.addEventListener("click", () => openEditDistPriceModal(skuById(btn.dataset.editDistPrice), btn.dataset.distributor)));
    main.querySelectorAll(".banner-distributor-select").forEach((sel) =>
      sel.addEventListener("change", async (e) => {
        const banner = bannerById(e.target.dataset.banner);
        banner.distributor = e.target.value;
        await DB.put("banners", banner);
        onHashChange();
      })
    );
  });

  function openEditSkuModal(sku) {
    const isNew = !sku;
    const s = sku ? Object.assign({}, sku) : { id: "", name: "", category: "Beer", style: "", packFormat: "", unitsPerCarton: 1, channel: "Off-Premise", image: "" };
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-backdrop"><div class="modal">
        <h3>${isNew ? "Add" : "Edit"} SKU</h3>
        <div class="sku-card-top" style="margin-bottom:6px;">${skuThumbHTML(s, "lg")}<span class="muted small">Product photo preview</span></div>
        <label>Product name<input type="text" id="sku-name" value="${esc(s.name)}"></label>
        <label>Product image URL<input type="text" id="sku-image" value="${esc(s.image || "")}" placeholder="https://yourmatesbrewing.com/cdn/shop/files/..."></label>
        <div class="grid-2">
          <div><label>Category<select id="sku-category" class="select">
            <option value="Beer" ${s.category === "Beer" ? "selected" : ""}>Beer</option>
            <option value="Cider" ${s.category === "Cider" ? "selected" : ""}>Cider</option>
            <option value="Other" ${s.category !== "Beer" && s.category !== "Cider" ? "selected" : ""}>Other</option>
          </select></label></div>
          <div><label>Style<input type="text" id="sku-style" value="${esc(s.style)}" placeholder="e.g. Pale Ale"></label></div>
        </div>
        <label>Pack format<input type="text" id="sku-packformat" value="${esc(s.packFormat)}" placeholder="e.g. Carton 16 x 375mL"></label>
        <div class="grid-2">
          <div><label>Units per carton<input type="number" step="1" id="sku-units" value="${s.unitsPerCarton || 1}"></label></div>
          <div><label>Channel<select id="sku-channel" class="select">
            <option value="Off-Premise" ${s.channel === "Off-Premise" ? "selected" : ""}>Off-Premise</option>
            <option value="On-Premise" ${s.channel === "On-Premise" ? "selected" : ""}>On-Premise</option>
          </select></label></div>
        </div>
        ${!isNew ? '<p class="muted small">The internal SKU id stays the same when editing, so existing COGS/pricing/calendar links aren\'t affected.</p>' : ""}
        <div class="modal-actions">
          <button class="btn-secondary" id="sku-cancel">Cancel</button>
          <button class="btn-primary" id="sku-save">${isNew ? "Add SKU" : "Save changes"}</button>
        </div>
      </div></div>`;
    document.getElementById("sku-cancel").onclick = () => (modalRoot.innerHTML = "");
    document.getElementById("sku-save").onclick = async () => {
      const name = document.getElementById("sku-name").value.trim();
      const packFormat = document.getElementById("sku-packformat").value.trim();
      if (!name) {
        alert("Product name is required.");
        return;
      }
      const record = {
        id: isNew ? uniqueSkuId(name, packFormat) : s.id,
        name,
        category: document.getElementById("sku-category").value,
        style: document.getElementById("sku-style").value.trim(),
        packFormat,
        unitsPerCarton: parseInt(document.getElementById("sku-units").value, 10) || 1,
        channel: document.getElementById("sku-channel").value,
        image: document.getElementById("sku-image").value.trim(),
      };
      await DB.put("skus", record);
      const idx = State.skus.findIndex((x) => x.id === record.id);
      if (idx >= 0) State.skus[idx] = record;
      else State.skus.push(record);
      modalRoot.innerHTML = "";
      onHashChange();
    };
  }

  async function confirmRemoveSku(skuId) {
    const sku = skuById(skuId);
    if (!sku) return;
    const cogsRows = State.cogsHistory.filter((c) => c.skuId === skuId);
    const pricingRows = State.pricingHistory.filter((p) => p.skuId === skuId);
    const calRows = State.calendarDeals.filter((d) => d.skuId === skuId);
    const distRows = State.distributorPricing.filter((d) => d.skuId === skuId);
    const parts = [];
    if (cogsRows.length) parts.push(`${cogsRows.length} COGS history entr${cogsRows.length === 1 ? "y" : "ies"}`);
    if (pricingRows.length) parts.push(`${pricingRows.length} pricing entr${pricingRows.length === 1 ? "y" : "ies"} across banners`);
    if (calRows.length) parts.push(`${calRows.length} promo calendar deal${calRows.length === 1 ? "" : "s"}`);
    if (distRows.length) parts.push(`${distRows.length} distributor price entr${distRows.length === 1 ? "y" : "ies"}`);
    const msg = parts.length ? `Remove "${sku.name}" (${sku.packFormat})? This will also permanently delete: ${parts.join(", ")}. This can't be undone.` : `Remove "${sku.name}" (${sku.packFormat})? This can't be undone.`;
    if (!confirm(msg)) return;
    await DB.remove("skus", skuId);
    await DB.removeMany(
      "cogsHistory",
      cogsRows.map((r) => r.id)
    );
    await DB.removeMany(
      "pricingHistory",
      pricingRows.map((r) => r.id)
    );
    await DB.removeMany(
      "calendarDeals",
      calRows.map((r) => r.id)
    );
    await DB.removeMany(
      "distributorPricing",
      distRows.map((r) => r.id)
    );
    State.skus = State.skus.filter((x) => x.id !== skuId);
    State.cogsHistory = State.cogsHistory.filter((c) => c.skuId !== skuId);
    State.pricingHistory = State.pricingHistory.filter((p) => p.skuId !== skuId);
    State.calendarDeals = State.calendarDeals.filter((d) => d.skuId !== skuId);
    State.distributorPricing = State.distributorPricing.filter((d) => d.skuId !== skuId);
    onHashChange();
  }

  function openEditDistPriceModal(sku, distributor) {
    const modalRoot = document.getElementById("modal-root");
    const current = latestDistributorPrice(distributor, sku.id, null);
    modalRoot.innerHTML = `
      <div class="modal-backdrop"><div class="modal">
        <h3>${esc(distributor)} list price — ${esc(sku.name)} (${esc(sku.packFormat)})</h3>
        <label>Period<select id="dp-period" class="select">${State.periods.map((p) => `<option value="${p.id}" ${p.id === (current ? current.period : State.currentPeriod) ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>
        <label>List price ($/carton)<input type="number" step="0.01" id="dp-value" value="${current ? current.listPrice : ""}"></label>
        <label>Source / note<input type="text" id="dp-source" placeholder="e.g. Distributor rate card update" value="${current ? esc(current.source || "") : ""}"></label>
        <p class="muted small">This applies to every independent banner currently assigned to ${esc(distributor)}.</p>
        <div class="modal-actions">
          <button class="btn-secondary" id="dp-cancel">Cancel</button>
          <button class="btn-primary" id="dp-save">Save</button>
        </div>
      </div></div>`;
    document.getElementById("dp-cancel").onclick = () => (modalRoot.innerHTML = "");
    document.getElementById("dp-save").onclick = async () => {
      const period = document.getElementById("dp-period").value;
      const listPrice = parseFloat(document.getElementById("dp-value").value);
      const source = document.getElementById("dp-source").value || "Manual update";
      if (Number.isNaN(listPrice)) {
        alert("Enter a list price.");
        return;
      }
      const existing = State.distributorPricing.find((p) => p.distributor === distributor && p.skuId === sku.id && p.period === period);
      const record = existing ? Object.assign({}, existing, { listPrice, source }) : { distributor, skuId: sku.id, period, listPrice, source };
      const id = await DB.put("distributorPricing", record);
      record.id = record.id || id;
      const idx = State.distributorPricing.findIndex((p) => p.distributor === distributor && p.skuId === sku.id && p.period === period);
      if (idx >= 0) State.distributorPricing[idx] = record;
      else State.distributorPricing.push(record);
      modalRoot.innerHTML = "";
      onHashChange();
    };
  }

  // ------------------------------------------------------------ Banner page
  route("banner", async (rest, main) => {
    const groupId = rest[0];
    const group = State.bannerGroups.find((g) => g.id === groupId);
    if (!group) {
      main.innerHTML = `<div class="card">Unknown banner group.</div>`;
      return;
    }
    const groupBanners = State.banners.filter((b) => b.groupId === groupId);
    const selectedBannerId = rest[1] || groupBanners[0].id;
    const banner = groupBanners.find((b) => b.id === selectedBannerId) || groupBanners[0];
    const period = State.viewPeriod;
    const terms = latestBannerTerms(banner.id, period);

    const bannerTabs = groupBanners.map((b) => `<a class="tab ${b.id === banner.id ? "active" : ""}" href="#/banner/${groupId}/${b.id}">${badgeHTML(b, "sm")}${esc(b.name)}</a>`).join("");

    const skuRows = State.skus.map((sku) => ({ sku, pricing: latestPricing(sku.id, banner.id, period) })).filter((r) => r.pricing);
    const skusWithoutPricing = State.skus.filter((s) => !skuRows.find((r) => r.sku.id === s.id));

    main.innerHTML = `
      <div class="page-header">
        <h1>${badgeHTML(group, "lg")}${esc(group.shortName)}</h1>
        <div class="period-control">Viewing: ${periodSelectorHTML(period)}</div>
      </div>
      <div class="tabs">${bannerTabs}</div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header-row"><h3>Banner terms <span class="muted small">(all % based)</span></h3><button class="btn-sm" id="edit-terms">Edit / new period</button></div>
          ${renderTermsSummary(terms)}
        </div>
        <div class="card">
          <div class="card-header-row"><h3>Target margins</h3><button class="btn-sm" id="manage-deal-types">Manage deal types</button></div>
          ${renderTargetMargins(terms, banner)}
        </div>
      </div>

      <div class="page-header">
        <h2>Pricing &amp; deals — ${esc(periodLabel(period))}</h2>
        <div>
          <label style="display:inline-block;width:auto;margin:0 8px 0 0;">Save changes to
            <select id="save-target-period" class="select">${State.periods.map((p) => `<option value="${p.id}" ${p.id === State.currentPeriod ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
          </label>
          <select id="add-sku-select" class="select">
            <option value="">+ Add SKU to this banner…</option>
            ${skusWithoutPricing.map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(s.packFormat)}</option>`).join("")}
          </select>
        </div>
      </div>
      <p class="muted small">Shelf RRP and Scan Deal are live — edit them to see the margin/GP impact instantly. Click "Save card" to record the change as a new version for the period selected above.</p>
      <div id="sku-cards">
        ${skuRows.map(({ sku, pricing }) => skuCardHTML(sku, banner, pricing, period)).join("") || '<p class="muted">No SKUs priced for this banner yet. Use the dropdown above to add one.</p>'}
      </div>
      <div id="modal-root"></div>
    `;

    attachPeriodSelector(main);
    document.getElementById("edit-terms").addEventListener("click", () => openEditTermsModal(banner));
    document.getElementById("manage-deal-types").addEventListener("click", () => openDealTypesModal(banner));
    document.getElementById("add-sku-select").addEventListener("change", (e) => {
      if (!e.target.value) return;
      addSkuCard(e.target.value, banner, period);
      e.target.value = "";
    });
    skuRows.forEach(({ sku, pricing }) => wireSkuCard(sku, banner, pricing, period));
  });

  // ---- Per-SKU vertical card: list price, distributor fee $ impact, deals table (live) ----
  function skuCardHTML(sku, banner, pricing, period) {
    const terms = latestBannerTerms(banner.id, period);
    const distPct = terms ? terms.distributorFeePct : 0;
    const shared = usesSharedDistributorPricing(banner);
    const effPrice = effectiveListPrice(sku, banner, period, pricing);
    const dp = shared ? latestDistributorPrice(banner.distributor, sku.id, period) : null;
    return `
      <div class="card sku-card" data-sku="${sku.id}">
        <div class="sku-card-banner-tag" style="border-left-color:${esc(banner.badgeColor || "#8a9490")};">${badgeHTML(banner, "sm")}<strong>${esc(banner.name)}</strong></div>
        <div class="card-header-row">
          <h3>${skuThumbHTML(sku)}${esc(sku.name)} <span class="muted small">${esc(sku.packFormat)}</span></h3>
          <button class="btn-sm btn-save-card" data-sku="${sku.id}">Save card</button>
        </div>
        <div class="sku-card-top">
          <label>List price ($/carton, ex GST)<input type="number" step="0.01" class="list-price-input" value="${effPrice}" ${shared ? "disabled" : ""}></label>
          <div class="impact-readout">Distributor fee (${fmtPct(distPct)}) deducted from YM Net on this SKU: <strong class="dist-fee-dollar"></strong></div>
        </div>
        ${
          shared
            ? `<p class="muted small">List price is set once for every <strong>${esc(banner.distributor)}</strong> banner on the <a href="#/sku-tool">SKU Tool</a> page${dp ? "" : " — no price has been set for this SKU yet, defaulting to $0"}.</p>`
            : ""
        }
        <p class="muted small deal-status-legend">
          <span class="deal-chip pos">✓ Meets target</span>
          <span class="deal-chip warn">⚠ Near target — push pricing</span> <span>within ${fmtPct(NEAR_TARGET_GAP)} of target</span>
          <span class="deal-chip neg">✗ Below target</span> <span>more than ${fmtPct(NEAR_TARGET_GAP)} short</span>
        </p>
        <div class="deal-list">
          ${pricing.deals.map((deal, i) => dealRowHTML(sku, banner, pricing, deal, i, period)).join("") || '<p class="muted small">No deals yet — use "+ Add deal…" below.</p>'}
        </div>
        <p class="muted small">YM Net = List Price − Distributor Fee (% of list) − Banner Terms (% of list) − Discount $/carton − Scan Deal $/unit. Distributor fee and banner terms are both calculated on the full list price and don't change per deal; the discount and scan deal are deal-specific and come off last. Both the discount and the scan deal also lower the banner's effective cost price — the bigger either one is, the better the Banner Margin gets — while a pick fee (set on the banner's Terms panel) works the other way, adding to their cost. Every $ figure here is ex GST except Shelf RRP, which is GST-inclusive (what's on the shelf tag) — Banner Margin converts it to ex GST first so GST itself isn't counted as margin.</p>
        <div class="add-deal-row">
          <select class="add-deal-type-select">
            <option value="">+ Add deal…</option>
            ${(banner.dealTypes || []).map((dt) => `<option value="${dt.id}">${esc(dt.label)}</option>`).join("")}
          </select>
        </div>
      </div>`;
  }

  // A deal within 1 percentage point of its target isn't failing outright —
  // it's close enough that a small price/discount/scan-deal push should get
  // it there, so it gets its own amber "near target" state instead of
  // reading the same as a deal that's genuinely well short.
  const NEAR_TARGET_GAP = 0.015; // 1.5 percentage points
  function dealStatusInfo(m) {
    if (m.targetMarginPct == null || m.bannerMarginPct == null) return { text: "No target set", cls: "muted" };
    if (m.meetsTarget) return { text: "✓ Meets target", cls: "pos" };
    const gap = m.targetMarginPct - m.bannerMarginPct; // positive = short of target
    if (gap <= NEAR_TARGET_GAP + 1e-9) return { text: "⚠ Near target — push pricing", cls: "warn" };
    return { text: "✗ Below target", cls: "neg" };
  }

  // Deal rows are flex-wrapping cards, not table columns — the status,
  // shelf price and target (the "is this deal okay?" glance-info) always
  // sit together on one line that wraps naturally on narrower screens,
  // instead of forcing a wide table that needs horizontal scrolling to see
  // whether a deal is meeting its target. The full $ breakdown (YM Net,
  // COGS, Profit, GP%) sits on a second, more muted line underneath.
  function dealRowHTML(sku, banner, pricing, deal, i, period) {
    const m = computeDeal(sku, banner, pricing, deal, period);
    const status = dealStatusInfo(m);
    return `<div class="deal-row" data-i="${i}">
      <div class="deal-row-main">
        <span class="deal-name">${esc(deal.label)}</span>
        <span class="deal-chip out-status ${status.cls}">${status.text}</span>
        <label class="deal-inline">Shelf RRP (inc GST)<input type="number" step="0.01" class="rrp-input" value="${deal.shelfRRP}"></label>
        <span class="deal-metric">Banner Margin <strong class="out-margin">${fmtPct(m.bannerMarginPct)}</strong></span>
        <span class="deal-metric">Target <strong class="out-target">${fmtPct(m.targetMarginPct)}</strong></span>
      </div>
      <div class="deal-row-detail">
        <label class="deal-inline">Discount $/ctn<input type="number" step="0.01" class="discount-input" value="${deal.discountPerCarton || 0}"></label>
        <label class="deal-inline">Scan $/unit<input type="number" step="0.01" class="scan-input" value="${deal.scanDeal || 0}"></label>
        <span>YM Net <strong class="out-net">${fmt$(m.ymNetDeal)}</strong></span>
        <span>YM COGS <strong class="out-cogs">${fmt$(m.cost.total)}</strong></span>
        <span>Profit <strong class="out-profit ${m.profit >= 0 ? "pos" : "neg"}">${fmt$(m.profit)}</strong></span>
        <span>YM GP% <strong class="out-gp">${fmtPct(m.gpPct)}</strong></span>
        ${m.targetMarginPct != null ? `<button class="btn-xs btn-fill-scan" title="Fill in the scan deal needed to hit target">Fill scan deal</button>` : ""}
        <button class="btn-xs remove-deal-row">✕</button>
      </div>
    </div>`;
  }

  function recalcCard(cardEl, sku, banner, period) {
    const listPrice = parseFloat(cardEl.querySelector(".list-price-input").value || 0);
    const terms = latestBannerTerms(banner.id, period);
    const distPct = terms ? terms.distributorFeePct : 0;
    cardEl.querySelector(".dist-fee-dollar").textContent = fmt$(listPrice * distPct);
    cardEl.querySelectorAll(".deal-row").forEach((row) => {
      const i = parseInt(row.dataset.i, 10);
      const deal = cardEl._deals[i];
      deal.shelfRRP = parseFloat(row.querySelector(".rrp-input").value || 0);
      deal.discountPerCarton = parseFloat(row.querySelector(".discount-input").value || 0);
      deal.scanDeal = parseFloat(row.querySelector(".scan-input").value || 0);
      const tempPricing = { listPrice, deals: cardEl._deals };
      const m = computeDeal(sku, banner, tempPricing, deal, period);
      row.querySelector(".out-net").textContent = fmt$(m.ymNetDeal);
      row.querySelector(".out-cogs").textContent = fmt$(m.cost.total);
      const profitCell = row.querySelector(".out-profit");
      profitCell.textContent = fmt$(m.profit);
      profitCell.className = "out-profit " + (m.profit >= 0 ? "pos" : "neg");
      row.querySelector(".out-gp").textContent = fmtPct(m.gpPct);
      row.querySelector(".out-margin").textContent = fmtPct(m.bannerMarginPct);
      row.querySelector(".out-target").textContent = fmtPct(m.targetMarginPct);
      const status = dealStatusInfo(m);
      const statusCell = row.querySelector(".out-status");
      statusCell.textContent = status.text;
      statusCell.className = "out-status " + status.cls;
      const fillBtn = row.querySelector(".btn-fill-scan");
      if (fillBtn) fillBtn.dataset.required = m.requiredScanDealForTarget != null ? m.requiredScanDealForTarget : "";
    });
  }

  function wireSkuCard(sku, banner, pricing, period) {
    const cardEl = document.querySelector(`.sku-card[data-sku="${sku.id}"]`);
    if (!cardEl) return;
    cardEl._deals = pricing.deals.map((d) => Object.assign({}, d));
    const recalc = () => recalcCard(cardEl, sku, banner, period);
    cardEl.querySelector(".list-price-input").addEventListener("input", recalc);
    cardEl.addEventListener("input", (e) => {
      if (e.target.classList.contains("rrp-input") || e.target.classList.contains("discount-input") || e.target.classList.contains("scan-input")) recalc();
    });
    cardEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-fill-scan")) {
        const row = e.target.closest(".deal-row");
        const required = e.target.dataset.required;
        if (required !== "" && required != null) {
          row.querySelector(".scan-input").value = required;
          recalc();
        }
      }
      if (e.target.classList.contains("remove-deal-row")) {
        const row = e.target.closest(".deal-row");
        const i = parseInt(row.dataset.i, 10);
        cardEl._deals.splice(i, 1);
        rerenderDealRows(cardEl, sku, banner, period);
      }
    });
    cardEl.querySelector(".add-deal-type-select").addEventListener("change", (e) => {
      const dtId = e.target.value;
      if (!dtId) return;
      const dt = (banner.dealTypes || []).find((d) => d.id === dtId);
      if (!dt) return;
      cardEl._deals.push({ dealTypeId: dt.id, label: dt.label, dealType: dt.dealType, shelfRRP: 0, discountPerCarton: 0, scanDeal: 0, packQty: dt.defaultPackQty });
      e.target.value = "";
      rerenderDealRows(cardEl, sku, banner, period);
    });
    cardEl.querySelector(".btn-save-card").addEventListener("click", async () => {
      const listPrice = parseFloat(cardEl.querySelector(".list-price-input").value || 0);
      const targetPeriod = document.getElementById("save-target-period").value;
      const record = { skuId: sku.id, bannerId: banner.id, period: targetPeriod, listPrice, deals: cardEl._deals.map((d) => Object.assign({}, d)), notes: "Edited via banner page" };
      const existing = State.pricingHistory.find((p) => p.skuId === sku.id && p.bannerId === banner.id && p.period === targetPeriod);
      if (existing) record.id = existing.id;
      const id = await DB.put("pricingHistory", record);
      record.id = record.id || id;
      const idx = State.pricingHistory.findIndex((p) => p.skuId === sku.id && p.bannerId === banner.id && p.period === targetPeriod);
      if (idx >= 0) State.pricingHistory[idx] = record;
      else State.pricingHistory.push(record);
      onHashChange();
    });
    recalc();
  }

  function rerenderDealRows(cardEl, sku, banner, period) {
    const tempPricing = { listPrice: parseFloat(cardEl.querySelector(".list-price-input").value || 0), deals: cardEl._deals };
    const list = cardEl.querySelector(".deal-list");
    list.innerHTML = cardEl._deals.map((deal, i) => dealRowHTML(sku, banner, tempPricing, deal, i, period)).join("") || '<p class="muted small">No deals yet — use "+ Add deal…" below.</p>';
    recalcCard(cardEl, sku, banner, period);
  }

  function addSkuCard(skuId, banner, period) {
    const sku = skuById(skuId);
    const container = document.getElementById("sku-cards");
    const placeholder = container.querySelector(".muted");
    if (placeholder) placeholder.remove();
    const pricing = { listPrice: 0, deals: [] };
    container.insertAdjacentHTML("beforeend", skuCardHTML(sku, banner, pricing, period));
    wireSkuCard(sku, banner, pricing, period);
  }

  function renderTermsSummary(terms) {
    if (!terms) return `<p class="muted">No terms recorded yet for this period.</p>`;
    const fees = terms.feeWaterfall.map((f) => `<li>${esc(f.label)}: ${fmtPct(f.value)} <span class="muted">(${f.basis.replace(/_/g, " ")}, ${f.kind})</span></li>`).join("");
    return `
      <ul class="kv-list">
        <li><span>Distributor</span><strong>${esc(terms.distributor || "—")}</strong></li>
        <li><span>Distributor fee %</span><strong>${fmtPct(terms.distributorFeePct)}</strong></li>
        <li><span>Freight (% of COGS)</span><strong>${fmtPct(terms.freightPct)}</strong></li>
        <li><span>Direct delivery (% of COGS)</span><strong>${fmtPct(terms.directDeliveryPct)}</strong></li>
        <li><span>Keg collection (% of COGS)</span><strong>${fmtPct(terms.kegCollectionPct)}</strong></li>
        <li><span>Pick fee ($/carton, banner pays distributor)</span><strong>${fmt$(terms.pickFeePerCarton || 0)}</strong></li>
      </ul>
      <p class="muted small">Fees / rebates (off invoice):</p>
      <ul class="kv-list">${fees || '<li class="muted">None recorded</li>'}</ul>
      ${terms.notes ? `<p class="muted small">${esc(terms.notes)}</p>` : ""}
    `;
  }

  function renderTargetMargins(terms, banner) {
    const dealTypes = (banner && banner.dealTypes) || [];
    if (dealTypes.length === 0) return `<p class="muted">No deal types configured yet — add one on <strong>Manage deal types</strong> first.</p>`;
    return `<table class="table table-compact">
      <thead><tr><th>Deal type</th><th>Pack</th><th>Deal</th><th>Target GP%</th></tr></thead>
      <tbody>${dealTypes
        .map((dt) => {
          const t = terms ? (terms.targetMargins || []).find((tm) => tm.dealTypeId === dt.id) : null;
          return `<tr><td>${esc(dt.label || "(untitled)")}</td><td>${esc(dt.packType)}</td><td>${esc(dt.dealType)}</td><td>${t && t.targetPct != null ? fmtPct(t.targetPct) : '<span class="muted">Not set</span>'}</td></tr>`;
        })
        .join("")}</tbody>
    </table>`;
  }

  function openEditTermsModal(banner) {
    const modalRoot = document.getElementById("modal-root");
    const current = latestBannerTerms(banner.id, null) || { feeWaterfall: [], targetMargins: [], distributorFeePct: 0, freightPct: 0, directDeliveryPct: 0, kegCollectionPct: 0, pickFeePerCarton: 0 };
    // sample list price / cogs for live $ impact preview
    const samplePricing = State.pricingHistory.find((p) => p.bannerId === banner.id);
    const sampleListPrice = samplePricing ? samplePricing.listPrice : 55;
    const sampleCogs = latestCogs(samplePricing ? samplePricing.skuId : (State.skus[0] || {}).id, null);
    const sampleCogsVal = sampleCogs ? sampleCogs.productCogs : 40;

    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal-wide">
          <h3>Edit terms — ${esc(banner.name)}</h3>
          <label>Save as period
            <select id="terms-period">${State.periods.map((p) => `<option value="${p.id}" ${p.id === State.currentPeriod ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
          </label>
          <div class="grid-3">
            <label>Distributor fee %<input type="number" step="0.01" id="terms-distfee" value="${((current.distributorFeePct || 0) * 100).toFixed(2)}"></label>
            <label>Freight % of COGS<input type="number" step="0.01" id="terms-freight" value="${((current.freightPct || 0) * 100).toFixed(2)}"></label>
            <label>Direct delivery % of COGS<input type="number" step="0.01" id="terms-ddc" value="${((current.directDeliveryPct || 0) * 100).toFixed(2)}"></label>
          </div>
          <label>Keg collection % of COGS<input type="number" step="0.01" id="terms-keg" value="${((current.kegCollectionPct || 0) * 100).toFixed(2)}"></label>
          <label>Pick fee $/carton <span class="muted small">(paid by the banner directly to a distributor, e.g. ALM — increases the banner's cost, lowers their margin, no effect on YM Net)</span><input type="number" step="0.01" id="terms-pickfee" value="${(current.pickFeePerCarton || 0).toFixed(2)}"></label>
          <p class="muted small" id="terms-impact-preview"></p>
          <h4>Fee / rebate waterfall (all %)</h4>
          <div id="fee-lines">${(current.feeWaterfall || []).map((f, i) => feeLineRowHTML(f, i)).join("")}</div>
          <button class="btn-sm" id="add-fee-line">+ Add fee/rebate line</button>
          <p class="muted small">Target margins are set on <strong>Manage deal types</strong> now, alongside the deal types they apply to.</p>
          <label>Notes<textarea id="terms-notes">${esc(current.notes || "")}</textarea></label>
          <div class="modal-actions">
            <button class="btn-secondary" id="terms-cancel">Cancel</button>
            <button class="btn-primary" id="terms-save">Save new version</button>
          </div>
        </div>
      </div>`;

    function updatePreview() {
      const distPct = parseFloat(document.getElementById("terms-distfee").value || 0) / 100;
      const freightPct = parseFloat(document.getElementById("terms-freight").value || 0) / 100;
      const pickFee = parseFloat(document.getElementById("terms-pickfee").value || 0);
      document.getElementById("terms-impact-preview").textContent = `Example impact on a $${sampleListPrice.toFixed(2)} list price / $${sampleCogsVal.toFixed(2)} COGS SKU: distributor fee = ${fmt$(sampleListPrice * distPct)} deducted from YM Net (always on the full list price), freight = ${fmt$(sampleCogsVal * freightPct)} added to YM COGS, pick fee = ${fmt$(pickFee)}/carton added to the banner's cost price (no effect on YM Net).`;
    }
    ["terms-distfee", "terms-freight", "terms-pickfee"].forEach((id) => document.getElementById(id).addEventListener("input", updatePreview));
    updatePreview();

    document.getElementById("terms-cancel").onclick = () => (modalRoot.innerHTML = "");
    document.getElementById("add-fee-line").onclick = () => {
      const container = document.getElementById("fee-lines");
      const i = container.children.length;
      container.appendChild(el(feeLineRowHTML({ label: "", basis: "pct_of_list", value: 0, kind: "rebate" }, i)));
    };
    document.getElementById("fee-lines").addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-fee-line")) {
        e.target.closest(".fee-line-row").remove();
      }
    });
    document.getElementById("terms-save").onclick = async () => {
      const period = document.getElementById("terms-period").value;
      const feeWaterfall = Array.from(document.querySelectorAll(".fee-line-row")).map((row) => ({
        label: row.querySelector(".fee-label").value,
        basis: row.querySelector(".fee-basis").value,
        value: parseFloat(row.querySelector(".fee-value").value || 0) / 100,
        kind: row.querySelector(".fee-kind").value,
      }));
      const record = {
        bannerId: banner.id,
        period,
        distributor: current.distributor || "",
        feeWaterfall,
        distributorFeePct: parseFloat(document.getElementById("terms-distfee").value || 0) / 100,
        freightPct: parseFloat(document.getElementById("terms-freight").value || 0) / 100,
        directDeliveryPct: parseFloat(document.getElementById("terms-ddc").value || 0) / 100,
        kegCollectionPct: parseFloat(document.getElementById("terms-keg").value || 0) / 100,
        pickFeePerCarton: parseFloat(document.getElementById("terms-pickfee").value || 0),
        targetMargins: current.targetMargins || [], // edited on the Manage deal types modal now — carried forward unchanged
        notes: document.getElementById("terms-notes").value,
      };
      const existing = State.bannerTermsHistory.find((t) => t.bannerId === banner.id && t.period === period);
      if (existing) record.id = existing.id;
      const id = await DB.put("bannerTermsHistory", record);
      record.id = record.id || id;
      const idx = State.bannerTermsHistory.findIndex((t) => t.bannerId === banner.id && t.period === period);
      if (idx >= 0) State.bannerTermsHistory[idx] = record;
      else State.bannerTermsHistory.push(record);
      modalRoot.innerHTML = "";
      onHashChange();
    };
  }

  function feeLineRowHTML(f, i) {
    return `<div class="fee-line-row" data-i="${i}">
      <input type="text" class="fee-label" placeholder="Label (e.g. Volume Rebate)" value="${esc(f.label)}">
      <select class="fee-basis">
        <option value="pct_of_list" ${f.basis === "pct_of_list" ? "selected" : ""}>% of list price</option>
        <option value="pct_of_running" ${f.basis === "pct_of_running" ? "selected" : ""}>% of running total</option>
      </select>
      <input type="number" step="0.01" class="fee-value" placeholder="value %" value="${(f.value * 100).toFixed(2)}">
      <select class="fee-kind">
        <option value="rebate" ${f.kind === "rebate" ? "selected" : ""}>rebate</option>
        <option value="fee" ${f.kind === "fee" ? "selected" : ""}>fee</option>
      </select>
      <button class="btn-xs remove-fee-line">✕</button>
    </div>`;
  }

  function openDealTypesModal(banner) {
    const modalRoot = document.getElementById("modal-root");
    const types = (banner.dealTypes || []).map((d) => Object.assign({}, d));
    const currentTerms = latestBannerTerms(banner.id, null) || { feeWaterfall: [], targetMargins: [], distributorFeePct: 0, freightPct: 0, directDeliveryPct: 0, kegCollectionPct: 0, pickFeePerCarton: 0 };
    function targetForType(t) {
      const m = (currentTerms.targetMargins || []).find((tm) => tm.dealTypeId === t.id);
      return m && m.targetPct != null ? (m.targetPct * 100).toFixed(1) : "";
    }
    function render() {
      modalRoot.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal modal-wide">
            <h3>Deal / promo types — ${esc(banner.name)}</h3>
            <p class="muted small">These are the deal types available when adding pricing for a SKU at this banner. Every deal type gets its own target margin — set it right alongside it, no two have to share one.</p>
            <label>Save as period
              <select id="dt-period">${State.periods.map((p) => `<option value="${p.id}" ${p.id === State.currentPeriod ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
            </label>
            <div class="deal-type-row deal-type-row-header muted small">
              <span>Label</span><span>Pack type</span><span>Deal type</span><span>Units/carton</span><span>Target %</span><span></span>
            </div>
            <div id="deal-type-lines">${types.map((t, i) => dealTypeRowHTML(t, i, targetForType(t))).join("")}</div>
            <button class="btn-sm" id="add-deal-type">+ Add deal type</button>
            <div class="modal-actions">
              <button class="btn-secondary" id="dt-cancel">Cancel</button>
              <button class="btn-primary" id="dt-save">Save</button>
            </div>
          </div>
        </div>`;
      document.getElementById("dt-cancel").onclick = () => (modalRoot.innerHTML = "");
      document.getElementById("add-deal-type").onclick = () => {
        types.push({ id: uid(), label: "", packType: "multipack", dealType: "promo", defaultPackQty: 4 });
        render();
      };
      document.querySelectorAll(".remove-deal-type").forEach((btn) =>
        btn.addEventListener("click", () => {
          types.splice(parseInt(btn.dataset.i, 10), 1);
          render();
        })
      );
      document.getElementById("dt-save").onclick = async () => {
        const rows = Array.from(document.querySelectorAll("#deal-type-lines .deal-type-row"));
        const newTypes = rows.map((row, i) => ({
          id: types[i].id,
          label: row.querySelector(".dt-label").value,
          packType: row.querySelector(".dt-pack").value,
          dealType: row.querySelector(".dt-deal").value,
          defaultPackQty: parseFloat(row.querySelector(".dt-qty").value || 1),
        }));
        banner.dealTypes = newTypes;
        await DB.put("banners", banner);
        const bannerIdx = State.banners.findIndex((b) => b.id === banner.id);
        if (bannerIdx >= 0) State.banners[bannerIdx] = banner;

        // Target margins live inside the banner's versioned Terms record —
        // save a new version carrying forward every other term field
        // unchanged (fees, distributor %, pick fee, etc.), only replacing
        // targetMargins + the period being saved to. Each deal type row's
        // own Target % input maps 1:1 to its deal type id.
        const period = document.getElementById("dt-period").value;
        const targetMargins = rows.map((row, i) => {
          const v = row.querySelector(".dt-target").value;
          return { dealTypeId: types[i].id, targetPct: v === "" ? null : parseFloat(v) / 100 };
        });
        const termsRecord = Object.assign({}, currentTerms, { bannerId: banner.id, period, targetMargins });
        delete termsRecord.id;
        const existingTerms = State.bannerTermsHistory.find((t) => t.bannerId === banner.id && t.period === period);
        if (existingTerms) termsRecord.id = existingTerms.id;
        const termsId = await DB.put("bannerTermsHistory", termsRecord);
        termsRecord.id = termsRecord.id || termsId;
        const termsIdx = State.bannerTermsHistory.findIndex((t) => t.bannerId === banner.id && t.period === period);
        if (termsIdx >= 0) State.bannerTermsHistory[termsIdx] = termsRecord;
        else State.bannerTermsHistory.push(termsRecord);

        modalRoot.innerHTML = "";
        onHashChange();
      };
    }
    render();
  }

  function dealTypeRowHTML(t, i, targetPctStr) {
    return `<div class="deal-type-row" data-i="${i}">
      <input type="text" class="dt-label" placeholder="Label (e.g. Promo 1 (Carton))" value="${esc(t.label)}">
      <select class="dt-pack">
        <option value="multipack" ${t.packType === "multipack" ? "selected" : ""}>multipack</option>
        <option value="carton" ${t.packType === "carton" ? "selected" : ""}>carton</option>
        <option value="2for$" ${t.packType === "2for$" ? "selected" : ""}>2for$</option>
      </select>
      <select class="dt-deal">
        <option value="everyday" ${t.dealType === "everyday" ? "selected" : ""}>everyday</option>
        <option value="promo" ${t.dealType === "promo" ? "selected" : ""}>promo</option>
      </select>
      <input type="number" step="1" class="dt-qty" placeholder="units/carton" value="${t.defaultPackQty}">
      <input type="number" step="0.1" class="dt-target" placeholder="target %" title="Target margin % for this deal type" value="${targetPctStr != null ? targetPctStr : ""}">
      <button class="btn-xs remove-deal-type" data-i="${i}">✕</button>
    </div>`;
  }

  // ------------------------------------------------------------ Compare
  route("compare", async (rest, main) => {
    const period = State.viewPeriod;
    const selectedSku = rest[0] || State.skus[0].id;
    const skuOptions = State.skus.map((s) => `<option value="${s.id}" ${s.id === selectedSku ? "selected" : ""}>${esc(s.name)} — ${esc(s.packFormat)}</option>`).join("");

    const rows = State.banners
      .map((banner) => {
        const sku = skuById(selectedSku);
        const pricing = latestPricing(selectedSku, banner.id, period);
        if (!pricing || pricing.deals.length === 0) return null;
        const everydayDeal = pricing.deals.find((d) => d.dealType === "everyday" && /carton/i.test(d.label)) || pricing.deals.find((d) => d.dealType === "everyday") || pricing.deals[0];
        const m = computeDeal(sku, banner, pricing, everydayDeal, period);
        return { banner, pricing, everydayDeal, m };
      })
      .filter(Boolean);

    main.innerHTML = `
      <div class="page-header">
        <h1>Compare SKU across banners</h1>
        <div class="period-control">Viewing: ${periodSelectorHTML(period)}</div>
      </div>
      <label>SKU <select id="compare-sku">${skuOptions}</select></label>
      ${
        rows.length === 0
          ? `<p class="muted">No pricing recorded for this SKU in ${esc(periodLabel(period))} yet.</p>`
          : `<table class="table">
        <thead><tr><th>Banner</th><th>Group</th><th>Deal shown</th><th>List Price (ex GST)</th><th>Shelf RRP (inc GST)</th><th>YM Net $</th><th>YM COGs</th><th>Profit $</th><th>YM GP%</th><th>Banner Margin</th><th>Target</th></tr></thead>
        <tbody>${rows
          .map(
            ({ banner, pricing, everydayDeal, m }) => `<tr>
          <td><a href="#/banner/${banner.groupId}/${banner.id}">${badgeHTML(banner, "sm")}${esc(banner.name)}</a></td>
          <td>${esc(State.bannerGroups.find((g) => g.id === banner.groupId).shortName)}</td>
          <td>${esc(everydayDeal.label)}</td>
          <td>${fmt$(m.listPrice)}</td>
          <td>${fmt$(everydayDeal.shelfRRP)}</td>
          <td>${fmt$(m.ymNetDeal)}</td>
          <td>${fmt$(m.cost.total)}</td>
          <td class="${m.profit >= 0 ? "pos" : "neg"}">${fmt$(m.profit)}</td>
          <td>${fmtPct(m.gpPct)}</td>
          <td>${fmtPct(m.bannerMarginPct)}</td>
          <td>${fmtPct(m.targetMarginPct)}</td>
        </tr>`
          )
          .join("")}</tbody>
      </table>`
      }
    `;
    document.getElementById("compare-sku").addEventListener("change", (e) => navigate(`#/compare/${e.target.value}`));
    attachPeriodSelector(main);
  });

  // ------------------------------------------------------------ Trends
  route("trends", async (rest, main) => {
    const selectedSku = rest[0] || State.skus[0].id;
    const sku = skuById(selectedSku);
    const skuOptions = State.skus.map((s) => `<option value="${s.id}" ${s.id === selectedSku ? "selected" : ""}>${esc(s.name)} — ${esc(s.packFormat)}</option>`).join("");

    const periods = sortedPeriodIds();
    const cSeries = cogsSeries(selectedSku);
    const cogsPoints = periods.map((pid) => {
      const e = cSeries.find((c) => c.period === pid);
      return { x: periodLabel(pid).split(" (")[0], y: e ? e.productCogs : null };
    });
    const cogsChart = Charts.lineChart([{ name: "Product COGS ($)", color: "#c9622a", points: cogsPoints }], { yIsPct: false });

    const bannersWithData = State.banners.filter((b) => pricingSeries(selectedSku, b.id).length > 0);
    const gpSeries = bannersWithData.map((b, idx) => {
      const colors = ["#0f7d74", "#1d5c9e", "#f6b333", "#7a5cc0", "#e2483d", "#0a9396", "#b23a6c"];
      const pSeries = pricingSeries(selectedSku, b.id);
      const points = periods.map((pid) => {
        const pr = pSeries.find((p) => p.period === pid);
        if (!pr || pr.deals.length === 0) return { x: periodLabel(pid).split(" (")[0], y: null };
        const everydayDeal = pr.deals.find((d) => d.dealType === "everyday" && /carton/i.test(d.label)) || pr.deals[0];
        const m = computeDeal(sku, b, pr, everydayDeal, pid);
        return { x: periodLabel(pid).split(" (")[0], y: m.gpPct };
      });
      return { name: b.name, color: colors[idx % colors.length], points };
    });
    const gpChart = gpSeries.length ? Charts.lineChart(gpSeries, { yIsPct: true }) : `<p class="muted">No pricing history yet for this SKU.</p>`;

    main.innerHTML = `
      <div class="page-header"><h1>Historical trends</h1></div>
      <label>SKU <select id="trends-sku">${skuOptions}</select></label>
      <div class="grid-2">
        <div class="card"><h3>${skuThumbHTML(sku)}Product COGS over time — ${esc(sku.name)}</h3>${cogsChart}</div>
        <div class="card"><h3>YM GP% over time (everyday carton) by banner</h3>${gpChart}</div>
      </div>
    `;
    document.getElementById("trends-sku").addEventListener("change", (e) => navigate(`#/trends/${e.target.value}`));
  });

  // ------------------------------------------------------------ CPI Update
  route("cpi-update", async (rest, main) => {
    main.innerHTML = `
      <div class="page-header"><h1>6-Monthly CPI Update</h1></div>
      <div class="card">
        <p>Add a $ increase to Product COGS and/or wholesale list price, per SKU. This creates a new versioned period — existing historical data is never overwritten. The resulting % increase for each SKU is shown once you enter the $ amount, since the same $ increase is a different % depending on the SKU's current price.</p>
        <div class="grid-3">
          <label>New period label<input type="text" id="cpi-new-period-label" placeholder="e.g. FY27 H2 (Jan–Jun 2027)"></label>
          <label>New period id (short code)<input type="text" id="cpi-new-period-id" placeholder="e.g. FY27-H2"></label>
          <label>Effective date<input type="date" id="cpi-new-period-date"></label>
        </div>
        <button class="btn-sm" id="cpi-fill-suggested">Fill all with a suggested % increase</button>
        <input type="number" step="0.1" id="cpi-suggest-pct" value="2.5" style="width:70px;display:inline-block;margin:0 6px;"> %
        <h4>Product COGS ($ increase per SKU)</h4>
        <table class="table table-compact">
          <thead><tr><th>SKU</th><th>Current COGS</th><th>$ increase</th><th>New COGS</th><th>% increase</th></tr></thead>
          <tbody id="cpi-cogs-rows"></tbody>
        </table>
        <h4>Wholesale / list price ($ increase per SKU/banner)</h4>
        <table class="table table-compact">
          <thead><tr><th>SKU</th><th>Banner</th><th>Current list price</th><th>$ increase</th><th>New list price</th><th>% increase</th></tr></thead>
          <tbody id="cpi-price-rows"></tbody>
        </table>
        <h4>Distributor list price — Independent Bottleshops <span class="muted small">(one $ increase updates every banner routed through that distributor)</span></h4>
        <table class="table table-compact">
          <thead><tr><th>SKU</th><th>Distributor</th><th>Current list price</th><th>$ increase</th><th>New list price</th><th>% increase</th></tr></thead>
          <tbody id="cpi-dist-price-rows"></tbody>
        </table>
        <div class="modal-actions">
          <button class="btn-primary" id="cpi-apply-btn">Apply update</button>
        </div>
      </div>
    `;

    const cogsRowsBody = document.getElementById("cpi-cogs-rows");
    State.skus.forEach((sku) => {
      const c = latestCogs(sku.id, State.currentPeriod);
      if (!c) return;
      const row = el(`<tr data-sku="${sku.id}">
        <td>${skuThumbHTML(sku, "sm")}${esc(sku.name)} <span class="muted small">${esc(sku.packFormat)}</span></td>
        <td class="cur-cogs">${fmt$(c.productCogs)}</td>
        <td><input type="number" step="0.01" class="cogs-delta" value="0"></td>
        <td class="new-cogs">${fmt$(c.productCogs)}</td>
        <td class="pct-cogs">0.0%</td>
      </tr>`);
      cogsRowsBody.appendChild(row);
      row.querySelector(".cogs-delta").addEventListener("input", (e) => {
        const delta = parseFloat(e.target.value || 0);
        const newVal = c.productCogs + delta;
        row.querySelector(".new-cogs").textContent = fmt$(newVal);
        row.querySelector(".pct-cogs").textContent = fmtPct(Calc.pctIncrease(c.productCogs, delta));
      });
    });

    const priceRowsBody = document.getElementById("cpi-price-rows");
    const latestByPair = {};
    State.pricingHistory.forEach((p) => {
      const banner = bannerById(p.bannerId);
      if (usesSharedDistributorPricing(banner)) return; // these are updated once per distributor below, not per banner
      const key = p.skuId + "|" + p.bannerId;
      if (!latestByPair[key] || periodIndex(p.period) > periodIndex(latestByPair[key].period)) latestByPair[key] = p;
    });
    Object.values(latestByPair).forEach((p) => {
      const sku = skuById(p.skuId);
      const banner = bannerById(p.bannerId);
      const row = el(`<tr data-sku="${p.skuId}" data-banner="${p.bannerId}">
        <td>${skuThumbHTML(sku, "sm")}${esc(sku.name)}</td>
        <td>${badgeHTML(banner, "sm")}${esc(banner.name)}</td>
        <td class="cur-price">${fmt$(p.listPrice)}</td>
        <td><input type="number" step="0.01" class="price-delta" value="0"></td>
        <td class="new-price">${fmt$(p.listPrice)}</td>
        <td class="pct-price">0.0%</td>
      </tr>`);
      priceRowsBody.appendChild(row);
      row.querySelector(".price-delta").addEventListener("input", (e) => {
        const delta = parseFloat(e.target.value || 0);
        const newVal = p.listPrice + delta;
        row.querySelector(".new-price").textContent = fmt$(newVal);
        row.querySelector(".pct-price").textContent = fmtPct(Calc.pctIncrease(p.listPrice, delta));
      });
    });

    // One row per SKU/distributor that's actually priced and in use by at least one
    // independent banner — bumping this once updates every banner on that distributor.
    const distPriceRowsBody = document.getElementById("cpi-dist-price-rows");
    const distributorsInUse = new Set(State.banners.filter((b) => usesSharedDistributorPricing(b)).map((b) => b.distributor));
    const latestByDistSku = {};
    State.distributorPricing.forEach((dp) => {
      if (!distributorsInUse.has(dp.distributor)) return;
      const key = dp.distributor + "|" + dp.skuId;
      if (!latestByDistSku[key] || periodIndex(dp.period) > periodIndex(latestByDistSku[key].period)) latestByDistSku[key] = dp;
    });
    Object.values(latestByDistSku).forEach((dp) => {
      const sku = skuById(dp.skuId);
      const row = el(`<tr data-sku="${dp.skuId}" data-distributor="${dp.distributor}">
        <td>${skuThumbHTML(sku, "sm")}${esc(sku.name)}</td>
        <td>${esc(dp.distributor)}</td>
        <td class="cur-price">${fmt$(dp.listPrice)}</td>
        <td><input type="number" step="0.01" class="dist-price-delta" value="0"></td>
        <td class="new-price">${fmt$(dp.listPrice)}</td>
        <td class="pct-price">0.0%</td>
      </tr>`);
      distPriceRowsBody.appendChild(row);
      row.querySelector(".dist-price-delta").addEventListener("input", (e) => {
        const delta = parseFloat(e.target.value || 0);
        const newVal = dp.listPrice + delta;
        row.querySelector(".new-price").textContent = fmt$(newVal);
        row.querySelector(".pct-price").textContent = fmtPct(Calc.pctIncrease(dp.listPrice, delta));
      });
    });

    document.getElementById("cpi-fill-suggested").addEventListener("click", () => {
      const pct = parseFloat(document.getElementById("cpi-suggest-pct").value || 0) / 100;
      cogsRowsBody.querySelectorAll("tr").forEach((row) => {
        const sku = skuById(row.dataset.sku);
        const c = latestCogs(sku.id, State.currentPeriod);
        const delta = Calc.round2(c.productCogs * pct);
        row.querySelector(".cogs-delta").value = delta;
        row.querySelector(".cogs-delta").dispatchEvent(new Event("input"));
      });
      priceRowsBody.querySelectorAll("tr").forEach((row) => {
        const p = latestByPair[row.dataset.sku + "|" + row.dataset.banner];
        const delta = Calc.round2(p.listPrice * pct);
        row.querySelector(".price-delta").value = delta;
        row.querySelector(".price-delta").dispatchEvent(new Event("input"));
      });
      distPriceRowsBody.querySelectorAll("tr").forEach((row) => {
        const dp = latestByDistSku[row.dataset.distributor + "|" + row.dataset.sku];
        const delta = Calc.round2(dp.listPrice * pct);
        row.querySelector(".dist-price-delta").value = delta;
        row.querySelector(".dist-price-delta").dispatchEvent(new Event("input"));
      });
    });

    document.getElementById("cpi-apply-btn").addEventListener("click", async () => {
      const newId = document.getElementById("cpi-new-period-id").value.trim();
      const newLabel = document.getElementById("cpi-new-period-label").value.trim();
      const newDate = document.getElementById("cpi-new-period-date").value;
      if (!newId || !newLabel) {
        alert("Please provide a period id and label.");
        return;
      }
      if (!State.periods.find((p) => p.id === newId)) {
        const newPeriod = { id: newId, label: newLabel, effectiveDate: newDate || null };
        State.periods.push(newPeriod);
        await DB.setMeta("periods", State.periods);
      }
      State.currentPeriod = newId;
      await DB.setMeta("currentPeriod", newId);

      for (const row of cogsRowsBody.querySelectorAll("tr")) {
        const skuId = row.dataset.sku;
        const delta = parseFloat(row.querySelector(".cogs-delta").value || 0);
        const c = latestCogs(skuId, null);
        if (!c) continue;
        const newVal = Calc.round2(c.productCogs + delta);
        const pct = Calc.pctIncrease(c.productCogs, delta);
        const record = { skuId, period: newId, productCogs: newVal, source: `CPI update +${fmt$(delta)} (${fmtPct(pct)})` };
        const id = await DB.put("cogsHistory", record);
        record.id = id;
        State.cogsHistory.push(record);
      }
      for (const row of priceRowsBody.querySelectorAll("tr")) {
        const skuId = row.dataset.sku;
        const bannerId = row.dataset.banner;
        const delta = parseFloat(row.querySelector(".price-delta").value || 0);
        const p = latestByPair[skuId + "|" + bannerId];
        const newVal = Calc.round2(p.listPrice + delta);
        const pct = Calc.pctIncrease(p.listPrice, delta);
        const record = {
          skuId,
          bannerId,
          period: newId,
          listPrice: newVal,
          deals: p.deals.map((d) => Object.assign({}, d)),
          notes: `CPI update: list price +${fmt$(delta)} (${fmtPct(pct)}). Shelf RRPs carried over — review manually.`,
        };
        const id = await DB.put("pricingHistory", record);
        record.id = id;
        State.pricingHistory.push(record);
      }
      for (const row of distPriceRowsBody.querySelectorAll("tr")) {
        const skuId = row.dataset.sku;
        const distributor = row.dataset.distributor;
        const delta = parseFloat(row.querySelector(".dist-price-delta").value || 0);
        const dp = latestByDistSku[distributor + "|" + skuId];
        const newVal = Calc.round2(dp.listPrice + delta);
        const pct = Calc.pctIncrease(dp.listPrice, delta);
        const record = {
          distributor,
          skuId,
          period: newId,
          listPrice: newVal,
          source: `CPI update +${fmt$(delta)} (${fmtPct(pct)})`,
        };
        const id = await DB.put("distributorPricing", record);
        record.id = id;
        State.distributorPricing.push(record);
      }
      State.viewPeriod = newId;
      alert(`CPI update applied. New period "${newLabel}" is now current.`);
      navigate("#/dashboard");
    });
  });

  // ------------------------------------------------------------ Promo Calendar
  //
  // Live-linked to the pricing sheet: a calendar entry stores just a banner,
  // SKU, deal type and date range (plus status/notes). Promo name, target
  // margin and actual margin are NOT stored — they're computed fresh every
  // render from whatever the SKU's pricing card currently has for that deal
  // type, so editing a price on the banner page instantly updates every
  // calendar bar/row that references it. "Manual" entries (mostly the
  // imported historical/placeholder deals that don't cleanly map to a
  // configured deal type) keep their own promoName/target/actual instead.
  const CAL_PALETTE = ["#0f7d74", "#f6b333", "#e2483d", "#2f8f6a", "#1d5c9e", "#c9622a", "#7a5cc0", "#0a9396", "#b23a6c", "#6b8f1f"];
  function calBannerColor(bannerId) {
    const banner = bannerById(bannerId);
    if (banner && banner.badgeColor) return banner.badgeColor;
    const idx = State.banners.findIndex((b) => b.id === bannerId);
    return CAL_PALETTE[(idx < 0 ? 0 : idx) % CAL_PALETTE.length];
  }
  function calSkuColor(skuId) {
    const idx = State.skus.findIndex((s) => s.id === skuId);
    return CAL_PALETTE[(idx < 0 ? 0 : idx + 4) % CAL_PALETTE.length];
  }
  function calInitials(name) {
    const banner = State.banners.find((b) => b.name === name);
    if (banner && banner.badgeInitials) return banner.badgeInitials;
    name = (name || "?").trim();
    const parts = name.split(/\s+/);
    return (((parts[0] || "")[0] || "?") + ((parts[1] || "")[0] || "")).toUpperCase();
  }
  function calParseDate(s) {
    const p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function calFmtDate(d) {
    const y = d.getFullYear(),
      m = ("0" + (d.getMonth() + 1)).slice(-2),
      day = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + day;
  }
  function calAddDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }
  function calDiffDays(a, b) {
    return Math.round((b - a) / 86400000);
  }
  const CAL_SANE_YEAR_MIN = 2000,
    CAL_SANE_YEAR_MAX = 2100;
  function calIsSaneDate(dt) {
    return dt && !isNaN(dt.getTime()) && dt.getFullYear() >= CAL_SANE_YEAR_MIN && dt.getFullYear() <= CAL_SANE_YEAR_MAX;
  }
  function calOrderedBanners() {
    return State.banners.slice().sort((a, b) => {
      const gi = (x) => State.bannerGroups.findIndex((g) => g.id === x.groupId);
      return gi(a) - gi(b) || a.name.localeCompare(b.name);
    });
  }
  function calOrderedSkus() {
    return State.skus.slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  function calBannerHref(bannerId) {
    const b = bannerById(bannerId);
    return b ? `#/banner/${b.groupId}/${b.id}` : "#/dashboard";
  }

  /**
   * Resolve what a calendar entry should actually show right now: for a
   * linked entry, this looks up the SKU's current pricing at that banner,
   * finds the matching deal type, and runs it through the same calc engine
   * as the banner page — so it's always "live" (never goes stale, never
   * needs re-syncing). For a manual/legacy entry, its own stored fields are
   * used as-is.
   */
  function calDealDisplay(entry) {
    const banner = bannerById(entry.bannerId);
    const sku = skuById(entry.skuId);
    if (!banner || !sku) {
      return { promoName: "(unknown banner/SKU)", targetMarginPct: null, actualMarginPct: null, missing: true };
    }
    if (!entry.linked) {
      return {
        promoName: entry.promoName || "(untitled)",
        targetMarginPct: entry.targetMarginPct != null ? entry.targetMarginPct : null,
        actualMarginPct: entry.actualMarginPct != null ? entry.actualMarginPct : null,
        linked: false,
      };
    }
    const dt = (banner.dealTypes || []).find((d) => d.id === entry.dealTypeId);
    const label = dt ? dt.label : "(deal type removed)";
    const pr = latestPricing(sku.id, banner.id, null); // always the latest period — this is what makes it "live"
    const dealRow = pr ? pr.deals.find((d) => d.dealTypeId === entry.dealTypeId) : null;
    if (!pr || !dealRow) {
      return { promoName: label, targetMarginPct: null, actualMarginPct: null, linked: true, pending: true };
    }
    const m = computeDeal(sku, banner, pr, dealRow, null);
    return {
      promoName: label,
      targetMarginPct: m.targetMarginPct,
      actualMarginPct: m.bannerMarginPct,
      linked: true,
      listPrice: pr.listPrice,
      shelfRRP: dealRow.shelfRRP,
      ymNetDeal: m.ymNetDeal,
      profit: m.profit,
      gpPct: m.gpPct,
    };
  }
  function calMarginStatus(disp) {
    if (disp.actualMarginPct == null || disp.targetMarginPct == null) return "pending";
    return disp.actualMarginPct >= disp.targetMarginPct - 1e-9 ? "met" : "below";
  }
  function calMarginColor(status) {
    return status === "met" ? "var(--pos)" : status === "below" ? "var(--neg)" : "var(--accent-warm)";
  }
  function calStatusBadge(s) {
    return { planned: "PLN", confirmed: "CFM", live: "LIVE", complete: "DONE" }[s] || s;
  }

  route("calendar", async (rest, main) => {
    // Defaults to the 6-month zoom, scrolled to today — that's the window
    // most planning conversations actually look at, so it opens on the
    // right view instead of a full year or a single month.
    const calState = { view: "timeline", zoom: "half", filters: { bannerId: "all", skuId: "all", status: "all", search: "" }, sort: { key: "startDate", dir: 1 } };
    const CAL_PX = { month: 26, quarter: 9, half: 5, year: 3.2 };
    let rangeStart, rangeEnd, totalDays, pxPerDay;

    function calFilteredDeals() {
      return State.calendarDeals.filter((d) => {
        if (calState.filters.bannerId !== "all" && d.bannerId !== calState.filters.bannerId) return false;
        if (calState.filters.skuId !== "all" && d.skuId !== calState.filters.skuId) return false;
        if (calState.filters.status !== "all" && d.status !== calState.filters.status) return false;
        if (calState.filters.search) {
          const disp = calDealDisplay(d);
          const sku = skuById(d.skuId);
          const q = calState.filters.search.toLowerCase();
          const hay = ((sku ? sku.name : "") + " " + disp.promoName + " " + (d.cycleInstance || "")).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
    }

    main.innerHTML = `
      <div class="page-header">
        <h1>Promo Calendar</h1>
      </div>
      <p class="muted small">Linked deals stay live — their promo name, target margin and actual margin always reflect whatever's currently set on the banner's pricing card, so a price change shows up here automatically. Manage banners, SKUs and pricing from their own pages; this view just visualises what's already there. Drag a bar to shift its dates, drag its edges to resize, double-click empty space on a row to add a deal.</p>
      <div class="cal-toolbar-row">
        <div class="cal-view-toggle">
          <button id="cal-view-timeline" class="btn-sm active">Timeline</button>
          <button id="cal-view-table" class="btn-sm">Table</button>
        </div>
        <button class="btn-primary btn-sm" id="cal-add-deal">+ Add deal</button>
      </div>
      <div class="cal-filters">
        <div><label>Banner</label><select id="cal-filter-banner" class="select"><option value="all">All banners</option>${calOrderedBanners()
          .map((b) => `<option value="${b.id}">${esc(b.name)}</option>`)
          .join("")}</select></div>
        <div><label>SKU</label><select id="cal-filter-sku" class="select"><option value="all">All SKUs</option>${calOrderedSkus()
          .map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(s.packFormat || "")}</option>`)
          .join("")}</select></div>
        <div><label>Status</label><select id="cal-filter-status" class="select">
          <option value="all">All statuses</option>
          <option value="planned">Planned</option>
          <option value="confirmed">Confirmed</option>
          <option value="live">Live</option>
          <option value="complete">Complete</option>
        </select></div>
        <div><label>Search</label><input type="text" id="cal-filter-search" placeholder="SKU or promo name"></div>
        <div class="cal-legend">
          <span><span class="cal-dot" style="background:var(--pos)"></span>Meeting/above target</span>
          <span><span class="cal-dot" style="background:var(--neg)"></span>Below target</span>
          <span><span class="cal-dot" style="background:var(--accent-warm)"></span>Pending / no price set</span>
        </div>
      </div>
      <div id="cal-timeline-view">
        <div class="cal-gantt-wrap">
          <div class="cal-gantt-nav">
            <button class="btn-xs cal-zoom-btn" id="cal-zoom-month" data-zoom="month">Month</button>
            <button class="btn-xs cal-zoom-btn" id="cal-zoom-quarter" data-zoom="quarter">Quarter</button>
            <button class="btn-xs cal-zoom-btn" id="cal-zoom-half" data-zoom="half">6 Months</button>
            <button class="btn-xs cal-zoom-btn" id="cal-zoom-year" data-zoom="year">Year</button>
            <button class="btn-xs" id="cal-scroll-today">Jump to Today</button>
            <span class="muted small" id="cal-range-label" style="margin-left:auto;"></span>
          </div>
          <div class="cal-gantt-body">
            <div class="cal-gantt-frozen">
              <div class="cal-frozen-header"><div class="cal-fh-rail">Banner</div><div class="cal-fh-label">SKU</div></div>
              <div class="cal-frozen-viewport" id="cal-frozen-viewport">
                <div class="cal-frozen-inner" id="cal-frozen-inner"></div>
              </div>
            </div>
            <div class="cal-gantt-scroll" id="cal-gantt-scroll">
              <div class="cal-gantt-grid" id="cal-gantt-grid"></div>
            </div>
          </div>
        </div>
      </div>
      <div id="cal-table-view" style="display:none;">
        <div class="table-scroll"><table class="table">
          <thead><tr>
            <th data-sort="banner">Banner</th><th data-sort="sku">SKU</th><th data-sort="cycleInstance">Cycle</th>
            <th data-sort="promoName">Promo</th><th>Shelf RRP (inc GST)</th><th data-sort="startDate">Start</th><th data-sort="endDate">End</th>
            <th data-sort="targetMarginPct">Target %</th><th data-sort="actualMarginPct">Actual %</th>
            <th data-sort="status">Status</th><th>Notes</th><th></th>
          </tr></thead>
          <tbody id="cal-table-body"></tbody>
        </table></div>
      </div>
      <div id="modal-root"></div>
    `;

    function calRenderAll() {
      if (calState.view === "timeline") calRenderTimeline();
      else calRenderTable();
    }

    // ---------------- Timeline ----------------
    const CAL_EMPTY_ROW_H = 40;
    const CAL_LANE_H = 34; // per-lane height — bars are single-line now that deal type lives on the rail

    function calComputeRange() {
      const y = new Date().getFullYear();
      let minD = new Date(y, 0, 1),
        maxD = new Date(y, 11, 31);
      State.calendarDeals.forEach((d) => {
        const s = calParseDate(d.startDate),
          e = calParseDate(d.endDate);
        if (!calIsSaneDate(s) || !calIsSaneDate(e)) return;
        if (s < minD) minD = s;
        if (e > maxD) maxD = e;
      });
      rangeStart = calAddDays(minD, -14);
      rangeEnd = calAddDays(maxD, 14);
      totalDays = calDiffDays(rangeStart, rangeEnd);
      pxPerDay = CAL_PX[calState.zoom];
    }

    function calPackLanes(deals) {
      const sorted = deals.slice().sort((a, b) => calParseDate(a.startDate) - calParseDate(b.startDate));
      const lanes = [];
      sorted.forEach((d) => {
        const s = calParseDate(d.startDate);
        let placed = false;
        for (let i = 0; i < lanes.length; i++) {
          const lastInLane = lanes[i][lanes[i].length - 1];
          if (calParseDate(lastInLane.endDate) <= s) {
            lanes[i].push(d);
            placed = true;
            break;
          }
        }
        if (!placed) lanes.push([d]);
      });
      return lanes;
    }

    // Group a SKU's deals into one line per deal type (for linked deals,
    // so "Everyday (Carton)" and "Promo 1 (Carton)" each get their own row
    // instead of being packed into shared lanes purely by date) plus a
    // single "Manual entries" line for anything not live-linked, since
    // those don't have a deal type to key by.
    function calSkuLineGroups(skuDeals, banner) {
      const linkedByType = new Map();
      const manual = [];
      skuDeals.forEach((d) => {
        if (d.linked && d.dealTypeId) {
          if (!linkedByType.has(d.dealTypeId)) {
            const dt = (banner.dealTypes || []).find((x) => x.id === d.dealTypeId);
            linkedByType.set(d.dealTypeId, { label: dt ? dt.label : "(deal type removed)", deals: [] });
          }
          linkedByType.get(d.dealTypeId).deals.push(d);
        } else {
          manual.push(d);
        }
      });
      const orderedTypeIds = (banner.dealTypes || []).map((dt) => dt.id).filter((id) => linkedByType.has(id));
      linkedByType.forEach((_, id) => {
        if (orderedTypeIds.indexOf(id) === -1) orderedTypeIds.push(id);
      });
      const groups = orderedTypeIds.map((id) => ({ label: linkedByType.get(id).label, deals: linkedByType.get(id).deals }));
      if (manual.length) groups.push({ label: "Manual entries", deals: manual });
      return groups;
    }

    function calAxisHtml() {
      let out = "";
      let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      while (cur <= rangeEnd) {
        const offset = calDiffDays(rangeStart, cur) * pxPerDay;
        const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        const label = cur.toLocaleDateString(undefined, { month: "short", year: cur.getMonth() === 0 ? "numeric" : undefined });
        out += `<div class="cal-axis-month" style="left:${Math.max(offset, 0)}px;">${label}</div>`;
        if (calState.zoom !== "year") {
          let w = new Date(cur);
          while (w < nextMonth && w <= rangeEnd) {
            const wOffset = calDiffDays(rangeStart, w) * pxPerDay;
            if (wOffset >= 0) out += `<div class="cal-axis-week" style="left:${wOffset}px;">${w.getDate()}</div>`;
            w = calAddDays(w, 7);
          }
        }
        cur = nextMonth;
      }
      return out;
    }
    function calGridLinesHtml() {
      let out = "";
      let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      while (cur <= rangeEnd) {
        const offset = calDiffDays(rangeStart, cur) * pxPerDay;
        if (offset >= 0) out += `<div class="cal-month-line" style="left:${offset}px;"></div>`;
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      return out;
    }
    function calTodayLineHtml() {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      if (t < rangeStart || t > rangeEnd) return "";
      const offset = calDiffDays(rangeStart, t) * pxPerDay;
      return `<div class="cal-today-line" style="left:${offset}px;" title="Today"></div>`;
    }
    function calBarHtml(d, sku, laneIdx, isManualGroup) {
      const s = calParseDate(d.startDate),
        e = calParseDate(d.endDate);
      const left = calDiffDays(rangeStart, s) * pxPerDay;
      const width = Math.max(calDiffDays(s, e) * pxPerDay, 10);
      const top = laneIdx * CAL_LANE_H + 5;
      const disp = calDealDisplay(d);
      const mStatus = calMarginStatus(disp);
      const bg = calSkuColor(sku.id) + "3d";
      const priceText = disp.shelfRRP != null ? fmt$(disp.shelfRRP) : "";
      // Deal type now has its own row on the frozen rail, so a linked deal's
      // bar just needs status + Price. Manual/unlinked deals still share one
      // row per SKU, so they keep their own name on the bar to stay
      // distinguishable from each other.
      const label = isManualGroup ? `${esc(disp.promoName)}${disp.linked ? " 🔗" : ""} ${priceText}` : priceText;
      return `<div class="cal-bar cal-status-${d.status}" data-deal="${d.id}" style="left:${left}px;width:${width}px;top:${top}px;background:${bg};border-left-color:${calMarginColor(mStatus)};">
        <span class="cal-handle cal-handle-left" data-handle="left"></span>
        <div class="cal-bar-line1"><span class="cal-badge">${calStatusBadge(d.status)}</span>${label}</div>
        <span class="cal-handle cal-handle-right" data-handle="right"></span>
      </div>`;
    }

    function calRenderTimeline() {
      calComputeRange();
      const totalPx = Math.round(totalDays * pxPerDay);
      const grid = document.getElementById("cal-gantt-grid");
      const frozen = document.getElementById("cal-frozen-inner");
      grid.style.gridTemplateColumns = totalPx + "px";

      let trackHtml = `<div class="cal-axis-cell cal-track-cell" style="grid-row:1;width:${totalPx}px;">${calAxisHtml()}</div>`;
      let frozenHtml = "";

      const deals = calFilteredDeals();
      const banners = calOrderedBanners().filter((b) => calState.filters.bannerId === "all" || calState.filters.bannerId === b.id);

      if (banners.length === 0) {
        grid.innerHTML = trackHtml + '<div style="padding:24px;color:var(--muted);">No banners match the current filter.</div>';
        frozen.innerHTML = "";
        frozen.style.transform = "translateY(0px)";
        document.getElementById("cal-range-label").textContent = "";
        return;
      }

      const MIN_BANNER_BLOCK_H = 150;
      let rowIndex = 2;
      banners.forEach((banner) => {
        const bannerStartRow = rowIndex;
        const bannerDeals = deals.filter((d) => d.bannerId === banner.id);
        const rows = [];
        if (bannerDeals.length === 0) {
          rows.push({ type: "empty" });
        } else {
          const skuIds = [];
          bannerDeals.forEach((d) => {
            if (skuIds.indexOf(d.skuId) === -1) skuIds.push(d.skuId);
          });
          skuIds.sort((a, b) => {
            const sa = skuById(a),
              sb = skuById(b);
            return (sa ? sa.name : "").localeCompare(sb ? sb.name : "");
          });
          skuIds.forEach((sid) => {
            const sku = skuById(sid);
            if (!sku) return;
            const skuDeals = bannerDeals.filter((d) => d.skuId === sid);
            // One row per deal type (linked deals grouped by dealTypeId, plus
            // one shared "Manual entries" row) so deal types no longer need
            // to be packed into shared, date-overlap lanes.
            const groups = calSkuLineGroups(skuDeals, banner);
            groups.forEach((group, gi) => {
              const lanes = calPackLanes(group.deals);
              const laneCount = Math.max(lanes.length, 1);
              rows.push({
                type: "sku",
                height: Math.max(laneCount * CAL_LANE_H + 10, 40),
                sku,
                lanes,
                groupLabel: group.label,
                isHeader: gi === 0,
                isManual: group.label === "Manual entries",
              });
            });
          });
        }
        let totalH = rows.reduce((sum, r) => sum + (r.height || CAL_EMPTY_ROW_H), 0);
        if (rows.length > 0 && totalH < MIN_BANNER_BLOCK_H) {
          rows[rows.length - 1].height = (rows[rows.length - 1].height || CAL_EMPTY_ROW_H) + (MIN_BANNER_BLOCK_H - totalH);
        }

        rows.forEach((row, i) => {
          const sCls = i === 0 ? " cal-chain-start" : "";
          const h = row.height || CAL_EMPTY_ROW_H;
          if (row.type === "empty") {
            frozenHtml += `<div class="cal-empty-row${sCls}" style="grid-column:1/-1;grid-row:${rowIndex};height:${h}px;">No deals yet.<button class="btn-xs" data-cal-add-banner="${banner.id}">+ Add</button></div>`;
            trackHtml += `<div class="cal-track-cell${sCls}" style="grid-row:${rowIndex};height:${h}px;width:${totalPx}px;"></div>`;
          } else {
            const sku = row.sku,
              lanes = row.lanes;
            // First row for a SKU shows the name/dot/actions plus which deal
            // type this line is (pack format still available via tooltip on
            // the SKU name); later rows for the same SKU just show the deal
            // type, indented, since the SKU itself isn't repeated.
            frozenHtml += row.isHeader
              ? `<div class="cal-label-cell${sCls}" style="grid-row:${rowIndex};height:${h}px;">
                  <div class="cal-sku-row-top">
                    <span class="cal-sku-dot" style="background:${calSkuColor(sku.id)};"></span>
                    <span class="cal-sku-name" title="${esc(sku.name)}${sku.packFormat ? " · " + esc(sku.packFormat) : ""}">${esc(sku.name)}</span>
                    <span class="cal-sku-actions"><button class="btn-xs" data-cal-add-banner="${banner.id}" data-cal-add-sku="${sku.id}" title="Add deal for this SKU/banner">+</button></span>
                  </div>
                  <div class="cal-sku-code" title="${esc(row.groupLabel)}">${esc(row.groupLabel)}</div>
                </div>`
              : `<div class="cal-label-cell${sCls}" style="grid-row:${rowIndex};height:${h}px;">
                  <div class="cal-sku-subtype" title="${esc(row.groupLabel)}">${esc(row.groupLabel)}</div>
                </div>`;
            trackHtml += `<div class="cal-track-cell${sCls}" data-banner="${banner.id}" data-sku="${sku.id}" style="grid-row:${rowIndex};height:${h}px;width:${totalPx}px;">
              ${calGridLinesHtml()}${calTodayLineHtml()}
              ${lanes.map((laneDeals, laneIdx) => laneDeals.map((d) => calBarHtml(d, sku, laneIdx, row.isManual)).join("")).join("")}
            </div>`;
          }
          rowIndex++;
        });

        frozenHtml += `<div class="cal-chain-rail cal-chain-start" style="grid-column:1;grid-row:${bannerStartRow} / span ${rows.length};">
          <div class="cal-logo-fallback" style="background:${calBannerColor(banner.id)}">${calInitials(banner.name)}</div>
          <a class="cal-rail-name" href="${calBannerHref(banner.id)}" title="Open ${esc(banner.name)}'s pricing page">${esc(banner.name)}</a>
          <span class="cal-rail-actions"><button class="btn-xs" data-cal-add-banner="${banner.id}" title="Add deal">+</button></span>
        </div>`;
      });

      grid.innerHTML = trackHtml;
      frozen.innerHTML = frozenHtml;
      document.getElementById("cal-range-label").textContent = calFmtDate(rangeStart) + " → " + calFmtDate(rangeEnd);
      calAttachBarHandlers();
      calAttachTrackHandlers();
      calAttachLabelHandlers();
      const gs = document.getElementById("cal-gantt-scroll");
      frozen.style.transform = "translateY(-" + gs.scrollTop + "px)";
    }

    function calAttachLabelHandlers() {
      document.querySelectorAll("[data-cal-add-banner]").forEach((btn) => {
        btn.addEventListener("click", () => calOpenDealModal(null, btn.dataset.calAddBanner, btn.dataset.calAddSku));
      });
    }
    function calAttachTrackHandlers() {
      document.querySelectorAll(".cal-track-cell[data-banner]").forEach((cell) => {
        cell.addEventListener("dblclick", (e) => {
          if (e.target !== cell) return;
          const bannerId = cell.dataset.banner,
            skuId = cell.dataset.sku;
          const clickX = e.offsetX;
          const dayOffset = Math.round(clickX / pxPerDay);
          const startDate = calAddDays(rangeStart, dayOffset);
          const endDate = calAddDays(startDate, 13);
          calOpenDealModal(null, bannerId, skuId, { startDate: calFmtDate(startDate), endDate: calFmtDate(endDate) });
        });
      });
    }

    let calDrag = null;
    function calAttachBarHandlers() {
      document.querySelectorAll(".cal-bar").forEach((bar) => {
        bar.addEventListener("mouseenter", (e) => calShowTooltip(bar, e));
        bar.addEventListener("mousemove", (e) => calPositionTooltip(e));
        bar.addEventListener("mouseleave", calHideTooltip);
        bar.addEventListener("mousedown", (e) => calStartDrag(e, bar));
        bar.addEventListener("click", (e) => {
          if (bar.dataset.dragged === "1") {
            bar.dataset.dragged = "0";
            return;
          }
          calOpenDealModal(State.calendarDeals.find((d) => d.id === bar.dataset.deal));
        });
      });
    }
    function calStartDrag(e, bar) {
      const handle = e.target.getAttribute("data-handle");
      e.preventDefault();
      const deal = State.calendarDeals.find((d) => d.id === bar.dataset.deal);
      const startX = e.clientX;
      const origStart = calParseDate(deal.startDate),
        origEnd = calParseDate(deal.endDate);
      calDrag = { deal, bar, handle, startX, origStart, origEnd, moved: false };
      calHideTooltip();
      document.addEventListener("mousemove", calOnDragMove);
      document.addEventListener("mouseup", calOnDragEnd);
    }
    function calOnDragMove(e) {
      if (!calDrag) return;
      const dx = e.clientX - calDrag.startX;
      const dayDelta = Math.round(dx / pxPerDay);
      if (dayDelta === 0) return;
      calDrag.moved = true;
      calDrag.bar.dataset.dragged = "1";
      let newStart = calDrag.origStart,
        newEnd = calDrag.origEnd;
      if (calDrag.handle === "left") {
        newStart = calAddDays(calDrag.origStart, dayDelta);
        if (newStart >= newEnd) newStart = calAddDays(newEnd, -1);
      } else if (calDrag.handle === "right") {
        newEnd = calAddDays(calDrag.origEnd, dayDelta);
        if (newEnd <= newStart) newEnd = calAddDays(newStart, 1);
      } else {
        newStart = calAddDays(calDrag.origStart, dayDelta);
        newEnd = calAddDays(calDrag.origEnd, dayDelta);
      }
      const left = calDiffDays(rangeStart, newStart) * pxPerDay;
      const width = Math.max(calDiffDays(newStart, newEnd) * pxPerDay, 10);
      calDrag.bar.style.left = left + "px";
      calDrag.bar.style.width = width + "px";
      calDrag._newStart = newStart;
      calDrag._newEnd = newEnd;
    }
    async function calOnDragEnd() {
      if (calDrag && calDrag.moved) {
        calDrag.deal.startDate = calFmtDate(calDrag._newStart);
        calDrag.deal.endDate = calFmtDate(calDrag._newEnd);
        await DB.put("calendarDeals", calDrag.deal);
        calRenderAll();
      }
      document.removeEventListener("mousemove", calOnDragMove);
      document.removeEventListener("mouseup", calOnDragEnd);
      calDrag = null;
    }

    let calTooltipEl = null;
    function calShowTooltip(bar, e) {
      const deal = State.calendarDeals.find((d) => d.id === bar.dataset.deal);
      const banner = bannerById(deal.bannerId);
      const sku = skuById(deal.skuId);
      const disp = calDealDisplay(deal);
      calHideTooltip();
      calTooltipEl = document.createElement("div");
      calTooltipEl.className = "cal-tooltip";
      const mStatus = calMarginStatus(disp);
      const mLabel = mStatus === "met" ? "Meeting target" : mStatus === "below" ? "Below target" : disp.pending ? "No price set for this deal type yet" : "No actual yet";
      calTooltipEl.innerHTML =
        `<div><b>${esc(disp.promoName)}</b>${disp.linked ? ' <span class="cal-muted">(live-linked)</span>' : ' <span class="cal-muted">(manual)</span>'}</div>` +
        `<div class="cal-muted">${esc(banner ? banner.name : "")} · ${esc(deal.cycleInstance || "")}</div>` +
        `<div class="cal-row"><span>SKU</span><span>${esc(sku ? sku.name : "")}</span></div>` +
        `<div class="cal-row"><span>Dates</span><span>${deal.startDate} → ${deal.endDate}</span></div>` +
        (disp.shelfRRP != null ? `<div class="cal-row"><span>Shelf RRP (inc GST)</span><span>${fmt$(disp.shelfRRP)}</span></div>` : "") +
        `<div class="cal-row"><span>Target margin</span><span>${disp.targetMarginPct != null ? fmtPct(disp.targetMarginPct) : "—"}</span></div>` +
        `<div class="cal-row"><span>Actual/banner margin</span><span>${disp.actualMarginPct != null ? fmtPct(disp.actualMarginPct) : "—"} (${mLabel})</span></div>` +
        `<div class="cal-row"><span>Status</span><span>${esc(deal.status)}</span></div>` +
        (deal.notes ? `<div class="cal-muted" style="margin-top:4px;">${esc(deal.notes)}</div>` : "");
      document.body.appendChild(calTooltipEl);
      calPositionTooltip(e);
    }
    function calPositionTooltip(e) {
      if (!calTooltipEl) return;
      calTooltipEl.style.left = e.clientX + 14 + "px";
      calTooltipEl.style.top = e.clientY + 14 + "px";
    }
    function calHideTooltip() {
      if (calTooltipEl) {
        calTooltipEl.remove();
        calTooltipEl = null;
      }
    }

    // ---------------- Table ----------------
    function calRenderTable() {
      const deals = calFilteredDeals().slice();
      const key = calState.sort.key,
        dir = calState.sort.dir;
      const rows = deals.map((d) => ({ d, disp: calDealDisplay(d) }));
      rows.sort((a, b) => {
        let av, bv;
        if (key === "banner") {
          av = (bannerById(a.d.bannerId) || {}).name || "";
          bv = (bannerById(b.d.bannerId) || {}).name || "";
        } else if (key === "sku") {
          av = (skuById(a.d.skuId) || {}).name || "";
          bv = (skuById(b.d.skuId) || {}).name || "";
        } else if (key === "promoName") {
          av = a.disp.promoName;
          bv = b.disp.promoName;
        } else if (key === "targetMarginPct" || key === "actualMarginPct") {
          av = a.disp[key] == null ? -1 : a.disp[key];
          bv = b.disp[key] == null ? -1 : b.disp[key];
        } else {
          av = a.d[key];
          bv = b.d[key];
        }
        if (av == null) av = "";
        if (bv == null) bv = "";
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
      const tbody = document.getElementById("cal-table-body");
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="muted" style="text-align:center;padding:20px;">No deals match the current filters.</td></tr>';
        return;
      }
      tbody.innerHTML = rows
        .map(({ d, disp }) => {
          const banner = bannerById(d.bannerId),
            sku = skuById(d.skuId);
          const mStatus = calMarginStatus(disp);
          return `<tr>
          <td>${banner ? badgeHTML(banner, "sm") : ""}${esc(banner ? banner.name : "?")}</td>
          <td>${sku ? skuThumbHTML(sku, "sm") : ""}${esc(sku ? sku.name : "?")}</td>
          <td>${esc(d.cycleInstance || "")}</td>
          <td>${esc(disp.promoName)}${disp.linked ? " 🔗" : ""}</td>
          <td>${disp.shelfRRP != null ? fmt$(disp.shelfRRP) : "—"}</td>
          <td>${d.startDate}</td>
          <td>${d.endDate}</td>
          <td>${disp.targetMarginPct != null ? fmtPct(disp.targetMarginPct) : "—"}</td>
          <td>${disp.actualMarginPct != null ? fmtPct(disp.actualMarginPct) : "—"}</td>
          <td><span class="cal-flag" style="background:${calMarginColor(mStatus)}"></span>${esc(d.status)}</td>
          <td class="cal-notes-cell" title="${esc(d.notes || "")}">${d.notes ? esc(d.notes) : '<span class="muted">—</span>'}</td>
          <td><button class="btn-xs" data-cal-tbl-edit="${d.id}">Edit</button> <button class="btn-xs" data-cal-tbl-dup="${d.id}">Dup</button> <button class="btn-xs" data-cal-tbl-del="${d.id}">Del</button></td>
        </tr>`;
        })
        .join("");
      tbody.querySelectorAll("[data-cal-tbl-edit]").forEach((b) => b.addEventListener("click", () => calOpenDealModal(State.calendarDeals.find((d) => d.id === b.dataset.calTblEdit))));
      tbody.querySelectorAll("[data-cal-tbl-dup]").forEach((b) => b.addEventListener("click", () => calDuplicateDeal(State.calendarDeals.find((d) => d.id === b.dataset.calTblDup))));
      tbody.querySelectorAll("[data-cal-tbl-del]").forEach((b) => b.addEventListener("click", () => calDeleteDeal(b.dataset.calTblDel)));
    }

    // ---------------- Add/Edit modal ----------------
    function calDuplicateDeal(deal) {
      calOpenDealModal(null, deal.bannerId, deal.skuId, {
        linked: deal.linked,
        dealTypeId: deal.dealTypeId,
        promoName: deal.promoName,
        cycleInstance: deal.cycleInstance,
        startDate: deal.startDate,
        endDate: deal.endDate,
        targetMarginPct: deal.targetMarginPct,
        actualMarginPct: deal.actualMarginPct,
        status: "planned",
        notes: deal.notes,
      });
    }
    async function calDeleteDeal(id) {
      if (!confirm("Delete this calendar deal? This cannot be undone.")) return;
      State.calendarDeals = State.calendarDeals.filter((d) => d.id !== id);
      await DB.open().then((db) => db.transaction("calendarDeals", "readwrite").objectStore("calendarDeals").delete(id));
      calRenderAll();
    }

    function calOpenDealModal(deal, presetBannerId, presetSkuId, prefill) {
      const isNew = !deal;
      const d = deal
        ? Object.assign({}, deal)
        : Object.assign(
            {
              id: uid(),
              bannerId: presetBannerId || (calOrderedBanners()[0] && calOrderedBanners()[0].id) || "",
              skuId: presetSkuId || (calOrderedSkus()[0] && calOrderedSkus()[0].id) || "",
              linked: true,
              dealTypeId: "",
              promoName: "",
              cycleInstance: "",
              startDate: calFmtDate(new Date()),
              endDate: calFmtDate(calAddDays(new Date(), 13)),
              targetMarginPct: null,
              actualMarginPct: null,
              status: "planned",
              notes: "",
            },
            prefill || {}
          );
      if (State.banners.length === 0 || State.skus.length === 0) {
        alert("Add at least one banner and SKU in the pricing sheet first.");
        return;
      }
      const modalRoot = document.getElementById("modal-root");

      function render() {
        const banner = bannerById(d.bannerId) || calOrderedBanners()[0];
        const bannerOptions = calOrderedBanners()
          .map((b) => `<option value="${b.id}" ${b.id === d.bannerId ? "selected" : ""}>${esc(b.name)}</option>`)
          .join("");
        const skuOptions = calOrderedSkus()
          .map((s) => `<option value="${s.id}" ${s.id === d.skuId ? "selected" : ""}>${esc(s.name)} — ${esc(s.packFormat || "")}</option>`)
          .join("");
        const dealTypeOptions = (banner.dealTypes || [])
          .map((dt) => `<option value="${dt.id}" ${dt.id === d.dealTypeId ? "selected" : ""}>${esc(dt.label)}</option>`)
          .join("");
        modalRoot.innerHTML = `
          <div class="modal-backdrop"><div class="modal modal-wide">
            <h3>${isNew ? "Add" : "Edit"} calendar deal</h3>
            <div class="grid-2">
              <div><label>Banner</label><select id="cd-banner" class="select">${bannerOptions}</select></div>
              <div><label>SKU</label><select id="cd-sku" class="select">${skuOptions}</select></div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin-top:14px;">
              <input type="checkbox" id="cd-linked" style="width:auto;" ${d.linked ? "checked" : ""}>
              Link to this SKU's pricing sheet <span class="muted small">(recommended — promo name, target % and actual % all stay live)</span>
            </label>
            <div id="cd-linked-fields" style="display:${d.linked ? "" : "none"};">
              <label>Deal type</label>
              <select id="cd-dealtype" class="select">${dealTypeOptions || '<option value="">No deal types configured for this banner yet</option>'}</select>
              <div class="muted small" id="cd-linked-preview" style="margin-top:6px;"></div>
            </div>
            <div id="cd-manual-fields" style="display:${d.linked ? "none" : ""};">
              <label>Promo name</label>
              <input type="text" id="cd-promoname" value="${esc(d.promoName || "")}">
              <div class="grid-2">
                <div><label>Target margin %</label><input type="number" step="0.1" id="cd-target" value="${d.targetMarginPct != null ? (d.targetMarginPct * 100).toFixed(2) : ""}"></div>
                <div><label>Actual margin % (blank if not run yet)</label><input type="number" step="0.1" id="cd-actual" value="${d.actualMarginPct != null ? (d.actualMarginPct * 100).toFixed(2) : ""}"></div>
              </div>
            </div>
            <label>Cycle / period label (optional)</label>
            <input type="text" id="cd-cycle" placeholder="e.g. P26 or FY26-H2" value="${esc(d.cycleInstance || "")}">
            <div class="grid-2">
              <div><label>Start date</label><input type="date" id="cd-start" value="${d.startDate}"></div>
              <div><label>End date</label><input type="date" id="cd-end" value="${d.endDate}"></div>
            </div>
            <label>Status</label>
            <select id="cd-status" class="select">
              ${["planned", "confirmed", "live", "complete"].map((s) => `<option value="${s}" ${s === d.status ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join("")}
            </select>
            <label>Notes</label>
            <textarea id="cd-notes">${esc(d.notes || "")}</textarea>
            <div class="modal-actions">
              <div>${isNew ? "" : '<button class="btn-secondary" id="cd-duplicate">Duplicate</button> <button class="btn-secondary" id="cd-delete">Delete</button>'}</div>
              <div><button class="btn-secondary" id="cd-cancel">Cancel</button> <button class="btn-primary" id="cd-save">Save</button></div>
            </div>
          </div></div>`;

        function updateLinkedPreview() {
          const b = bannerById(document.getElementById("cd-banner").value);
          const s = skuById(document.getElementById("cd-sku").value);
          const dtId = document.getElementById("cd-dealtype").value;
          const preview = document.getElementById("cd-linked-preview");
          if (!preview) return;
          if (!b || !s || !dtId) {
            preview.textContent = "Pick a banner, SKU and deal type to preview live figures.";
            return;
          }
          const disp = calDealDisplay({ linked: true, bannerId: b.id, skuId: s.id, dealTypeId: dtId });
          if (disp.pending) {
            preview.innerHTML = `<span style="color:var(--accent-warm-dark);">No price is set for "${esc(disp.promoName)}" on ${esc(s.name)} at ${esc(b.name)} yet — set it on the banner page, or link it anyway and come back once it's priced.</span>`;
          } else {
            preview.innerHTML = `= <b>${esc(disp.promoName)}</b> · Target ${disp.targetMarginPct != null ? fmtPct(disp.targetMarginPct) : "not set"} · Actual ${disp.actualMarginPct != null ? fmtPct(disp.actualMarginPct) : "—"}`;
          }
        }

        document.getElementById("cd-banner").addEventListener("change", (e) => {
          d.bannerId = e.target.value;
          d.dealTypeId = "";
          render();
        });
        document.getElementById("cd-sku").addEventListener("change", (e) => {
          d.skuId = e.target.value;
          updateLinkedPreview();
        });
        document.getElementById("cd-linked").addEventListener("change", (e) => {
          d.linked = e.target.checked;
          document.getElementById("cd-linked-fields").style.display = d.linked ? "" : "none";
          document.getElementById("cd-manual-fields").style.display = d.linked ? "none" : "";
          if (d.linked) updateLinkedPreview();
        });
        const dtSel = document.getElementById("cd-dealtype");
        if (dtSel) dtSel.addEventListener("change", updateLinkedPreview);
        if (d.linked) updateLinkedPreview();

        document.getElementById("cd-cancel").addEventListener("click", () => (modalRoot.innerHTML = ""));
        if (!isNew) {
          document.getElementById("cd-delete").addEventListener("click", () => {
            modalRoot.innerHTML = "";
            calDeleteDeal(d.id);
          });
          document.getElementById("cd-duplicate").addEventListener("click", () => {
            modalRoot.innerHTML = "";
            calDuplicateDeal(deal);
          });
        }
        document.getElementById("cd-save").addEventListener("click", async () => {
          const startDate = document.getElementById("cd-start").value;
          const endDate = document.getElementById("cd-end").value;
          if (!startDate || !endDate) {
            alert("Start and end dates are required.");
            return;
          }
          if (!calIsSaneDate(calParseDate(startDate)) || !calIsSaneDate(calParseDate(endDate))) {
            alert("One of these dates looks off — double check the year.");
            return;
          }
          if (calParseDate(endDate) <= calParseDate(startDate)) {
            alert("End date must be after start date.");
            return;
          }
          const linked = document.getElementById("cd-linked").checked;
          const newDeal = {
            id: d.id,
            bannerId: document.getElementById("cd-banner").value,
            skuId: document.getElementById("cd-sku").value,
            linked,
            cycleInstance: document.getElementById("cd-cycle").value.trim(),
            startDate,
            endDate,
            status: document.getElementById("cd-status").value,
            notes: document.getElementById("cd-notes").value,
          };
          if (linked) {
            const dealTypeId = document.getElementById("cd-dealtype").value;
            if (!dealTypeId) {
              alert("Pick a deal type, or untick “Link to this SKU's pricing sheet” to enter a manual promo name.");
              return;
            }
            newDeal.dealTypeId = dealTypeId;
            newDeal.promoName = null;
            newDeal.targetMarginPct = null;
            newDeal.actualMarginPct = null;
          } else {
            newDeal.dealTypeId = null;
            newDeal.promoName = document.getElementById("cd-promoname").value.trim() || "(untitled)";
            const t = document.getElementById("cd-target").value;
            const a = document.getElementById("cd-actual").value;
            newDeal.targetMarginPct = t === "" ? null : parseFloat(t) / 100;
            newDeal.actualMarginPct = a === "" ? null : parseFloat(a) / 100;
          }
          const idx = State.calendarDeals.findIndex((x) => x.id === newDeal.id);
          if (idx >= 0) State.calendarDeals[idx] = newDeal;
          else State.calendarDeals.push(newDeal);
          await DB.put("calendarDeals", newDeal);
          modalRoot.innerHTML = "";
          calRenderAll();
        });
      }
      render();
    }

    // ---------------- Wiring ----------------
    document.getElementById("cal-view-timeline").addEventListener("click", () => {
      calState.view = "timeline";
      document.getElementById("cal-view-timeline").classList.add("active");
      document.getElementById("cal-view-table").classList.remove("active");
      document.getElementById("cal-timeline-view").style.display = "";
      document.getElementById("cal-table-view").style.display = "none";
      calRenderAll();
    });
    document.getElementById("cal-view-table").addEventListener("click", () => {
      calState.view = "table";
      document.getElementById("cal-view-table").classList.add("active");
      document.getElementById("cal-view-timeline").classList.remove("active");
      document.getElementById("cal-timeline-view").style.display = "none";
      document.getElementById("cal-table-view").style.display = "";
      calRenderAll();
    });
    document.getElementById("cal-add-deal").addEventListener("click", () => calOpenDealModal(null));
    document.getElementById("cal-filter-banner").addEventListener("change", (e) => {
      calState.filters.bannerId = e.target.value;
      calRenderAll();
    });
    document.getElementById("cal-filter-sku").addEventListener("change", (e) => {
      calState.filters.skuId = e.target.value;
      calRenderAll();
    });
    document.getElementById("cal-filter-status").addEventListener("change", (e) => {
      calState.filters.status = e.target.value;
      calRenderAll();
    });
    document.getElementById("cal-filter-search").addEventListener("input", (e) => {
      calState.filters.search = e.target.value;
      calRenderAll();
    });
    function calScrollToToday(leadInPx) {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      const offset = calDiffDays(rangeStart, t) * pxPerDay;
      document.getElementById("cal-gantt-scroll").scrollLeft = Math.max(offset - (leadInPx != null ? leadInPx : 200), 0);
    }
    function calSetZoomActive() {
      document.querySelectorAll(".cal-zoom-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.zoom === calState.zoom));
    }
    document.querySelectorAll(".cal-zoom-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        calState.zoom = btn.dataset.zoom;
        calRenderTimeline();
        calSetZoomActive();
        // "6 Months" is meant for forward planning, so line the view up on
        // today with a small lead-in rather than leaving it wherever the
        // scroll position happened to be at the old zoom level.
        if (calState.zoom === "half") calScrollToToday(40);
      });
    });
    calSetZoomActive();
    document.getElementById("cal-scroll-today").addEventListener("click", () => calScrollToToday(200));
    document.getElementById("cal-gantt-scroll").addEventListener("scroll", function () {
      document.getElementById("cal-frozen-inner").style.transform = "translateY(-" + this.scrollTop + "px)";
    });
    document.getElementById("cal-frozen-viewport").addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        document.getElementById("cal-gantt-scroll").scrollTop += e.deltaY;
      },
      { passive: false }
    );
    document.querySelectorAll('#cal-table-view thead th[data-sort]').forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (calState.sort.key === key) calState.sort.dir *= -1;
        else {
          calState.sort.key = key;
          calState.sort.dir = 1;
        }
        calRenderTable();
      });
    });

    calRenderAll();
    setTimeout(() => {
      const btn = document.getElementById("cal-scroll-today");
      if (btn) btn.click();
    }, 50);
  });

  // ------------------------------------------------------------ Data / Settings
  route("data", async (rest, main) => {
    main.innerHTML = `
      <div class="page-header"><h1>Data &amp; backup</h1></div>
      <div class="card">
        <h3>Export</h3>
        <p class="muted">Download a full backup of all SKUs, COGS history, banner terms, and pricing history as JSON. Do this before big changes, and keep copies over time.</p>
        <button class="btn-primary" id="export-btn">Export JSON</button>
      </div>
      <div class="card">
        <h3>Import</h3>
        <p class="muted">Load a previously exported JSON file. "Merge" adds to existing data; "Replace" wipes the database first.</p>
        <input type="file" id="import-file" accept="application/json">
        <label><input type="radio" name="import-mode" value="merge" checked> Merge</label>
        <label><input type="radio" name="import-mode" value="replace"> Replace everything</label>
        <button class="btn-primary" id="import-btn">Import</button>
        <div id="import-status"></div>
      </div>
      <div class="card">
        <h3>Reset</h3>
        <p class="muted">Wipe all data and reload the original sample dataset (extracted from the uploaded workbook).</p>
        <button class="btn-secondary" id="reset-btn">Reset to sample data</button>
      </div>
    `;
    document.getElementById("export-btn").onclick = async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ym-beer-pricing-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    };
    document.getElementById("import-btn").onclick = async () => {
      const file = document.getElementById("import-file").files[0];
      const status = document.getElementById("import-status");
      if (!file) {
        status.textContent = "Choose a file first.";
        return;
      }
      const mode = document.querySelector('input[name="import-mode"]:checked').value;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await DB.importAll(data, mode);
        status.textContent = "Import complete. Reloading…";
        setTimeout(() => window.location.reload(), 800);
      } catch (err) {
        status.textContent = "Import failed: " + err.message;
      }
    };
    document.getElementById("reset-btn").onclick = async () => {
      if (!confirm("This will erase all current data and reload the sample dataset. Continue?")) return;
      await DB.setMeta("seeded", false);
      for (const s of ["skus", "cogsHistory", "bannerGroups", "banners", "bannerTermsHistory", "pricingHistory", "calendarDeals", "distributorPricing"]) {
        await DB.clearStore(s);
      }
      await DB.seedIfEmpty();
      window.location.reload();
    };
  });

  // ------------------------------------------------------------ Boot
  async function boot() {
    await DB.open();
    await DB.seedIfEmpty();
    const [skus, cogsHistory, bannerGroups, banners, bannerTermsHistory, pricingHistory, calendarDeals, distributorPricing, periods, currentPeriod] = await Promise.all([
      DB.getAll("skus"),
      DB.getAll("cogsHistory"),
      DB.getAll("bannerGroups"),
      DB.getAll("banners"),
      DB.getAll("bannerTermsHistory"),
      DB.getAll("pricingHistory"),
      DB.getAll("calendarDeals"),
      DB.getAll("distributorPricing"),
      DB.getMeta("periods"),
      DB.getMeta("currentPeriod"),
    ]);
    Object.assign(State, { skus, cogsHistory, bannerGroups, banners, bannerTermsHistory, pricingHistory, calendarDeals, distributorPricing, periods, currentPeriod });
    State.viewPeriod = currentPeriod;

    const nav = document.getElementById("nav-links");
    const groupLinks = State.bannerGroups.map((g) => `<a class="nav-link" data-route="banner" href="#/banner/${g.id}">${esc(g.shortName)}</a>`).join("");
    nav.innerHTML = `
      <a class="nav-link" data-route="dashboard" href="#/dashboard">Dashboard</a>
      <a class="nav-link" data-route="cogs" href="#/cogs">COGS Master</a>
      <a class="nav-link" data-route="sku-tool" href="#/sku-tool">SKU Tool</a>
      ${groupLinks}
      <a class="nav-link" data-route="compare" href="#/compare">Compare SKUs</a>
      <a class="nav-link" data-route="trends" href="#/trends">Trends</a>
      <a class="nav-link" data-route="calendar" href="#/calendar">Promo Calendar</a>
      <a class="nav-link" data-route="cpi-update" href="#/cpi-update">CPI Update</a>
      <a class="nav-link" data-route="data" href="#/data">Data &amp; Backup</a>
    `;

    window.addEventListener("hashchange", onHashChange);
    onHashChange();
  }

  return { boot };
})();

window.addEventListener("DOMContentLoaded", () => App.boot());
