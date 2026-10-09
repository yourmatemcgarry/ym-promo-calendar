/* Banners added after the first release. Applied once to existing databases (see DB.applySeedAdditions). */
(function () {
  const d = window.SEED_DATA;
  const star = d.banners.find((b) => b.id === "star-liquor");
  const starTerms = d.bannerTermsHistory.filter((t) => t.bannerId === "star-liquor");
  const banner = Object.assign(JSON.parse(JSON.stringify(star)), {
    id: "sense-of-taste",
    name: "Sense Of Taste",
    ownerBannerId: "star-liquor",
    unrangedSkuIds: [],
    badgeColor: "#a35cc0",
    badgeInitials: "ST",
  });
  window.SEED_ADDITIONS = {
    banners: [banner],
    // Starting point only: same terms as Star Liquor until you edit them on the banner page.
    bannerTermsHistory: starTerms.map((t) => Object.assign(JSON.parse(JSON.stringify(t)), { bannerId: "sense-of-taste" })),
  };
})();
