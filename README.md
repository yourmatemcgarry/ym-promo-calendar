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
Pricing Plan by Channel"** workbook: 10 off-premise carton SKUs/pack
formats, 18 banners across the three groups, banner rebate/pick-fee/target-
margin terms from your "Margin Expectations Source of Truth" tab, and
pricing history across three 6-monthly periods (FY26 H1, FY26 H2, FY27 H1)
where that data existed in the source file. (Keg SKUs from the source
workbook were left out of this tool — add them back on the SKU Tool page
if you ever want to price kegs here too.)

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
- **Target margins** — every individual deal type gets its own target,
  set right alongside it on **Manage deal types** (not the Terms panel).
  Two deal types don't have to share a target just because they're both
  "carton / promo" — Promo 1 (Carton) and Promo 2 (Carton) can each have
  their own.

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

**GST.** Every $ figure in this tool — List Price, Product COGS,
distributor fee, banner terms, discount, scan deal, pick fee — is entered
and calculated **ex GST**, matching how Your Mates invoices. **Shelf RRP is
the one exception: it's GST-inclusive**, since that's what's actually on
the shelf tag. Banner Margin converts Shelf RRP to ex GST (÷ 1.1) before
comparing it to the banner's (ex GST) cost price, so the 10% GST component
isn't counted as margin. Nothing else in the tool touches this — YM Net $,
Profit $ and YM GP% are all ex GST end-to-end and unaffected.

**Banner Margin** = (Shelf RRP ex GST − Banner Cost Price) ÷ Shelf RRP ex
GST, where **Banner Cost Price** = List Price ÷ pack qty + Pick Fee ÷ pack
qty − Discount ÷ pack qty − Scan Deal. A bigger discount or scan deal lowers
the banner's cost and improves their margin; a bigger pick fee raises their
cost and cuts into it. Distributor fee and banner-term rebates don't appear
here at all — those are a Your Mates/distributor settlement, not something
that changes what the banner is invoiced.

**Pick fee ($/carton)** is a flat fee some banners pay directly to a
distributor (commonly ALM) to have stock picked — it's set on the banner's
**Terms** panel alongside the other fee fields, is versioned by period like
everything else, and only affects that banner's cost price / margin. It has
no effect on YM Net $, Profit $ or YM GP%, since Your Mates isn't a party to
it.

**Deal / promo types and target margins are both configured per banner from
the same place.** Click **Manage deal types** on any banner page to define
exactly which deals that banner runs (e.g. Endeavour might be Everyday +
Promo 1 + Promo 2, each as Multipack or Carton; an independent might add
2-for-$ or a Gift Promo) — each row there has its own **Target %** field
right alongside its label/pack type/deal type/units-per-carton, so every
deal type you add gets its own target, however many you add. Two deal
types don't have to share a target just because they're both "carton /
promo" — Promo 1 (Carton) and Promo 2 (Carton) can be set differently. Each
SKU card then offers only that banner's deal types in its "+ Add deal"
dropdown, and each deal on a SKU card is checked against its own deal
type's target. The **Terms** panel is now only distributor fee, freight,
pick fee and the fee/rebate waterfall — no target margins there anymore.

**Each banner page lists every SKU as its own card**, list price at the
top and its deals underneath, one per row. Each deal row's top line is the
"is this okay?" glance-info — deal name, status, Shelf RRP, Banner Margin,
Target — sized to always fit on screen without side-scrolling; the $
breakdown (YM Net, YM COGS, Profit, YM GP%) sits on a second, quieter line
underneath, along with the Discount/Scan Deal inputs. **Shelf RRP and Scan
Deal $ are both live inputs**: change either one (or the Discount) and
every computed figure recalculates instantly, with nothing saved until you
click **Save card**.

**Deal status has three colours**, shown as a chip on each deal row (and a
legend right above the deal list on every banner page, so it's always in
view): green **✓ Meets target** once Banner Margin is at or above the
deal's target; amber **⚠ Near target — push pricing** when it's below
target but within **1.5 percentage points** of it — close enough that a
small nudge to Shelf RRP, Discount or Scan Deal should get it there; red
**✗ Below target** for anything further short than that.

**Discount $/carton** and **Scan deal $/unit** are both deal-specific
levers, on top of the everyday terms above, and both work the same way in
one important respect: **the bigger either one is, the lower the banner's
effective cost price, and the better their Banner Margin gets.**

- **Discount $/carton** (matching things like an "EDD discount", "promo
  discount", or "2-for-$ discount" in a typical banner pricing sheet) comes
  straight off YM Net Everyday to give that deal's YM Net $, and also comes
  off the banner's cost price per shelf unit (converted from carton to
  shelf-unit terms). It does not change the basis used for the distributor
  fee or banner terms above — those stay fixed per SKU/banner, not per deal.
- **Scan deal $/unit** is a $-per-unit rebate Your Mates funds back to the
  banner for units sold during the promo — it also comes off YM Net $ and
  off the banner's cost price per shelf unit.

Both reduce what Your Mates nets on the sale while improving what the
banner's margin looks like, so you can see the trade-off directly as you
adjust either one. Every deal that has a target margin set shows a **Fill
scan deal** button that fills in exactly the scan deal $ needed to hit that
target at the current shelf price and discount; adjust the shelf price or
discount and click it again to see how the required scan deal (and YM's GP
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

## SKU Tool

**SKU Tool** is where SKUs and independent-banner distributor pricing are
managed, separate from day-to-day pricing work on the banner pages.

**Add or remove SKUs.** "+ Add SKU" creates a new product/pack format
(name, category, style, pack format, units per carton, channel) that then
becomes available to price on any banner page and to give COGS on the COGS
Master page. **Remove** deletes a SKU entirely — it also deletes that
SKU's COGS history, pricing history, distributor prices and any Promo
Calendar deals, and tells you exactly how many of each before you confirm,
since this can't be undone.

**Distributor list pricing (Independent Bottleshops).** Independent
banners can be assigned to one of five distributors — **ALM, ILG,
Paramount, EDG, CLG** — in the "Banner → distributor assignment" table (or
**Direct**, which keeps that banner pricing itself as before). Once a
banner is assigned to a real distributor, its List Price field on the
banner page becomes read-only and always shows that distributor's current
price — so instead of updating the same list price on every independent
banner that happens to route through the same distributor, you set it
**once** per SKU/distributor in the table above, and every assigned banner
picks it up immediately (their own deals — Shelf RRP, scan deal, discount,
target margin — still work exactly as before, only the list price is
shared). This is also versioned by period, so distributor price history is
preserved the same way COGS and everything else is. The 6-monthly **CPI
Update** page picks this up too — a separate "Distributor list price"
table lets you apply one $ increase per SKU/distributor instead of
repeating it across every banner on that distributor.

None of your independent banners have a distributor assigned yet (they
default to Direct/no shared pricing) — assign them here whenever you're
ready to switch a banner over to shared distributor pricing.

## Promo Calendar

**Promo Calendar** is the timeline view merged in from your separate promo
tracker tool — same Gantt-style layout (a frozen Banner/SKU rail next to a
scrollable date grid, drag a bar to shift its dates, drag its edges to
resize, double-click empty space on a row to add a deal, plus a sortable
Table view), but now built directly on top of this pricing sheet instead of
its own separate dataset.

**It opens on a 6-month view, scrolled to today** — that's the window
planning conversations usually look at, so there's nothing to set up first.
**Month / Quarter / 6 Months / Year** zoom buttons switch how much time is
visible at once (the active one is highlighted); **Jump to Today** re-centres
without changing zoom.

**Each bar is two lines** — promo name (with status and a 🔗 for linked
deals) on top, Shelf RRP underneath — so both stay readable even zoomed
all the way out, which also makes the timeline screenshot- and
export-friendly for sharing a deal (or the whole calendar) with someone
else without them needing to open the tool. The **Table view** carries a
**Notes** column too (truncated with the full text on hover), so anything
written in a deal's Notes field shows up there as well as in the tooltip.

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
  SKU list yet. It came up in your Star Liquor promo notes but has zero
  calendar deals against it, so nothing was dropped; add an off-premise
  Dave SKU on the SKU Tool page first if you want to price and link Dave
  deals going forward.

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
offers, "Edit" on the COGS Master page for a SKU's COGS entry, and
"Edit / new period" on a banner's Terms panel to update rebates, fees or
target margins. New SKUs themselves (name, pack format, etc.) are added or
removed on the **SKU Tool** page.

## Look and feel

The app's colours (teal, gold, coral) are pulled from Your Mates Brewing's
own branding at yourmatesbrewing.com, and the header logo is hotlinked
directly from the site.

**Product photos.** Every SKU that currently has a matching product on
yourmatesbrewing.com shows that product's real photo (23 of the 25 SKUs —
**Jeff Juicy** and **Cider** aren't currently sold on the site, so those two
show a plain initials circle instead). All images are hotlinked directly
from yourmatesbrewing.com's own image hosting rather than downloaded/copied
into this app, so they'll always match whatever's live on the site, but it
also means they need an internet connection to load (they degrade
gracefully to an initials circle if a link ever breaks). You can change or
add any SKU's photo yourself: **Edit** it on the SKU Tool page and paste in
a new image URL.

**Banner and banner-group "logos"** are deliberately colour-badge initials
(e.g. "DM" for Dan Murphy's) rather than the retailers' actual logos —
BWS, Dan Murphy's, Liquorland, etc. are third-party trademarks, so this app
doesn't scrape or embed them. If you'd like real retailer logos instead,
supply the image files (or approved URLs) and they can be wired in the same
way SKU photos are.
