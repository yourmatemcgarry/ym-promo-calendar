/* Corrections to the Endeavour (BWS / Dan Murphy's) FY27 H1 data, from the 'EDG FY27 Half 01' sheet:
   scan deals that were missing, the Warehouse Issue Deal on Dan's Larry Jr, and carton target margins.
   Applied to the bundled seed and, once, to existing databases (see DB.applySeedFixes). */
(function () {
  const SCANS = {"bws": {"larry-ctn16": {"promo1-mp": 3.0, "promo2-mp": 3.7, "promo1-ctn": 10.0, "promo2-ctn": 13.0}, "hazypale-ctn16": {"promo1-mp": 1.4, "promo2-mp": 1.9, "promo1-ctn": 5.0, "promo2-ctn": 6.0}, "tilly-ctn16": {"promo1-mp": 1.2, "promo2-mp": 2.0, "promo1-ctn": 5.0, "promo2-ctn": 9.0}, "larryjr-ctn16": {"promo1-mp": 2.5, "promo2-mp": 3.0, "promo1-ctn": 7.0, "promo2-ctn": 8.5}, "sally-ctn16": {"promo1-mp": 1.5, "promo2-mp": 2.7, "promo1-ctn": 9.0, "promo2-ctn": 11.5}, "lager-ctn24": {"promo1-mp": 1.6, "promo2-mp": 2.2, "promo1-ctn": 5.0, "promo2-ctn": 8.0}}, "dans": {"larry-ctn16": {"promo1-mp": 3.0, "promo2-mp": 3.0, "promo1-ctn": 9.0, "promo2-ctn": 12.0}, "hazypale-ctn16": {"promo1-mp": 1.2, "promo2-mp": 1.8, "promo1-ctn": 5.0, "promo2-ctn": 6.0}, "tilly-ctn16": {"promo1-mp": 0.8, "promo2-mp": 1.7, "promo1-ctn": 4.0, "promo2-ctn": 8.0}, "larryjr-ctn16": {"promo1-mp": 1.7, "promo2-mp": 2.2, "promo1-ctn": 5.5, "promo2-ctn": 6.9}, "sally-ctn16": {"promo1-mp": 1.0, "promo2-mp": 2.0, "promo1-ctn": 6.0, "promo2-ctn": 8.0}, "lager-ctn24": {"promo1-mp": 1.0, "promo2-mp": 1.6, "promo1-ctn": 4.5, "promo2-ctn": 8.0}}};
  const TARGETS = {
    bws: { "everyday-mp": 0.43, "everyday-ctn": 0.22, "promo1-mp": 0.42, "promo1-ctn": 0.2, "promo2-mp": 0.42, "promo2-ctn": 0.2 },
    dans: { "everyday-mp": 0.4, "everyday-ctn": 0.2, "promo1-mp": 0.38, "promo1-ctn": 0.18, "promo2-mp": 0.38, "promo2-ctn": 0.18 },
  };
  const WAREHOUSE_DEAL = { dans: { "larryjr-ctn16": 1.4 } };
  window.applySeedFixes = function (pricingRows, termsRows) {
    let n = 0;
    pricingRows.forEach((p) => {
      if (p.period !== "FY27-H1" || !SCANS[p.bannerId]) return;
      const sc = SCANS[p.bannerId][p.skuId];
      const wd = (WAREHOUSE_DEAL[p.bannerId] || {})[p.skuId];
      (p.deals || []).forEach((d) => {
        if (sc && sc[d.dealTypeId] != null && !d.scanDeal) { d.scanDeal = sc[d.dealTypeId]; n++; }
        if (wd && !d.discountPerCarton) { d.discountPerCarton = wd; n++; }
      });
    });
    termsRows.forEach((t) => {
      const tg = TARGETS[t.bannerId];
      if (!tg || t.period !== "FY27-H1") return;
      (t.targetMargins || []).forEach((m) => {
        if (m.targetPct == null || (t.bannerId === "dans" && m.dealTypeId === "everyday-mp" && m.targetPct === 0.42)) { m.targetPct = tg[m.dealTypeId]; n++; }
      });
    });
    return n;
  };
  if (window.SEED_DATA) window.applySeedFixes(window.SEED_DATA.pricingHistory, window.SEED_DATA.bannerTermsHistory);
})();
