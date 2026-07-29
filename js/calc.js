/**
 * calc.js — Pricing / margin calculation engine for the Your Mates Brewing
 * Beer Pricing Strategy tool.
 *
 * Pure functions only (no DOM, no IndexedDB) so this file can be unit
 * tested with plain Node as well as loaded directly in the browser.
 *
 * -------------------------------------------------------------------------
 * THE WATERFALL — validated line-by-line against a real banner pricing
 * sheet (Star Liquor, FY26 H2): List $56.50, Distributor Fee 5% = $2.83,
 * Banner Term 4.5% = $2.54, YM Net Everyday = $51.13; EDD/Promo/2-for-$/
 * Gift discounts of $3/$5/$8/$20 each subtract straight off that $51.13 to
 * give $48.13/$46.13/$43.13/$31.13 — all matching to the cent.
 *
 *  1. List Price                              (what YM invoices at, per carton/keg)
 *
 *  2. Distributor Fee $ = List Price × Distributor Fee %
 *       Deducted from YM Net $. Calculated on the FULL list price.
 *
 *  3. Banner terms fee/rebate waterfall (volume rebate, key term rebate,
 *       banner term %, ullage, or any custom % line) — ALL lines are %,
 *       ALSO calculated on the FULL list price (same base as the
 *       distributor fee, not a discounted price):
 *         - pct_of_list    : % of the full list price
 *         - pct_of_running : % of the price remaining after earlier lines
 *       Deducted from YM Net $.
 *
 *  4. = YM Net $ (Everyday) = List Price − Distributor Fee $
 *       − banner terms deductions
 *       (this is constant per SKU/banner — it does not change per deal)
 *
 *  5. Discount per carton ($) and/or Scan deal ($ per shelf unit, converted
 *       to carton-equivalent) — deal-specific, subtracted straight off YM
 *       Net $ (Everyday) to get the deal's net. Neither one changes the
 *       basis used for the distributor fee or banner terms above.
 *  6. = YM Net $ (per deal) = YM Net $ (Everyday) − Discount/carton
 *       − Scan Deal (carton-equivalent)
 *
 *  Cost side (all % of Product COGS, so the $ impact is calculated per SKU):
 *  7. Product COGS (from the COGS master, per SKU, versioned)
 *   + Freight %, Direct Delivery %, Keg Collection % — each a % of that
 *     SKU's Product COGS, banner-specific (these vary by distributor/route)
 *  8. = YM COGS (fully landed cost)
 *
 *  9. Profit $ (per deal) = YM Net $ (deal) − YM COGS
 * 10. GP % (per deal)     = Profit $ / YM Net $ (deal)
 *
 *  Banner / retail side:
 * 11. Banner Cost Price = (List Price / packQty) − Scan Deal $ per shelf unit
 *       (what the banner pays, per shelf unit — the distributor fee and
 *       banner-terms rebates are a YM/distributor-side settlement and don't
 *       change what the banner is invoiced; a scan deal is paid back to the
 *       banner directly, so it does lower their effective cost. A straight
 *       "discount per carton" is also a YM/distributor-side settlement —
 *       if a deal's discount is instead something the banner is invoiced
 *       less for, model it as a scan deal instead.)
 * 12. Banner Margin $ = Shelf RRP − Banner Cost Price
 * 13. Banner Margin % = Banner Margin $ / Shelf RRP
 * 14. Meets Target?   = Banner Margin % >= banner's targetMargin% for that
 *                        pack type / deal type
 * -------------------------------------------------------------------------
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Calc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Runs the banner-terms fee/rebate waterfall off a given base price and
   * returns the resulting net, plus a line-by-line breakdown for display.
   * All lines are % based.
   */
  function runFeeWaterfall(basePrice, feeWaterfall) {
    let running = basePrice;
    const lines = [];
    (feeWaterfall || []).forEach((line) => {
      const basis = line.basis === "pct_of_running" ? running : basePrice;
      const amount = basis * line.value;
      running -= amount;
      lines.push({ label: line.label, basis: line.basis, value: line.value, amount, kind: line.kind });
    });
    return { net: running, lines };
  }

  /**
   * Full landed cost for a SKU at a given banner. All banner-side cost
   * adders are % of Product COGS, so every SKU gets its own $ impact.
   * bannerTerms: { freightPct, directDeliveryPct, kegCollectionPct }
   */
  function landedCost(cogs, bannerTerms) {
    const productCogs = (cogs && cogs.productCogs) || 0;
    const freightPct = (bannerTerms && bannerTerms.freightPct) || 0;
    const directDeliveryPct = (bannerTerms && bannerTerms.directDeliveryPct) || 0;
    const kegCollectionPct = (bannerTerms && bannerTerms.kegCollectionPct) || 0;
    const freight = productCogs * freightPct;
    const directDelivery = productCogs * directDeliveryPct;
    const kegCollection = productCogs * kegCollectionPct;
    const total = productCogs + freight + directDelivery + kegCollection;
    return {
      productCogs,
      freight,
      freightPct,
      directDelivery,
      directDeliveryPct,
      kegCollection,
      kegCollectionPct,
      total,
    };
  }

  /**
   * Evaluate a single deal (everyday / promo / etc) for a SKU at a banner.
   *
   * params:
   *   listPrice          : $ YM invoices at (per carton/keg), full/undiscounted
   *   distributorFeePct   : % deducted from YM Net, on the full list price
   *   feeWaterfall        : [] banner fee/rebate lines (% based), ALSO on
   *                         the full list price — same base as distributor
   *                         fee. Deducted from YM Net.
   *   discountPerCarton   : $ off-invoice discount per carton, deal-specific.
   *                         Subtracted from YM Net Everyday directly —
   *                         does NOT change the basis used above.
   *   scanDeal            : $ per shelf unit, funded by YM, paid back to the
   *                         banner per unit sold — reduces both YM's net
   *                         and the banner's effective cost price
   *   shelfRRP            : $ banner's retail shelf price for this deal
   *   cogs                : { productCogs }
   *   bannerTerms         : { freightPct, directDeliveryPct, kegCollectionPct }
   *   targetMarginPct     : number|null — banner's expected margin % for this
   *                         pack type / deal type (null = not set)
   *   packQty             : how many of the shelf-priced unit make up one
   *                         carton (1 for carton-level deals)
   */
  function evaluateDeal({ listPrice, distributorFeePct, feeWaterfall, discountPerCarton, scanDeal, shelfRRP, cogs, bannerTerms, targetMarginPct, packQty }) {
    const qty = packQty && packQty > 0 ? packQty : 1;

    // Distributor fee: on the full list price.
    const distFeePct = distributorFeePct || 0;
    const distFeeDollarOnList = listPrice * distFeePct;

    // Banner terms (rebate waterfall): also on the full list price.
    const waterfall = runFeeWaterfall(listPrice, feeWaterfall);
    const bannerTermsDeductions = listPrice - waterfall.net;

    // YM Net Everyday — constant per SKU/banner, independent of which deal.
    const ymNetEveryday = listPrice - distFeeDollarOnList - bannerTermsDeductions;

    // Deal-specific reductions, applied after the above.
    const discount = discountPerCarton || 0;
    const scanDealTotal = (scanDeal || 0) * qty; // carton-equivalent $ YM funds
    const ymNetDeal = ymNetEveryday - discount - scanDealTotal;

    const cost = landedCost(cogs, bannerTerms);

    const profit = ymNetDeal - cost.total;
    const gpPct = ymNetDeal !== 0 ? profit / ymNetDeal : null;

    // Banner cost price: what the banner is invoiced per shelf unit. The
    // distributor fee and banner-term rebates are a YM/distributor-side
    // settlement and don't change what the banner pays; a scan deal is
    // paid back to the banner directly, so it does lower their cost.
    const bannerCostPriceBeforeScan = listPrice / qty;
    const bannerCostPrice = bannerCostPriceBeforeScan - (scanDeal || 0);
    const bannerMarginDollar = shelfRRP != null ? shelfRRP - bannerCostPrice : null;
    const bannerMarginPct = shelfRRP ? bannerMarginDollar / shelfRRP : null;

    let meetsTarget = null;
    let requiredScanDealForTarget = null;
    let gapToTargetDollar = null;
    if (targetMarginPct != null && shelfRRP != null) {
      meetsTarget = bannerMarginPct >= targetMarginPct - 1e-9;
      // Solve: (bannerCostPriceBeforeScan - scanDeal) = RRP*(1-target%)
      const bannerCostPriceNeeded = shelfRRP * (1 - targetMarginPct);
      requiredScanDealForTarget = bannerCostPriceBeforeScan - bannerCostPriceNeeded;
      gapToTargetDollar = requiredScanDealForTarget - (scanDeal || 0);
    }

    return {
      listPrice,
      distributorFeePct: distFeePct,
      distFeeDollarOnList: round2(distFeeDollarOnList),
      waterfallLines: waterfall.lines,
      bannerTermsDeductions: round2(bannerTermsDeductions),
      ymNetEveryday: round2(ymNetEveryday),
      discountPerCarton: discount,
      scanDeal: scanDeal || 0,
      scanDealTotal: round2(scanDealTotal),
      ymNetDeal: round2(ymNetDeal),
      cost,
      profit: round2(profit),
      gpPct,
      bannerCostPrice: round2(bannerCostPrice),
      shelfRRP,
      bannerMarginDollar: bannerMarginDollar != null ? round2(bannerMarginDollar) : null,
      bannerMarginPct,
      targetMarginPct,
      meetsTarget,
      requiredScanDealForTarget: requiredScanDealForTarget != null ? round2(Math.max(0, requiredScanDealForTarget)) : null,
      gapToTargetDollar: gapToTargetDollar != null ? round2(gapToTargetDollar) : null,
      packQty: qty,
    };
  }

  /**
   * Given a desired banner target margin % and a fixed shelf RRP, solve the
   * scan deal ($ per shelf unit) YM needs to fund to hit the banner's
   * target margin, and report the resulting GP impact to YM.
   *
   * This answers: "what scan deal do we need to offer to meet the margin
   * expectations of the banner, and what's the GP impact?"
   */
  function solveRequiredScanDeal({ listPrice, distributorFeePct, feeWaterfall, discountPerCarton, shelfRRP, targetMarginPct, cogs, bannerTerms, packQty }) {
    const qty = packQty && packQty > 0 ? packQty : 1;
    const bannerCostPriceBeforeScan = listPrice / qty;
    const bannerCostPriceNeeded = shelfRRP * (1 - targetMarginPct);
    const requiredScanDeal = Math.max(0, bannerCostPriceBeforeScan - bannerCostPriceNeeded);

    const evalAtRequired = evaluateDeal({
      listPrice,
      distributorFeePct,
      feeWaterfall,
      discountPerCarton,
      scanDeal: requiredScanDeal,
      shelfRRP,
      cogs,
      bannerTerms,
      targetMarginPct,
      packQty,
    });
    const evalAtNoScan = evaluateDeal({
      listPrice,
      distributorFeePct,
      feeWaterfall,
      discountPerCarton,
      scanDeal: 0,
      shelfRRP,
      cogs,
      bannerTerms,
      targetMarginPct,
      packQty,
    });

    return {
      bannerCostPriceBeforeScan: round2(bannerCostPriceBeforeScan),
      bannerCostPriceNeeded: round2(bannerCostPriceNeeded),
      requiredScanDeal: round2(requiredScanDeal),
      ymGpImpactDollar: round2(evalAtRequired.profit - evalAtNoScan.profit),
      ymGpPctAtRequired: evalAtRequired.gpPct,
      ymGpPctAtNoScan: evalAtNoScan.gpPct,
      evalAtRequired,
      evalAtNoScan,
    };
  }

  /** $ increase expressed as a % of the original value. */
  function pctIncrease(oldValue, dollarIncrease) {
    if (!oldValue) return null;
    return dollarIncrease / oldValue;
  }

  return {
    round2,
    runFeeWaterfall,
    landedCost,
    evaluateDeal,
    solveRequiredScanDeal,
    pctIncrease,
  };
});
