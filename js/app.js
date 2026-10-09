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
    // A deal built on a SKU card carries its own name and pack format.
    if (deal.packFormat) return { packType: deal.packFormat, dealType: deal.dealType || (dt && dt.dealType) || "promo", label: deal.label || (dt && dt.label) || "", defaultPackQty: deal.packQty || (dt && dt.defaultPackQty) || 1 };
    if (dt) return { packType: dt.packType, dealType: dt.dealType, label: dt.label, defaultPackQty: dt.defaultPackQty };
    // fallback inference for custom/legacy deals
    const label = deal.label || "";
    const packType = /carton/i.test(label) ? "carton" : /2 ?for ?\$/i.test(label) ? "2for$" : "multipack";
    const dealType = deal.dealType === "everyday" ? "everyday" : "promo";
    return { packType, dealType, label, defaultPackQty: deal.packQty || 1 };
  }

  const PACK_FORMATS = [
    { id: "single", label: "Single", tag: "SGL" },
    { id: "multipack", label: "Multipack", tag: "MPK" },
    { id: "twofor", label: "2 for $X (2 multipacks)", tag: "2 FOR" },
    { id: "carton", label: "Carton", tag: "CAR" },
    { id: "cartonfree", label: "Carton + free pack", tag: "CAR+FREE" },
  ];
  function dealPackFormat(banner, deal) {
    if (deal.packFormat) return deal.packFormat;
    const t = dealMeta(banner, deal).packType;
    return t === "carton" || t === "cartonfree" || t === "twofor" ? t : t === "single" ? "single" : "multipack";
  }
  /** Shelf units per carton: carton=1, single=every unit, multipack=carton / units-per-pack. */
  function packQtyFor(sku, format, packUnits) {
    const upc = (sku && sku.unitsPerCarton) || 16;
    if (format === "carton" || format === "cartonfree") return 1;
    if (format === "single") return upc;
    return upc / (packUnits || 4);
  }

  /** Full computed metrics for a single deal line, using live COGS + banner terms. */
  function computeDeal(sku, banner, pricingRow, deal, asOfPeriod) {
    const cogs = latestCogs(sku.id, asOfPeriod);
    const terms = latestBannerTerms(banner.id, asOfPeriod);
    const meta = dealMeta(banner, deal);
    // Target margin lives on the deal itself; banner-level targets are only a fallback for older deals.
    const targetPct = deal.targetPct != null ? deal.targetPct : targetMarginForDealType(terms, deal.dealTypeId);
    const listPrice = effectiveListPrice(sku, banner, asOfPeriod, pricingRow);
    const result = Calc.evaluateDeal({
      listPrice,
      discountPerCarton: deal.discountPerCarton || 0,
      feeWaterfall: terms ? terms.feeWaterfall : [],
      distributorFeePct: terms ? terms.distributorFeePct : 0,
      scanDeal: deal.scanDeal || 0,
      // 2 for $X: the price entered is for the pair of packs, so each pack sells at half of it
      shelfRRP: deal.packFormat === "twofor" && deal.shelfRRP != null ? deal.shelfRRP / 2 : deal.shelfRRP,
      cogs: cogs ? { productCogs: cogs.productCogs } : { productCogs: 0 },
      bannerTerms: terms || {},
      targetMarginPct: targetPct,
      packQty: deal.packFormat === "twofor" ? packQtyFor(sku, "twofor", deal.packUnits) : deal.packQty || meta.defaultPackQty || 1,
      gstRate: GST_RATE,
    });
    // Carton + free pack: YM gives extra units away at no charge, so the banner's margin is
    // unchanged but YM carries the landed cost of those units.
    if (deal.packFormat === "cartonfree") {
      const upc = (sku && sku.unitsPerCarton) || 16;
      const freeUnits = deal.packUnits || 4;
      const freeCost = (result.cost.total / upc) * freeUnits;
      result.cost = Object.assign({}, result.cost, { total: result.cost.total + freeCost, freeGoods: freeCost });
      result.profit = Math.round((result.ymNetDeal - result.cost.total) * 100) / 100;
      result.gpPct = result.ymNetDeal !== 0 ? result.profit / result.ymNetDeal : null;
    }
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
    const activeBanner = base === "banner" ? (State.banners.find((b) => b.id === (rest[1] || rest[0])) || (State.banners.find((b) => b.groupId === rest[0]) || {})).id : null;
    document.querySelectorAll(".banner-tab").forEach((a) => a.classList.toggle("active", a.dataset.banner === activeBanner));
    const main = document.getElementById("main");
    main.classList.toggle("wide", base === "banner");
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
    // One tab per banner: #/banner/<bannerId>. Older links of the form
    // #/banner/<groupId>[/<bannerId>] still resolve.
    let banner = State.banners.find((b) => b.id === (rest[1] || rest[0]));
    if (!banner) {
      const g = State.bannerGroups.find((x) => x.id === rest[0]);
      banner = g ? State.banners.find((b) => b.groupId === g.id) : State.banners[0];
    }
    if (!banner) {
      main.innerHTML = `<div class="card">Unknown banner.</div>`;
      return;
    }
    const period = State.viewPeriod;
    const terms = latestBannerTerms(banner.id, period);

    const allPriced = State.skus.map((sku) => ({ sku, pricing: latestPricing(sku.id, banner.id, period) })).filter((r) => r.pricing);
    const skuRows = allPriced.filter((r) => isSkuRanged(banner, r.sku.id));
    const skusWithoutPricing = State.skus.filter((s) => !allPriced.find((r) => r.sku.id === s.id));
    const rangingChips = State.skus
      .map((s) => `<button class="rng-chip ${isSkuRanged(banner, s.id) ? "on" : ""}" data-sku="${s.id}" title="Click to ${isSkuRanged(banner, s.id) ? "remove from" : "add to"} this banner's range">${isSkuRanged(banner, s.id) ? "✓" : "+"} ${esc(s.name)} <span class="muted small">${esc(s.packFormat || "")}</span></button>`)
      .join("");

    main.innerHTML = `
      <div class="page-header">
        <h1>${badgeHTML(banner, "lg")}${esc(banner.name)}${banner.ownerBannerId ? ` <span class="muted small" style="font-weight:500;">owned by ${esc((State.banners.find((x) => x.id === banner.ownerBannerId) || {}).name || "")}</span>` : ""}</h1>
        <div class="period-control">Viewing: ${periodSelectorHTML(period)}</div>
      </div>

      <div class="card">
        <div class="card-header-row"><h3>Ranging <span class="muted small">— switch SKUs on or off for ${esc(banner.name)}</span></h3></div>
        <div class="rng-chips">${rangingChips}</div>
      </div>

      <div class="card">
        <div class="card-header-row"><h3>Promo timeline</h3></div>
        <div id="promo-planner"></div>
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
        ${skuRows.map(({ sku, pricing }) => skuCardHTML(sku, banner, pricing, period)).join("") || '<p class="muted">No ranged SKUs are priced for this banner yet. Switch SKUs on above, or use the dropdown to add one.</p>'}
      </div>

      <div class="grid-2" style="margin-top:20px;">
        <div class="card">
          <div class="card-header-row"><h3>Banner terms <span class="muted small">(all % based)</span></h3><button class="btn-sm" id="edit-terms">Edit / new period</button></div>
          ${renderTermsSummary(terms)}
        </div>
        <div class="card">
          <div class="card-header-row"><h3>Target margins</h3><button class="btn-sm" id="manage-deal-types">Manage deal types</button></div>
          ${renderTargetMargins(terms, banner)}
        </div>
      </div>
      <div id="modal-root"></div>
    `;

    attachPeriodSelector(main);
    main.querySelectorAll(".rng-chip").forEach((chip) =>
      chip.addEventListener("click", async () => {
        const id = chip.dataset.sku;
        const un = (banner.unrangedSkuIds || []).slice();
        const i = un.indexOf(id);
        if (i === -1) un.push(id);
        else un.splice(i, 1);
        banner.unrangedSkuIds = un;
        await DB.put("banners", banner);
        onHashChange();
      })
    );
    document.getElementById("edit-terms").addEventListener("click", () => openEditTermsModal(banner));
    document.getElementById("manage-deal-types").addEventListener("click", () => openDealTypesModal(banner));
    document.getElementById("add-sku-select").addEventListener("change", (e) => {
      if (!e.target.value) return;
      addSkuCard(e.target.value, banner, period);
      e.target.value = "";
    });
    skuRows.forEach(({ sku, pricing }) => wireSkuCard(sku, banner, pricing, period));
    await renderPromoPlanner(banner, document.getElementById("promo-planner"));
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
            <option value="__custom">Custom deal (name it yourself)</option>
            ${(banner.dealTypes || []).map((dt) => `<option value="${dt.id}">${esc(dt.label)} — template</option>`).join("")}
          </select>
        </div>
      </div>`;
  }

  // A deal within 1 percentage point of its target isn't failing outright —
  // it's close enough that a small price/discount/scan-deal push should get
  // it there, so it gets its own amber "near target" state instead of
  // reading the same as a deal that's genuinely well short.
  const NEAR_TARGET_GAP = 0.015; // 1.5 percentage points
  // gapText is the signed distance from target in percentage points
  // (e.g. "+0.3pt" or "-0.9pt") — showing the gap directly means you don't
  // have to mentally subtract Margin from Target to see how close a deal
  // is, which is the whole point when scanning a list of deals at once.
  function fmtGapPt(deltaFraction) {
    const pts = deltaFraction * 100;
    const sign = pts > 0 ? "+" : "";
    return `${sign}${pts.toFixed(1)}pt`;
  }
  function dealStatusInfo(m) {
    if (m.targetMarginPct == null || m.bannerMarginPct == null) return { text: "No target set", cls: "muted", gapText: "No target", gapCls: "muted" };
    const delta = m.bannerMarginPct - m.targetMarginPct; // positive = above target (good)
    if (m.meetsTarget) return { text: "✓ Meets target", cls: "pos", gapText: fmtGapPt(delta), gapCls: "pos" };
    const gap = -delta; // positive = short of target
    if (gap <= NEAR_TARGET_GAP + 1e-9) return { text: "⚠ Near target — push pricing", cls: "warn", gapText: fmtGapPt(delta), gapCls: "warn" };
    return { text: "✗ Below target", cls: "neg", gapText: fmtGapPt(delta), gapCls: "neg" };
  }

  // Deal rows are grid rows so name, Shelf RRP, Discount, Margin, Target
  // and the gap-to-target chip all line up in columns — that's what makes
  // scanning down a list of deals and comparing them against each other
  // fast, instead of having to read each card's prose individually. Status
  // is a small colored dot (the legend above explains the colors) rather
  // than a repeated text pill. Only Scan Deal and the $ breakdown (YM Net,
  // COGS, Profit, GP%) are behind the chevron toggle — everything you'd
  // want for a quick "is this deal okay?" check is visible without opening
  // a row.
  function dealRowHTML(sku, banner, pricing, deal, i, period) {
    const m = computeDeal(sku, banner, pricing, deal, period);
    const status = dealStatusInfo(m);
    const fmtSel = dealPackFormat(banner, deal);
    const packUnits = deal.packUnits || (deal.packQty ? Math.round(((sku.unitsPerCarton || 16) / deal.packQty) * 100) / 100 : 4);
    const targetShown = m.targetMarginPct != null ? Math.round(m.targetMarginPct * 10000) / 100 : "";
    return `<div class="deal-row" data-i="${i}">
      <div class="deal-row-grid">
        <div class="deal-name-cell">
          <span class="deal-dot ${status.cls}" title="${esc(status.text)}"></span>
          <input type="text" class="name-input" value="${esc(deal.label || "")}" placeholder="Deal name" title="Deal name — shown on the promo timeline">
        </div>
        <div class="deal-mini">
          <span class="deal-mini-label">Format</span>
          <select class="format-select">${PACK_FORMATS.map((f) => `<option value="${f.id}" ${f.id === fmtSel ? "selected" : ""}>${f.label}</option>`).join("")}</select>
        </div>
        <div class="deal-mini">
          <span class="deal-mini-label" title="Shelf RRP (inc GST)">Shelf RRP</span>
          <input type="number" step="0.01" class="rrp-input" value="${deal.shelfRRP}">
        </div>
        <div class="deal-mini">
          <span class="deal-mini-label" title="Discount $/carton">Discount $</span>
          <input type="number" step="0.01" class="discount-input" value="${deal.discountPerCarton || 0}">
        </div>
        <div class="deal-mini deal-mini-readout">
          <span class="deal-mini-label">Margin</span>
          <strong class="out-margin">${fmtPct(m.bannerMarginPct)}</strong>
        </div>
        <div class="deal-mini">
          <span class="deal-mini-label">Target %</span>
          <input type="number" step="0.1" class="target-input" value="${targetShown}" placeholder="—">
        </div>
        <span class="deal-chip out-status ${status.gapCls}" title="vs target">${status.gapText}</span>
        <button class="btn-xs deal-expand-btn" aria-expanded="false" aria-label="Show deal details">▾</button>
      </div>
      <div class="deal-row-detail">
        <label class="deal-inline packunits-wrap" title="Units in each multipack (e.g. 4 for a 4-pack, 6 for a 6-pack)">Units per pack / free units<input type="number" step="1" min="1" class="packunits-input" value="${packUnits}" ${fmtSel === "multipack" || fmtSel === "twofor" || fmtSel === "cartonfree" ? "" : "disabled"}></label>
        <label class="deal-inline">Scan $/unit<input type="number" step="0.01" class="scan-input" value="${deal.scanDeal || 0}"></label>
        <span>YM Net <strong class="out-net">${fmt$(m.ymNetDeal)}</strong></span>
        <span>YM COGS <strong class="out-cogs">${fmt$(m.cost.total)}</strong></span>
        <span>Profit <strong class="out-profit ${m.profit >= 0 ? "pos" : "neg"}">${fmt$(m.profit)}</strong></span>
        <span>YM GP% <strong class="out-gp">${fmtPct(m.gpPct)}</strong></span>
        <button class="btn-xs btn-fill-scan" title="Fill in the scan deal needed to hit target">Fill scan deal</button>
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
      deal.label = row.querySelector(".name-input").value;
      const fmtSelEl = row.querySelector(".format-select");
      const puEl = row.querySelector(".packunits-input");
      puEl.disabled = !["multipack", "twofor", "cartonfree"].includes(fmtSelEl.value);
      deal.packFormat = fmtSelEl.value;
      deal.packUnits = parseFloat(puEl.value) || 4;
      deal.packQty = packQtyFor(sku, deal.packFormat, deal.packUnits);
      const tgtRaw = row.querySelector(".target-input").value;
      deal.targetPct = tgtRaw === "" ? null : parseFloat(tgtRaw) / 100;
      const tempPricing = { listPrice, deals: cardEl._deals };
      const m = computeDeal(sku, banner, tempPricing, deal, period);
      row.querySelector(".out-net").textContent = fmt$(m.ymNetDeal);
      row.querySelector(".out-cogs").textContent = fmt$(m.cost.total);
      const profitCell = row.querySelector(".out-profit");
      profitCell.textContent = fmt$(m.profit);
      profitCell.className = "out-profit " + (m.profit >= 0 ? "pos" : "neg");
      row.querySelector(".out-gp").textContent = fmtPct(m.gpPct);
      row.querySelector(".out-margin").textContent = fmtPct(m.bannerMarginPct);
      const status = dealStatusInfo(m);
      const dot = row.querySelector(".deal-dot");
      dot.className = "deal-dot " + status.cls;
      dot.title = status.text;
      const statusCell = row.querySelector(".out-status");
      statusCell.textContent = status.gapText;
      statusCell.className = "deal-chip out-status " + status.gapCls;
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
      if (["rrp-input", "discount-input", "scan-input", "name-input", "target-input", "packunits-input"].some((c) => e.target.classList.contains(c))) recalc();
    });
    cardEl.addEventListener("change", (e) => {
      if (e.target.classList.contains("format-select")) {
        const row = e.target.closest(".deal-row");
        const pu = row.querySelector(".packunits-input");
        // switching to multipack: start from a sensible pack size rather than the carton count
        if ((e.target.value === "multipack" || e.target.value === "twofor" || e.target.value === "cartonfree") && (parseFloat(pu.value) || 0) >= (sku.unitsPerCarton || 16)) pu.value = 4;
        recalc();
      }
    });
    cardEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("deal-expand-btn")) {
        const row = e.target.closest(".deal-row");
        const expanded = row.classList.toggle("expanded");
        e.target.setAttribute("aria-expanded", expanded ? "true" : "false");
        e.target.textContent = expanded ? "▴" : "▾";
      }
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
      const terms = latestBannerTerms(banner.id, period);
      let nd;
      if (dtId === "__custom") {
        nd = { dealTypeId: "custom-" + uid(), label: "New deal", dealType: "promo", packFormat: "multipack", packUnits: 4, packQty: packQtyFor(sku, "multipack", 4), shelfRRP: 0, discountPerCarton: 0, scanDeal: 0, targetPct: null };
      } else {
        const dt = (banner.dealTypes || []).find((d) => d.id === dtId);
        if (!dt) return;
        const fmt = dt.packType === "carton" ? "carton" : "multipack";
        nd = { dealTypeId: dt.id, label: dt.label, dealType: dt.dealType, packFormat: fmt, packUnits: 4, packQty: dt.defaultPackQty, shelfRRP: 0, discountPerCarton: 0, scanDeal: 0, targetPct: targetMarginForDealType(terms, dt.id) };
      }
      cardEl._deals.push(nd);
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
  /** ISO yyyy-mm-dd -> Australian d/m/yyyy (or d/m/yy when short). */
  function fmtDMY(iso, short) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return iso || "";
    return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${short ? m[1].slice(2) : m[1]}`;
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
    const pr = latestPricing(sku.id, banner.id, null); // always the latest period — this is what makes it "live"
    const dealRow = pr ? pr.deals.find((d) => d.dealTypeId === entry.dealTypeId) : null;
    const label = entry.promoName || (dealRow && dealRow.label) || (dt ? dt.label : "(deal removed)");
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
      scanDeal: dealRow.scanDeal || 0,
      packFormat: dealPackFormat(banner, dealRow),
      packUnits: dealRow.packUnits || null,
      dealLabel: dealRow.label || (dt ? dt.label : ""),
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

  // ------------------------------------------------------------ Per-banner promo planner
  // Every banner tab embeds its own planner: a period grid (SKU rows x promo
  // period columns, same layout as the retailer slotting sheets) plus a Table
  // view. Nothing here is shared across banners.
  function isSkuRanged(banner, skuId) {
    return (banner.unrangedSkuIds || []).indexOf(skuId) === -1;
  }

  async function renderPromoPlanner(banner, host) {
    const calState = { view: "grid", range: "upcoming", filters: { skuId: "all", status: "all", search: "" }, sort: { key: "startDate", dir: 1 } };
    const rangedSkus = calOrderedSkus().filter((s) => isSkuRanged(banner, s.id));

    function calFilteredDeals() {
      return State.calendarDeals.filter((d) => {
        if (d.bannerId !== banner.id) return false;
        if (!isSkuRanged(banner, d.skuId)) return false;
        if (calState.filters.skuId !== "all" && d.skuId !== calState.filters.skuId) return false;
        if (calState.filters.status !== "all" && d.status !== calState.filters.status) return false;
        if (calState.filters.search) {
          const disp = calDealDisplay(d);
          const sku = skuById(d.skuId);
          const q = calState.filters.search.toLowerCase();
          const hay = ((sku ? sku.name : "") + " " + disp.promoName + " " + (d.cycleInstance || "") + " " + (d.notes || "")).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
    }

    host.innerHTML = `
      <div class="cal-toolbar-row">
        <div class="cal-view-toggle">
          <button id="cal-view-grid" class="btn-sm active">Timeline</button>
          <button id="cal-view-table" class="btn-sm">Table</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="pg-range" class="select" style="width:auto;">
            <option value="upcoming">Table: next 6 months</option>
            <option value="past">Table: past</option>
            <option value="all">Table: all dates</option>
          </select>
          <button class="btn-primary btn-sm" id="cal-add-deal">+ Add deal</button>
        </div>
      </div>
      <div class="cal-filters">
        <div><label>SKU</label><select id="cal-filter-sku" class="select"><option value="all">All SKUs</option>${rangedSkus.map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(s.packFormat || "")}</option>`).join("")}</select></div>
        <div><label>Status</label><select id="cal-filter-status" class="select">
          <option value="all">All statuses</option><option value="planned">Planned</option><option value="confirmed">Confirmed</option><option value="live">Live</option><option value="complete">Complete</option>
        </select></div>
        <div><label>Search</label><input type="text" id="cal-filter-search" placeholder="SKU, promo or note"></div>
        <div class="cal-legend">
          <span><span class="cal-dot" style="background:var(--pos)"></span>Meeting target</span>
          <span><span class="cal-dot" style="background:var(--neg)"></span>Below target</span>
          <span><span class="cal-dot" style="background:var(--accent-warm)"></span>Not priced yet</span>
        </div>
      </div>
      <div id="pg-grid-view">
        <div class="pg-legend">
          <span><i class="pg-swatch pg-sgl"></i>Single</span>
          <span><i class="pg-swatch pg-mpk"></i>Multipack</span>
          <span><i class="pg-swatch pg-car"></i>Carton</span>
          <span><i class="pg-swatch pg-oth"></i>Other mechanic</span>
          <span><i class="pg-swatch pg-flagsw"></i>Catalogue / off-location</span>
          <span class="muted small">Promo price shown; scan deal beneath. Click a cell to open it, click a blank cell to add a deal.</span>
        </div>
        <div class="pg-nav">
          <button class="btn-sm" id="pg-prev">◀ Earlier</button>
          <button class="btn-sm" id="pg-today">Today</button>
          <button class="btn-sm" id="pg-next">Later ▶</button>
          <button class="btn-sm" id="pg-notes-toggle">Hide meeting notes</button>
          <span class="muted small">Showing ~6 months at a time — scroll sideways (or use the buttons) to see the past and future.</span>
        </div>
        <div id="pg-grid-wrap" class="pg-wrap"></div>
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
    `;

    function calRenderAll() {
      if (calState.view === "grid") calRenderGrid();
      else calRenderTable();
    }

    // ---------------- Period grid ----------------
    function pgMoney(re, text) {
      const m = re.exec(text || "");
      return m ? parseFloat(m[1]) : null;
    }
    function pgDeal(d) {
      const disp = calDealDisplay(d);
      const dt = d.linked ? (banner.dealTypes || []).find((x) => x.id === d.dealTypeId) : null;
      const hint = (dt && dt.packType) || d.packHint || "";
      const name = disp.promoName || "";
      const notes = d.notes || "";
      let kind = "oth",
        tag = "";
      const uom = /UOM:\s*(\w+)/i.exec(notes);
      const t1 = (d.linked && disp.packFormat ? disp.packFormat : hint) + " " + (uom ? uom[1] : "");
      if (/twofor/i.test(t1)) {
        kind = "mpk";
        tag = "2 FOR";
      } else if (/cartonfree/i.test(t1)) {
        kind = "car";
        tag = "CAR + FREE " + (d.linked && disp.packUnits ? disp.packUnits + "PK" : "PACK");
      } else if (/single/i.test(t1)) {
        kind = "sgl";
        tag = "SGL";
      } else if (/multipack|mpk|pack/i.test(t1)) {
        kind = "mpk";
        tag = "MPK";
      } else if (/carton|ctn/i.test(t1)) {
        kind = "car";
        tag = "CAR";
      } else if (/2for/i.test(t1) || /\d\s*for\s*\$/i.test(name)) {
        tag = "2 FOR";
      } else if (/carton|ctn/i.test(name)) {
        kind = "car";
        tag = "CAR";
      } else if (/\d\s*-?\s*pack|\dpk|mpk/i.test(name)) {
        kind = "mpk";
        tag = "MPK";
      }
      let price = null,
        priceFromName = false;
      if (d.linked) price = disp.shelfRRP != null ? disp.shelfRRP : null;
      else {
        price = pgMoney(/Promo price:\s*\$([\d.]+)/i, notes);
        if (price == null && !/\d\s*for\s*\$/i.test(name)) {
          price = pgMoney(/\$([\d.]+)/, name);
          priceFromName = price != null;
        }
      }
      let scan = d.linked ? disp.scanDeal : pgMoney(/Promo scan deal:\s*\$([\d.]+)/i, notes);
      if (scan == null && !d.linked) scan = pgMoney(/scan[^$|]*\$([\d.]+)/i, notes);
      const flagText = /catalog/i.test(name + " " + notes) ? "Catalogue" : /off[\s-]?location/i.test(name + " " + notes) ? "Off location" : "";
      const noteShow = notes && notes.length <= 70 && !/^UOM:|^Placeholder from/i.test(notes) ? notes : "";
      const stats = disp.actualMarginPct != null ? `${fmtPct(disp.actualMarginPct)}${disp.targetMarginPct != null ? " / " + fmtPct(disp.targetMarginPct) : ""}` : disp.targetMarginPct != null ? `tgt ${fmtPct(disp.targetMarginPct)}` : "";
      const dealLabel = d.linked && disp.dealLabel && disp.dealLabel !== disp.promoName ? disp.dealLabel : "";
      return { d, disp, kind, tag, dealLabel, price, priceFromName, scan, flagText, noteShow, name, stats };
    }
    function pgOverlap(s1, e1, s2, e2) {
      const a = s1 > s2 ? s1 : s2,
        b = e1 < e2 ? e1 : e2;
      return Math.max(calDiffDays(a, b) + 1, 0);
    }
    // Columns come from the banner's official promo calendar when there is
    // one (e.g. Star Liquor's fortnightly P-periods); otherwise they're built
    // from the deals' own dates (start/end within 3 days share a column).
    function pgColumns(deals) {
      const defined = banner.promoPeriods || (window.BANNER_CALENDARS || {})[banner.id];
      const cols = [];
      if (defined) {
        defined.forEach((p) => cols.push({ start: calParseDate(p.start), end: calParseDate(p.end), label: p.id, note: p.note || "", beer: !!p.beer, deals: [] }));
      }
      const extra = [];
      deals
        .slice()
        .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.endDate < b.endDate ? -1 : 1))
        .forEach((d) => {
          const s = calParseDate(d.startDate),
            e = calParseDate(d.endDate);
          if (!calIsSaneDate(s) || !calIsSaneDate(e)) return;
          if (defined && cols.some((c) => pgOverlap(s, e, c.start, c.end) > 0)) return;
          let col = extra.find((c) => Math.abs(calDiffDays(c.start, s)) <= 3 && Math.abs(calDiffDays(c.end, e)) <= 3);
          if (!col) {
            col = { start: s, end: e, label: "", note: "", beer: false, deals: [] };
            extra.push(col);
          }
        });
      return cols.concat(extra).sort((a, b) => a.start - b.start);
    }
    function pgSpan(d, cols) {
      const s = calParseDate(d.startDate),
        e = calParseDate(d.endDate);
      const len = calDiffDays(s, e) + 1;
      const need = Math.min(4, len);
      let idxs = [];
      cols.forEach((c, i) => {
        const o = pgOverlap(s, e, c.start, c.end);
        if (o >= need) idxs.push(i);
      });
      if (!idxs.length) {
        let best = -1,
          bo = 0;
        cols.forEach((c, i) => {
          const o = pgOverlap(s, e, c.start, c.end);
          if (o > bo) {
            bo = o;
            best = i;
          }
        });
        if (best < 0) return null;
        idxs = [best];
      }
      return [idxs[0], idxs[idxs.length - 1]];
    }
    function pgRangeLabel(s, e) {
      const sm = s.toLocaleDateString("en-AU", { month: "short" }),
        em = e.toLocaleDateString("en-AU", { month: "short" });
      return sm === em && s.getFullYear() === e.getFullYear() ? `${s.getDate()}–${e.getDate()} ${sm}` : `${s.getDate()} ${sm}–${e.getDate()} ${em}`;
    }
    function updateNotesBtn() {
      const btn = document.getElementById("pg-notes-toggle");
      if (!btn) return;
      const n = Object.keys(banner.plannerNotes || {}).length;
      btn.textContent = (banner.notesHidden ? "Show meeting notes" : "Hide meeting notes") + (n ? ` (${n})` : "");
    }
    function calRenderGrid() {
      const wrap = document.getElementById("pg-grid-wrap");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const winStart = new Date(2000, 0, 1),
        winEnd = new Date(2100, 0, 1);
      const deals = calFilteredDeals().filter((d) => {
        const s = calParseDate(d.startDate),
          e = calParseDate(d.endDate);
        return calIsSaneDate(s) && calIsSaneDate(e) && e >= winStart && s <= winEnd;
      });
      let cols = pgColumns(deals).filter((c) => c.end >= winStart && c.start <= winEnd);
      if (cols.length === 0) {
        wrap.innerHTML = '<p class="muted" style="padding:24px;text-align:center;">No promos in this window. Use "+ Add deal", or switch the date range.</p>';
        return;
      }
      const skuIds = [];
      deals.forEach((d) => skuIds.indexOf(d.skuId) === -1 && skuIds.push(d.skuId));
      rangedSkus.forEach((s) => {
        if (skuIds.indexOf(s.id) === -1 && latestPricing(s.id, banner.id, null) && (calState.filters.skuId === "all" || calState.filters.skuId === s.id)) skuIds.push(s.id);
      });
      const skus = calOrderedSkus().filter((s) => skuIds.indexOf(s.id) !== -1);
      const N = cols.length;
      // Fixed column width sized so ~6 months fit in view; the rest scrolls sideways.
      const avgDays = Math.max(7, cols.reduce((t, c) => t + calDiffDays(c.start, c.end) + 1, 0) / N);
      const perView = Math.max(1, Math.round(183 / avgDays));
      const availW = (wrap.clientWidth || 1300) - 128;
      const colW = Math.max(86, Math.floor(availW / perView));
      calState.colW = colW;
      const prevScroll = calState.scrollLeft;
      let html = `<div class="pg-grid" style="grid-template-columns:128px repeat(${N}, ${colW}px);">`;
      html += '<div class="pg-corner" style="grid-row:1;grid-column:1;">SKU</div>';
      cols.forEach((c, i) => {
        const isNow = c.start <= today && c.end >= today;
        let cycLabel = c.label;
        if (!cycLabel) {
          const cyc = {};
          deals.forEach((d) => pgOverlap(calParseDate(d.startDate), calParseDate(d.endDate), c.start, c.end) > 0 && d.cycleInstance && (cyc[d.cycleInstance] = (cyc[d.cycleInstance] || 0) + 1));
          cycLabel = Object.keys(cyc).sort((a, b) => cyc[b] - cyc[a])[0] || "";
        }
        const month = c.note ? c.note.toUpperCase() : c.start.toLocaleDateString("en-AU", { month: "long" }).toUpperCase();
        html += `<div class="pg-colhead${isNow ? " pg-now" : ""}${c.beer ? " pg-beer" : ""}" style="grid-row:1;grid-column:${i + 2};"><div class="pg-cyc">${esc(cycLabel) || "&nbsp;"}${c.beer ? ' <span class="pg-beertag">BEER</span>' : ""}</div><div class="pg-dates">${pgRangeLabel(c.start, c.end)}</div><div class="pg-month">${esc(month)}${isNow ? " · NOW" : ""}</div></div>`;
      });
      let row = 2;
      // Meeting-notes row: one editable note per period column, stored on the banner record.
      const notes = banner.plannerNotes || {};
      if (!banner.notesHidden) {
        html += `<div class="pg-corner pg-notelabel" style="grid-row:2;grid-column:1;">MEETING NOTES<br><span class="muted small" style="letter-spacing:0;font-family:inherit;">with promo planners</span></div>`;
        cols.forEach((c, i) => {
          const key = calFmtDate(c.start);
          html += `<div class="pg-notecell" style="grid-row:2;grid-column:${i + 2};"><textarea data-notekey="${key}" placeholder="Notes…" rows="3">${esc(notes[key] || "")}</textarea></div>`;
        });
        row = 3;
      }
      skus.forEach((sku) => {
        const items = [];
        deals
          .filter((d) => d.skuId === sku.id)
          .forEach((d) => {
            const sp = pgSpan(d, cols);
            if (sp) items.push({ p: pgDeal(d), c0: sp[0], c1: sp[1] });
          });
        items.sort((a, b) => a.c0 - b.c0 || b.c1 - a.c1);
        const lanes = [];
        items.forEach((it) => {
          let lane = lanes.find((l) => l[l.length - 1].c1 < it.c0);
          if (!lane) {
            lane = [];
            lanes.push(lane);
          }
          lane.push(it);
        });
        if (!lanes.length) lanes.push([]);
        html += `<div class="pg-skucell" style="grid-row:${row} / span ${lanes.length};grid-column:1;"><div class="pg-skuname">${esc(sku.name)}</div><div class="pg-skusub">${esc(sku.style || "")}${sku.style && sku.packFormat ? " · " : ""}${esc(sku.packFormat || "")}</div></div>`;
        lanes.forEach((lane, li) => {
          const r = row + li;
          let covered = new Array(N).fill(false);
          lane.forEach((it) => {
            for (let c = it.c0; c <= it.c1; c++) covered[c] = true;
            const p = it.p;
            const ms = calMarginStatus(p.disp);
            const tip = `${p.name}${p.d.linked ? " (live-linked)" : ""}\n${fmtDMY(p.d.startDate)} → ${fmtDMY(p.d.endDate)} · ${p.d.status}${p.stats ? "\nMargin / target: " + p.stats : ""}${p.d.notes ? "\n" + p.d.notes : ""}`;
            html += `<div class="pg-deal pg-${p.kind}${p.flagText ? " pg-flag" : ""} pg-st-${p.d.status}" style="grid-row:${r};grid-column:${it.c0 + 2} / span ${it.c1 - it.c0 + 1};" data-deal="${p.d.id}" title="${esc(tip)}">
              <div class="pg-tagrow"><span class="pg-tag">${p.d.status !== "planned" ? p.d.status.toUpperCase() : "&nbsp;"}</span><span class="pg-dot" style="background:${calMarginColor(ms)}"></span></div>
              <div class="pg-promoname">${esc(p.name)}</div>
              ${p.dealLabel ? `<div class="pg-dealname">${esc(p.dealLabel)}</div>` : ""}
              ${(p.price != null && !p.priceFromName) || p.tag ? `<div class="pg-pricerow">${p.price != null && !p.priceFromName ? `<span class="pg-price">${fmt$(p.price)}</span>` : ""}${p.tag ? `<span class="pg-tag pg-unit">${p.tag}</span>` : ""}</div>` : ""}
              ${p.scan ? `<div class="pg-scan">${fmt$(p.scan)} scan</div>` : ""}
              ${p.stats ? `<div class="pg-stats pg-stats-${ms}">${p.stats}</div>` : ""}
              <div class="pg-dates-line">${fmtDMY(p.d.startDate, true)} – ${fmtDMY(p.d.endDate, true)}</div>
              ${p.noteShow ? `<div class="pg-note">${esc(p.noteShow)}</div>` : ""}
              ${p.flagText ? `<div class="pg-flagtext">${p.flagText}</div>` : ""}
            </div>`;
          });
          for (let c = 0; c < N; c++) {
            if (!covered[c]) html += `<div class="pg-cell pg-emptycell" style="grid-row:${r};grid-column:${c + 2};" data-add-sku="${sku.id}" data-col="${c}" title="Add a deal for ${esc(sku.name)} in this period"><span>+</span></div>`;
          }
        });
        row += lanes.length;
      });
      html += "</div>";
      wrap.innerHTML = html;
      if (prevScroll != null) wrap.scrollLeft = prevScroll;
      else {
        const ti = cols.findIndex((c) => c.end >= today);
        wrap.scrollLeft = Math.max(0, (ti < 0 ? N - 1 : ti) - 0) * colW;
        calState.scrollLeft = wrap.scrollLeft;
      }
      let noteTimer = null;
      const saveNotes = async () => {
        banner.plannerNotes = banner.plannerNotes || {};
        wrap.querySelectorAll("textarea[data-notekey]").forEach((t) => {
          const v = t.value.trim();
          if (v) banner.plannerNotes[t.dataset.notekey] = t.value;
          else delete banner.plannerNotes[t.dataset.notekey];
        });
        await DB.put("banners", banner);
        updateNotesBtn();
      };
      wrap.querySelectorAll("textarea[data-notekey]").forEach((t) => {
        t.addEventListener("input", () => {
          clearTimeout(noteTimer);
          noteTimer = setTimeout(saveNotes, 500);
        });
        t.addEventListener("blur", () => {
          clearTimeout(noteTimer);
          saveNotes();
        });
      });
      updateNotesBtn();
      wrap.querySelectorAll(".pg-deal").forEach((el) => el.addEventListener("click", () => calOpenDealModal(State.calendarDeals.find((d) => d.id === el.dataset.deal))));
      wrap.querySelectorAll(".pg-emptycell").forEach((el) =>
        el.addEventListener("click", () => {
          const c = cols[parseInt(el.dataset.col, 10)];
          calOpenDealModal(null, banner.id, el.dataset.addSku, { startDate: calFmtDate(c.start), endDate: calFmtDate(c.end), cycleInstance: c.label || "" });
        })
      );
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
          <td>${fmtDMY(d.startDate)}</td>
          <td>${fmtDMY(d.endDate)}</td>
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
        const dealOptionsFor = (bId, sId) => {
          const pr = latestPricing(sId, bId, null);
          const list = pr && pr.deals.length ? pr.deals.map((x) => ({ id: x.dealTypeId, label: `${x.label || "Deal"} · ${(PACK_FORMATS.find((f) => f.id === dealPackFormat(bannerById(bId), x)) || {}).label || ""}${x.shelfRRP ? " · " + fmt$(x.shelfRRP) : ""}` })) : ((bannerById(bId) || {}).dealTypes || []).map((dt) => ({ id: dt.id, label: dt.label }));
          return list;
        };
        if (d.linked && !d.dealTypeId) {
          const first = dealOptionsFor(d.bannerId, d.skuId)[0];
          if (first) d.dealTypeId = first.id;
        }
        const dealTypeOptions = dealOptionsFor(d.bannerId, d.skuId)
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
              <label>Deal <span class="muted small">(built on this SKU's card on the banner page)</span></label>
              <select id="cd-dealtype" class="select">${dealTypeOptions || '<option value="">No deals on this SKU yet — add one on its pricing card</option>'}</select>
              <div class="muted small" id="cd-linked-preview" style="margin-top:6px;"></div>
            </div>
            <label>Promo name <span class="muted small">(shown on the timeline — stays as you type it, even when linked to a deal)</span></label>
            <input type="text" id="cd-promoname" value="${esc(d.promoName || "")}" placeholder="e.g. Buy one Larry, get one free">
            <div id="cd-manual-fields" style="display:${d.linked ? "none" : ""};">
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
            preview.textContent = "Pick a banner, SKU and deal to preview live figures.";
            return;
          }
          const disp = calDealDisplay({ linked: true, bannerId: b.id, skuId: s.id, dealTypeId: dtId });
          if (disp.pending) {
            preview.innerHTML = `<span style="color:var(--accent-warm-dark);">No price is set for "${esc(disp.promoName)}" on ${esc(s.name)} at ${esc(b.name)} yet — set it on the banner page, or link it anyway and come back once it's priced.</span>`;
          } else {
            preview.innerHTML = `= <b>${esc(disp.promoName)}</b> · ${fmt$(disp.shelfRRP)}${disp.scanDeal ? " · " + fmt$(disp.scanDeal) + " scan" : ""} · Margin ${disp.actualMarginPct != null ? fmtPct(disp.actualMarginPct) : "—"} vs target ${disp.targetMarginPct != null ? fmtPct(disp.targetMarginPct) : "not set"}`;
          }
        }

        document.getElementById("cd-banner").addEventListener("change", (e) => {
          d.bannerId = e.target.value;
          d.dealTypeId = "";
          render();
        });
        document.getElementById("cd-sku").addEventListener("change", (e) => {
          d.skuId = e.target.value;
          const opts = dealOptionsFor(document.getElementById("cd-banner").value, d.skuId);
          document.getElementById("cd-dealtype").innerHTML = opts.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("") || '<option value="">No deals on this SKU yet — add one on its pricing card</option>';
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
              alert("Pick a deal, or untick “Link to this SKU's pricing sheet” to enter a manual promo name.");
              return;
            }
            newDeal.dealTypeId = dealTypeId;
            newDeal.promoName = document.getElementById("cd-promoname").value.trim() || null; // blank = fall back to the deal's name
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
    function calSetView(view) {
      calState.view = view;
      document.getElementById("cal-view-grid").classList.toggle("active", view === "grid");
      document.getElementById("cal-view-table").classList.toggle("active", view === "table");
      document.getElementById("pg-grid-view").style.display = view === "grid" ? "" : "none";
      document.getElementById("cal-table-view").style.display = view === "table" ? "" : "none";
      calRenderAll();
    }
    document.getElementById("cal-view-grid").addEventListener("click", () => calSetView("grid"));
    document.getElementById("cal-view-table").addEventListener("click", () => calSetView("table"));
    (function () {
      const wrap = document.getElementById("pg-grid-wrap");
      wrap.addEventListener("scroll", () => (calState.scrollLeft = wrap.scrollLeft));
      const step = () => (calState.colW || 120) * 6;
      document.getElementById("pg-prev").addEventListener("click", () => wrap.scrollBy({ left: -step(), behavior: "smooth" }));
      document.getElementById("pg-next").addEventListener("click", () => wrap.scrollBy({ left: step(), behavior: "smooth" }));
      document.getElementById("pg-notes-toggle").addEventListener("click", async () => {
        banner.notesHidden = !banner.notesHidden;
        await DB.put("banners", banner);
        calRenderGrid();
      });
      document.getElementById("pg-today").addEventListener("click", () => {
        calState.scrollLeft = null;
        calRenderGrid();
      });
    })();
    document.getElementById("cal-add-deal").addEventListener("click", () => calOpenDealModal(null, banner.id));
    document.getElementById("pg-range").addEventListener("change", (e) => {
      calState.range = e.target.value;
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
    document.querySelectorAll("#cal-table-view thead th[data-sort]").forEach((th) => {
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
  }

  // The old shared calendar is gone — send old links to the first banner.
  route("calendar", async () => {
    navigate("#/banner/" + (State.banners[0] ? State.banners[0].id : ""));
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
    await DB.applySeedAdditions();
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
    nav.innerHTML = `
      <a class="nav-link" data-route="dashboard" href="#/dashboard">Dashboard</a>
      <a class="nav-link" data-route="cogs" href="#/cogs">COGS Master</a>
      <a class="nav-link" data-route="sku-tool" href="#/sku-tool">SKU Tool</a>
      <a class="nav-link" data-route="compare" href="#/compare">Compare SKUs</a>
      <a class="nav-link" data-route="trends" href="#/trends">Trends</a>
      <a class="nav-link" data-route="cpi-update" href="#/cpi-update">CPI Update</a>
      <a class="nav-link" data-route="data" href="#/data">Data &amp; Backup</a>
    `;

    const bannerNav = document.getElementById("banner-nav");
    bannerNav.innerHTML = State.bannerGroups
      .map((g) => {
        const bs = State.banners.filter((b) => b.groupId === g.id);
        return `<span class="bn-group"><span class="bn-group-label">${esc(g.shortName)}</span>${bs.map((b) => `<a class="banner-tab" data-banner="${b.id}" href="#/banner/${b.id}">${esc(b.name)}</a>`).join("")}</span>`;
      })
      .join("");
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
  }

  return { boot };
})();

window.addEventListener("DOMContentLoaded", () => App.boot());
