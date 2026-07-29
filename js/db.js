/**
 * db.js — IndexedDB persistence layer for the Beer Pricing Strategy tool.
 *
 * All data lives in the browser's IndexedDB for this origin (i.e. tied to
 * wherever you're running the local server from). Every write is additive
 * / versioned by period, so historicals are never overwritten. Use
 * Settings -> Export to back up to a JSON file regularly, especially
 * before large changes like a CPI update.
 */

const DB = (function () {
  "use strict";
  const DB_NAME = "ym-beer-pricing";
  const DB_VERSION = 2;
  const STORES = ["skus", "cogsHistory", "bannerGroups", "banners", "bannerTermsHistory", "pricingHistory", "calendarDeals", "meta"];

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("skus")) db.createObjectStore("skus", { keyPath: "id" });
        if (!db.objectStoreNames.contains("cogsHistory")) db.createObjectStore("cogsHistory", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("bannerGroups")) db.createObjectStore("bannerGroups", { keyPath: "id" });
        if (!db.objectStoreNames.contains("banners")) db.createObjectStore("banners", { keyPath: "id" });
        if (!db.objectStoreNames.contains("bannerTermsHistory")) db.createObjectStore("bannerTermsHistory", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("pricingHistory")) db.createObjectStore("pricingHistory", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("calendarDeals")) db.createObjectStore("calendarDeals", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return open().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function getAll(storeName) {
    return tx(storeName, "readonly").then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function put(storeName, value) {
    return tx(storeName, "readwrite").then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.put(value);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function putMany(storeName, values) {
    return tx(storeName, "readwrite").then(
      (store) =>
        new Promise((resolve, reject) => {
          let remaining = values.length;
          if (remaining === 0) return resolve();
          values.forEach((v) => {
            const req = store.put(v);
            req.onsuccess = () => {
              remaining -= 1;
              if (remaining === 0) resolve();
            };
            req.onerror = () => reject(req.error);
          });
        })
    );
  }

  function clearStore(storeName) {
    return tx(storeName, "readwrite").then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }

  function getMeta(key) {
    return tx("meta", "readonly").then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function setMeta(key, value) {
    return put("meta", { key, value });
  }

  /** Load the bundled SEED_DATA into an empty database (first run only). */
  async function seedIfEmpty() {
    const seeded = await getMeta("seeded");
    if (seeded) return false;
    const data = window.SEED_DATA;
    await putMany("skus", data.skus);
    await putMany(
      "cogsHistory",
      data.cogsHistory.map((r) => Object.assign({}, r))
    );
    await putMany("bannerGroups", data.bannerGroups);
    await putMany("banners", data.banners);
    await putMany(
      "bannerTermsHistory",
      data.bannerTermsHistory.map((r) => Object.assign({}, r))
    );
    await putMany(
      "pricingHistory",
      data.pricingHistory.map((r) => Object.assign({}, r))
    );
    if (data.calendarDeals) {
      await putMany(
        "calendarDeals",
        data.calendarDeals.map((r) => Object.assign({}, r))
      );
    }
    await setMeta("periods", data.periods);
    await setMeta("currentPeriod", data.currentPeriod);
    await setMeta("seeded", true);
    return true;
  }

  async function exportAll() {
    const [skus, cogsHistory, bannerGroups, banners, bannerTermsHistory, pricingHistory, calendarDeals, periods, currentPeriod] = await Promise.all([
      getAll("skus"),
      getAll("cogsHistory"),
      getAll("bannerGroups"),
      getAll("banners"),
      getAll("bannerTermsHistory"),
      getAll("pricingHistory"),
      getAll("calendarDeals"),
      getMeta("periods"),
      getMeta("currentPeriod"),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      periods,
      currentPeriod,
      skus,
      cogsHistory,
      bannerGroups,
      banners,
      bannerTermsHistory,
      pricingHistory,
      calendarDeals,
    };
  }

  async function importAll(data, mode) {
    // mode: 'replace' clears existing data first; 'merge' just puts (upserts by id where present)
    if (mode === "replace") {
      await Promise.all(STORES.map((s) => (s === "meta" ? Promise.resolve() : clearStore(s))));
    }
    if (data.skus) await putMany("skus", data.skus);
    if (data.cogsHistory) await putMany("cogsHistory", stripIdsIfMerge(data.cogsHistory, mode));
    if (data.bannerGroups) await putMany("bannerGroups", data.bannerGroups);
    if (data.banners) await putMany("banners", data.banners);
    if (data.bannerTermsHistory) await putMany("bannerTermsHistory", stripIdsIfMerge(data.bannerTermsHistory, mode));
    if (data.pricingHistory) await putMany("pricingHistory", stripIdsIfMerge(data.pricingHistory, mode));
    if (data.calendarDeals) await putMany("calendarDeals", data.calendarDeals);
    if (data.periods) await setMeta("periods", data.periods);
    if (data.currentPeriod) await setMeta("currentPeriod", data.currentPeriod);
    await setMeta("seeded", true);
  }

  function stripIdsIfMerge(rows, mode) {
    if (mode === "replace") return rows;
    // when merging, drop autoincrement ids so we don't collide/overwrite existing rows
    return rows.map((r) => {
      const clone = Object.assign({}, r);
      delete clone.id;
      return clone;
    });
  }

  return {
    open,
    getAll,
    put,
    putMany,
    clearStore,
    getMeta,
    setMeta,
    seedIfEmpty,
    exportAll,
    importAll,
  };
})();
