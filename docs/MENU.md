# The menu

111 dishes, seeded from the printed CHIRI Kitchen card in `server/photo-menu.mjs`
and generated from there into three places that must not drift: the SQLite
schema the Node server builds, `migrations/0002_seed_catalog.sql` for D1, and
`apps/customer-app/src/app/bundled-catalog.json`, which is what a tablet shows
when it cannot reach a server. `npm run server:test` fails if any of them is
stale.

## Taking a dish apart

A dish arrives as one line of German — `Ramen, Gemüse, Ei` — and a set of
allergen letters that apply to the whole bowl. A guest who reads `A · C · F`
learns that gluten, egg and soy are in there somewhere, but not where, so the
question they actually have ("which part is the egg, and can it be left out?")
goes unanswered.

`packages/domain/src/ingredients.ts` answers it. Every German term this menu
uses has its Chinese and English name and the allergens that term carries, and
`deconstruct()` turns a dish into its parts with the letters attached to the
part they come from. The back of the dish card is that breakdown.

One rule makes it safe to show a guest:

> A letter appears on a part only if the dish already declares it.

An allergen declaration is a legal statement under the LMIV. The glossary may
explain one; it may never make one. Sesame in an ingredient list does not put
`N` on a dish whose row does not have it — `tests/app.spec.js` asserts exactly
that, with a fixture that contains sesame and declares only fish. Anything
declared that no ingredient accounts for is shown under its own heading rather
than dropped, because shrinking a declaration is the one failure that matters.

## What the breakdown says about the data

About 54% of the declared letters cannot be pinned to a named ingredient, and
almost all of those are `A`, `F` and `N` — wheat, soy, sesame, which is to say
soy sauce and sesame oil. The printed menu names what a guest can see in the
bowl and not what the wok was seasoned with. That is a property of the source,
not a defect in the glossary, and the fix is the kitchen filling in the
ingredient lines rather than anything in code.

A smaller set is worth an actual answer from the kitchen, because the letter is
one an ingredient list would normally show:

| | |
|---|---|
| M3 Avocado Maki, V10 Avocado Salat | declare `D` (fish) with no fish in the ingredients |
| U5 Yaki Udon Ebi | declares `D`; prawns are `B` — is there dashi in it? |
| H1–H4 Hot Pot | declare `E` (peanut) — from the dipping sauce? |
| N1-6, N1-10, S3-9, S3-18 | declare `B` (crustaceans) for sets listed as salmon and tuna |

Wine declaring `O` and espresso `G` need no explanation; the ingredient line is
a volume.

`packages/domain/test/ingredients.test.ts` fails when a dish uses an
ingredient nobody has translated, so a new dish cannot quietly show a German
word to a guest reading Chinese.

## Dishes the printed menu has and the app does not

Found by reading the printed card against the seed. Each needs a price and an
allergen line before it can be added:

- `C1`–`C5` FRIED RICE CAKE
- `K1`–`K4` POKE BOWL
- `I1`–`I4` INARI MAKI
- `V19`, `M8`, `X10`, `D4`, `E3`

Three SKUs differ in naming rather than being missing: `N1-6`/`N1-10`,
`S1-9`/`S1-18` and `T4C` are the app's spelling of cards that print them
differently.

## Photos

Every dish has a picture slot, in the list and on the detail card, and none of
the 111 has a picture. Until one does, the slot holds generated artwork keyed
by kind, which is deliberately quiet rather than decorative.

Three things are needed, in this order:

1. **The files.** Shot straight down on the dish, same distance and same light
   for all of them; a menu photographed inconsistently looks worse than one
   with no photos at all.
2. **Somewhere to put them.** `POST /api/admin/products/:id/media` writes to
   disk, which the Worker does not have — on Workers this is R2, and the route
   answers 501 rather than pretending to succeed. See `docs/D1.md`.
3. **Sizes.** One 1600px original per dish, a 96px thumbnail for the list, and
   `loading="lazy"`, which the list already sets. 111 full-size images over a
   restaurant connection is not a menu, it is a stall.

A pixel-level "explode" of a dish photo was tried and does not work: a flat
photo has no alpha channel, so moving a layer off it does not remove it from
the picture underneath and the dish appears twice. The breakdown above is what
replaced it, and it has the advantage of working from data the menu already
has.

## The room

`GET /api/admin/tables/overview` is the floor's view: every registered table,
its state, and the orders on it that are not yet billed. It carries no entry
tokens — those stay on `/api/admin/tables`, which is the manager's.

A table is `free`, `seated` or `locked`. The first two follow from whether it
has open orders. `locked` is set by hand from the 桌位 page and is service
state, not configuration: `enabled` takes a table out of the room altogether,
while a lock stops it adding to a bill that is about to be settled. A locked
table refuses new orders with 409, and the guest app says why rather than
telling them their cart is wrong.

Settling the bill releases the lock, so nobody has to remember to unlock a
table after the guests pay.

A table with orders on it that nobody registered still appears, marked 未登记 —
someone scanned a card that was later deleted, and hiding it would not make its
bill go away.
