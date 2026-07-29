# Your Mates Brewing — Beer Pricing Strategy Tool

A standalone app for managing beer pricing, promo deals, and margin strategy
across your three banner groups: **Endeavour** (BWS / Dan Murphy's),
**Coles Liquor** (Liquorland), and **Independents** (Cellarbrations, Star
Liquor, Liquor Legends, Bottlemart, and others).

It runs entirely in your web browser, on your own computer. No data is sent
anywhere — everything is stored locally in the browser's database.

## How to run it

1. **Mac:** double-click `start_mac.command`. If macOS blocks it the first
   time (unidentified developer), right-click the file → Open, then confirm.
2. **Windows:** double-click `start_windows.bat`.
3. Your browser will open to the app automatically. Leave the little black
   terminal window open in the background while you use the app — closing
   it stops the local server. You can close the app tab and reopen
   `http://localhost:8642/index.html` any time without restarting anything.

Both scripts need Python 3 installed (already on virtually every Mac; on
Windows install it free from python.org and tick "Add to PATH" during setup).

If you'd rather not use the scripts, any local web server pointed at this
folder works — just don't open `index.html` directly by double-clicking it,
since the browser blocks its database in that mode.

## What's pre-loaded

The app ships pre-loaded with data extracted from your existing **"Master
Pricing Plan by Channel"** workbook: 25 SKUs/pack formats (cartons and
kegs), 18 banners across the three groups, banner rebate/pick-fee/target-
margin terms from your "Margin Expectations Source of Truth" tab, and
pricing history across three 6-monthly periods (FY26 H1, FY26 H2, FY27 H1)
where that data existed in the source file.

**Known gaps carried over from the source workbook** (worth fixing first):
- Several independent banners (The Bottler, Super Cellars, Fleet Street
  Cellars, My Beer Dealer, Rebel Liquor) had no rebate, pick fee, or target
  margin recorded anywhere in the workbook — they're in the app with blank
  terms, ready for you to fill in.
- Coles Liquor Group's distributor fee / rebate % wasn't itemised in the
  source file (the sheet just showed YM Net $ = List Price) — confirm the
  real terms with your CLG contact and update the banner's Terms panel.
- Independent-banner shelf pricing was recorded generically (not broken out
  per banner) in the source file, so all independent banners currently
  share the same list price/RRP template — adjust per banner as needed.
- A few Product COGS cells in the source file were broken formulas
  (`#REF!`), so those SKUs only have one period of COGS history instead of
  three — add the missing periods on the COGS Master page.

None of this blocks using the tool — it's exactly the kind of thing having
a single source of truth is meant to surface and fix.

## How the numbers work

**COGS Master** is the single source of truth for Product COGS per SKU.
Banner pages don't store their own copy of COGS — they always pull the
latest (or period-appropriate) master figure, so updating a recipe cost
once fixes every banner and deal automatically.

**Each banner** has its own versioned Terms, and every fee/rebate/term is a
**%** (not a flat $), so the same term automatically scales to the right $
impact for each SKU's own price/COGS. Both of the following are deducted
from YM Net $, calculated on the **full list price** (not a discounted
price — this was verified line-by-line against a real Star Liquor pricing
sheet, see the worked example below):

- **Distributor fee %** — e.g. 5% for stock routed through a wholesale
  distributor like ALM (0% for stock delivered direct). The Terms panel
  shows a live example of the $ impact on a sample SKU as you type.
- **Fee/rebate waterfall ("banner terms")** — volume rebate, key term
  rebate, ullage, banner term %, or any custom line you add, each as % of
  the full list price or % of the running balance after earlier lines.
- **Freight / direct delivery / keg collection %** — each a % of that SKU's
  Product COGS, so a heavier/more expensive SKU automatically carries a
  bigger $ freight cost from the same %.
- **Target margins** — by pack type (multipack/carton/2-for-$) and deal
  type (everyday/promo).

**Worked example** (Star Liquor, Larry, 16-pack carton, routed via ALM):
List Price $56.50, minus Distributor Fee 5% ($2.83), minus Banner Term
4.5% ($2.54), equals **YM Net Everyday $51.13** — this figure is the same
regardless of which deal is running. Each deal then subtracts its own
discount straight off that $51.13: Everyday/EDD discount $3.00 → YM Net
$48.13; Promo discount $5.00 → $46.13; 2-for-$ discount $8.00 → $43.13;
$12 Gift Promo discount $20.00 → $31.13. Subtracting YM COGS ($36.56 =
$35.96 COGS + $0.60 freight) from each gives Profit $11.57 / $9.57 / $6.57
/ -$5.43 respectively — all of which match the source pricing sheet
exactly.

**Deal / promo types are configured per banner.** Click **Manage deal
types** on any banner page to define exactly which deals that banner runs
(e.g. Endeavour might be Everyday + Promo 1 + Promo 2, each as Multipack or
Carton; an independent might add 2-for-$ or a Gift Promo). Each SKU card
then offers only that banner's deal types in its "+ Add deal" dropdown, and
the pack type/deal type on each is what drives which target margin applies.

**Each banner page lists every SKU as its own vertical card** — list price
at the top, then a table of that SKU's deals underneath. **Shelf RRP and
Scan Deal $ are both live inputs**: change either one and every computed
column (YM Net $, YM COGS, Profit $, YM GP%, Banner Margin %, meets-target)
recalculates instantly, with nothing saved until you click **Save card**.

**Discount $/carton** is a second lever, separate from scan deals: it's a
deal-specific $ discount (matching things like an "EDD discount", "promo
discount", or "2-for-$ discount" in a typical banner pricing sheet) that
comes straight off YM Net Everyday to give that deal's YM Net $ — it does
not change the basis used for the distributor fee or banner terms above
(both of those are fixed per SKU/banner, not per deal). The banner's own
cost price (what they're invoiced) is simply the list price divided across
the shelf units in a carton — distributor fee and banner-terms rebates are
a settlement between YM and the distributor and don't change what the
banner is charged; a **scan deal** does, since it's paid back to the
banner directly (see below).

**Scan deals** are the main lever for hitting a banner's margin target
without permanently repricing: a scan deal is a $-per-unit rebate Your
Mates funds back to the banner for units sold during the promo. It lowers
the banner's effective cost price (helping them hit their target margin at
a lower shelf price) while also reducing what Your Mates nets on the sale —
so you can see the trade-off directly. Every deal that has a target margin
set shows a **Fill scan deal** button that fills in exactly the scan deal
$ needed to hit that target at the current shelf price; adjust the shelf
price and click it again to see how the required scan deal (and YM's GP
hit) changes.

## Every 6 months: CPI update

Go to **CPI Update**, name the new period (e.g. "FY27 H2"), then enter a
**$ increase** for each SKU's Product COGS and for each SKU/banner's
wholesale list price (a "fill all with a suggested %" helper is there if
you'd rather start from a percentage and let it calculate the $ per SKU).
The resulting % increase is shown live next to each $ input, since the
same $ increase is a different % depending on the SKU's current price.
Applying creates a new versioned period — nothing in the old periods is
overwritten, so trend history stays intact. Shelf RRPs aren't auto-changed
by CPI (only COGS/list price) since retail price changes are usually a
separate commercial decision — review and adjust them per banner card
afterwards.

## Promo Calendar

**Promo Calendar** is the timeline view merged in from your separate promo
tracker tool — same Gantt-style layout (a frozen Banner/SKU rail next to a
scrollable date grid, drag a bar to shift its dates, drag its edges to
resize, double-click empty space on a row to add a deal, plus a sortable
Table view), but now built directly on top of this pricing sheet instead of
its own separate dataset.

**Every deal you add here can be live-linked to a price point.** When
adding or editing a deal, tick "Link to this SKU's pricing sheet" (on by
default) and pick a Banner → SKU → Deal type. That's it — no promo name,
target margin or actual margin to type in. All three are computed fresh
every time the calendar renders, straight from whatever that SKU's pricing
card currently has for that deal type (Shelf RRP, scan deal, discount,
COGS, banner terms — the same calc engine as the banner pages). Change the
shelf price or scan deal on the banner page, and every calendar bar
referencing that deal type updates automatically — nothing needs
re-syncing. A 🔗 next to a bar/row means it's linked; an amber bar/dot means
the deal type is linked but doesn't have a price entered yet.

If a deal doesn't cleanly map to one of a banner's configured deal types
(a one-off mechanic, an allocation deal, a "confirm mechanic later"
placeholder), untick the link and enter the promo name / target / actual
margin manually instead — exactly like the original tracker.

**Your existing promo tracker data is already loaded in:** all 239 deals
across BWS, Dan Murphy's, Coles - Liquorland, Star Liquor and Liquor
Legends were imported as manual entries (preserving their original promo
names, dates, target/actual margins, cycle labels, statuses and notes
exactly as they were) so nothing was lost or silently reinterpreted. You
can re-link any of them to a live price point at any time by editing the
deal and ticking the link checkbox. Two mapping decisions were made on
import, worth knowing:
- **Coles - Liquorland** deals were mapped to the **Liquorland (Big Box)**
  banner (your choice) — re-point them to Small Box individually if any
  should sit there instead.
- **Dave** (355ml 4-pack/16-pack) isn't in the pricing sheet's off-premise
  SKU list yet — only an on-premise keg version exists. It came up in your
  Star Liquor promo notes but has zero calendar deals against it, so
  nothing was dropped; add an off-premise Dave SKU on the COGS Master page
  first if you want to price and link Dave deals going forward.

Banners and SKUs themselves are still managed from their own pages
(banner Terms/deal types, COGS Master) — the calendar just visualises
what's already there, so there's one source of truth instead of two.

## Comparing and trending

- **Compare SKUs** — pick one SKU, see its pricing and margin side-by-side
  across every banner for the period you're viewing.
- **Trends** — pick a SKU, see Product COGS and YM GP% charted over every
  period recorded.

## Backing up your data

Go to **Data & Backup** regularly (especially before a CPI update or bulk
edit) and click **Export JSON** to download a full backup — this now
includes Promo Calendar deals alongside everything else. **Import** lets
you merge or replace from a backup file — handy for moving data between
computers or recovering from a mistake. **Reset to sample data** wipes
everything and reloads the original workbook-derived dataset (including
the imported promo calendar deals).

If you're updating from an earlier copy of this app that didn't have the
Promo Calendar, just replace the files and reload — your existing browser
data (SKUs, COGS, pricing, everything) is untouched; it only adds the new
calendar storage alongside it.

## Adding more SKUs, banners, or deal types

Everything is editable in the UI — there's no code to touch. Use the
"+ Add SKU to this banner" dropdown on a banner page to create a new SKU
card, "+ Add deal" on any SKU card to add one of that banner's configured
deal types, "Manage deal types" to add/edit/remove the deal types a banner
offers, "+ Add period" on the COGS Master page for a new COGS entry, and
"Edit / new period" on a banner's Terms panel to update rebates, fees or
target margins.
