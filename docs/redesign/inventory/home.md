# Design inventory: home

Scope: `apps/web/app/[locale]/page.tsx` (497 lines, one server component, no client JS of its own), the two queries it takes from `apps/web/lib/stats.ts` (`anniversaryLedger`, `mapEntrySpecies`) plus its own inline `getStats()`, and the `home.*` message block (49 keys per catalogue). Routes: `/` (zh-TW) and `/en`. Screenshots: `home-fold`, `home-full`, `home-phone-fold`, `home-phone-full`, and the `home-en-*` set. Crops I made while reading are in `inventory/crops/`.

## What it is for

- `/` and `/en`: tell a stranger in one glance what this is and whose it is, and get them to one of three places: file a report, open the map, or read who runs it. It is also where a Taiwanese visitor who recognises 路殺社 data decides whether the site is honest about it.

## What is on screen today

Desktop, 1440x900 (`home-fold.png`, `home-full.png`; 3,355px tall, about 3.7 screens):

1. Sticky header (56px): 32px badge + small tracked wordmark, four nav links, language switch, ember "+ 通報" pill.
2. Provenance strip: near-black band, one line of 11px mono in dim parchment: "46,334 筆紀錄 · 2011–2017 · 來源：路殺社（TaiRON）經 GBIF 釋出 · CC BY 4.0". It is the only dark element on the page and the first thing under the nav.
3. Hero: 320px badge on the left; on the right the name at 50px with wide tracking, a small tracked "PROJECT FORMOSAWATCH" with an ember dot, a hairline, then the one-line tagline at 19px. The eye lands on the badge, then the name. It works as an opening, but the right column is a thin stack beside a heavy circle, and roughly 400px of paper to its right is empty.
4. "你看到了什麼？" at 30px with a 14px hint on the same baseline, then three equal bordered cards (the "doors") with a 6px colour bar on top (amber, green, red), a 17px title, a 12px grey description and a small arrow. Everything up to here clears the fold.
5. A 13px grey text link, "第一次來？...".
6. Map band (tinted paper): tiny ember kicker, a 24px sentence, two labelled rows of small outline pills (3 animals, 4 places), and a lone "查看完整地圖 →" text link bottom right. No image of any kind.
7. Three text columns with tiny tracked ember headings: what this is / who runs it / 路殺社.
8. Ledger: 30px heading, hint, a dashed ember "blank" row ("通報第一筆 →"), then ten rows of mono date | name + italic Latin | mono lat,lng. Two links under it.
9. "How it works": kicker, 30px heading, three numbered columns.
10. Two-column trust/open-data text block, each ending in a text link.
11. Closing heading, paragraph, the page's only filled button ("通報一筆").
12. Footer.

Phone, 390 wide (`home-phone-fold.png`, `home-phone-full.png`; about 4,580 CSS px, 5.6 screens): header, a second nav row, then the provenance strip on two lines (three in English), so about 150-165px of chrome sits above the identity. The badge (172px) stays beside the name, which breaks cleanly into 福爾摩沙 / 守望計畫; tagline at 13px. The three doors stack as list rows with the colour on the left edge and all clear the fold, which is the best part of the phone page. Below that every section stacks into one long column of 14px grey paragraphs; the ledger loses its coordinates column and reads better for it.

English differences (`home-en-*.png`): the h1 is still the Chinese name with the Latin name tiny beneath it; "By animal" pills are italic Latin binomials (*Duttaphrynus melanostictus*), because `taxa` has no English common name; ledger rows lead with the binomial.

## Components

| file | role | used by | verdict | note |
|---|---|---|---|---|
| `app/[locale]/page.tsx` | whole page, inline sections | `/`, `/en` | rebuild | Eight sections in one file; no reusable section components. Keep the docblock reasoning. |
| `page.tsx:39-48 getStats()` | count, species, obscured, year range | home only | merge | Duplicates `stats.ts overview()` and runs on `sql`, not `asPublic` (reads `reports_public`, but not as `web_anon`). Use `overview()`. |
| `page.tsx:55-60 MAP_PLACES` | four z11 map entry points | home; mirrored by hand in `test/home.test.mjs:18-23` | keep | Move to shared/lib so the test imports it. |
| `page.tsx:70-74 DOORS` | three report doors from `REPORT_GROUPS` | home | restyle | Generation from the shared constant is load-bearing; the card look is not. |
| `lib/stats.ts anniversaryLedger` | 10 records from this calendar week in past years | home | keep query, restyle output | Well reasoned (MM-DD window, excludes obscured). Has no place name to show. |
| `lib/stats.ts mapEntrySpecies` | top 3 non-sensitive species with zh names | home | keep | Sensitivity filter is tested against the rendered links. |
| `components/brand/Badge.tsx` | 512px PNG via next/image, clipped round | home hero, /about, Wordmark | keep | Docblock still refers to a deleted `Mark`. |
| `components/brand/Wordmark.tsx` | badge + name for header/footer | SiteHeader, SiteFooter | restyle | 28-32px badge is illegible; Latin line is 8-9px. |
| `components/site/SiteHeader.tsx` (`variant="page" wide`) | header | all pages | restyle (shared area) | `wide` exists only to align with home's 1100px column. |
| `components/site/SiteFooter.tsx` | footer with obscured count | all pages | restyle (shared area) | |

## Design problems

1. One strong moment, then seven sections at the same volume. After the hero, every band is a heading plus 14px grey text in a 1100px column on alternating paper tints (`home-full.png`). Nothing changes scale, so nothing after the fold is memorable. `page.tsx:274-492`.
2. The owner dislikes the doors, and the doors are the page's main action. They are pale bordered cards with a 6px colour bar and 12px descriptions (`page.tsx:226-258`), the same "pills and small labels" language they objected to on the form. The doors also put roadkill last, though it is the only thing the dataset holds and the most likely report.
3. The map band promises a map and shows none. Small outline pills under a sentence (`page.tsx:274-325`) look like filters, not invitations. The owner rejected the data-art island; the replacement swung to having no picture at all, so the site's best asset is invisible on its front page.
4. Too much explaining, some of it three times. "No account", "blurred locations", "GBIF/Darwin Core" and "one photo, one pin" each recur across askHint, whatBody, how1-3, trustBody, openBody and closeBody. The owner asked for fewer words; below the fold the page carries about 375 English words (about 720 Chinese characters).
5. Two statements on the same page contradict each other: whatBody and taironBody say records "are published back to GBIF" (`page.tsx:331,333`, `en.json home.whatBody`), openBody says "we plan to". Only the second is true.
6. The ledger's blank row. "通報第一筆 / File the first one" and "第一列是空的" (`page.tsx:368-378`) do not say first of what, and sit close to the owner's rule against "nobody has reported yet" sentences. On desktop each row ends in raw `lat, lng` (`page.tsx:402-404`), which means nothing to a reader; there is no place-name data to substitute.
7. Type sprawl: about fifteen distinct sizes in one file (9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 24, 30, 40, 50px), four of them at or under 13px and used 16 times. The Latin name is 9px on phones (`page.tsx:200`); kickers are 11px with 0.18em tracking, which on Chinese labels (地圖, 誰在做) spaces the glyphs apart for no gain (`page.tsx:277,343,429`). The h1 itself carries 0.12em tracking on Hanzi.
8. The badge is the hero and is wrong and soft: it letters 生態守望計畫 / PROJECT ECOWATCH directly beside an h1 reading 福爾摩沙守望計畫, and 320px on a 2x screen exceeds the 512px source (`page.tsx:86-91`). Known and accepted for now, but any redesign that enlarges it further makes both worse.
9. Provenance is honoured in position but not in form: 11px dim mono on black reads as a system status bar, and on a phone it and the two header rows push the identity 150px down (`home-phone-fold.png`).
10. English is second-class in two visible places: Latin binomials as "By animal" buttons and ledger names, and an h1 an English reader cannot read with the readable name at 13px beneath it (`home-en-fold.png`, `crops/home-en-mid1.png`).
11. "Who runs it" says "Write to Neo Su" with no link or address (`whoBody`), and the column is half the height of its neighbours.

## What works

- The badge-beside-name hero does what the owner asked, holds at every tested width, and the zh name never breaks mid-word.
- Doors carry the category into `/report`, so choosing and starting are one act; on a phone they read as a clean list and clear the fold.
- Crediting 路殺社 before asking for anything is the right instinct and a standing decision.
- The anniversary ledger is the one idea with texture: real dates, real species, different every day, cheap to render.
- The page ships no map code, no client components of its own, revalidates every 300s, and preloads a phone-sized badge.
- zh copy is plain and direct; the tagline is good in both languages.

## Constraints a redesign must respect

- Privacy: ledger excludes obscured records and entry species exclude anything with a sensitivity or protected status (`stats.ts:106-119,165`; asserted in `test/home.test.mjs:62-80`). All home queries should go through `asPublic`.
- Performance: no MapLibre or tiles on this page (`page.tsx:268-273`); `/field.svg` must stay gone (tests assert 404). Any map picture must be a static asset, not a live map.
- Tests that pin layout: `e2e/pages.spec.mjs:87-165` fixes badge width (320/272/172/<=158), exactly three `a[href*="/report?category="]` above the fold from 360px up, Latin name on one line, no mid-half name breaks, no sideways scroll at 320px. `test/home.test.mjs` pins the tagline string, the badge preload `imageSizes`, three `/map?taxonId=` links, four `z=11` place links, `lang="zh-TW"` inside the English h1. These encode the current design and must be rewritten with it, not worked around.
- Doors must stay generated from `REPORT_GROUPS` and labelled from `report.group.*` so home and form cannot drift.
- Data truths: no photos exist, records end 2017-12-31 (a "latest records" list would show one date), all records are roadkill, nothing is on GBIF. `ledgerHint` hard-codes "2011–2017".
- i18n: every string in both catalogues; door colours come from `CATEGORIES[*].color` inline styles, not tokens; any new Tailwind colour class needs a `--color-*` token.
- Owner decisions: no count-led hero, no data-art island, credit 路殺社 fully (the strip's outbound link to roadkill.tw is the one place readers are sent away; confirm it stays).

## Verified review claims in this area

- `ledger-coords` (medium): ledger rows show raw lat/lng and the blank row does not say first of what; there is no place-name data anywhere.
- `gbif-copy` (medium): home.whatBody and home.taironBody claim GBIF publication in the present tense; home.openBody on the same page says planned.
- `header-badge` (low): the full badge is rendered at 28-32px in the header and footer on this page; the simplified Mark was deleted deliberately.
- `tiny-text` (medium): cites `page.tsx:200` (9px Latin name on phones) and the 8-9px Wordmark.
- `report-prefill` (low, context): the home doors are the only links that pass context into `/report`; the pattern to copy.
- `injured-guidance` (medium, context): suggests `home.doorRoadkill` could say the site records but cannot send help.

## Questions for the owner

1. If "你看到了什麼？" and the three doors go, what is the front page's main action: one "通報" button, or still a choice of three presented differently?
2. You rejected the island-of-records image. Would a plain, static picture of the real map (a cropped screenshot of a familiar area) be welcome, or no map imagery at all?
3. Does the anniversary ledger stay? If so, may the blank first row and "通報第一筆" go, given your rule about not saying nobody has reported?
4. How much of the explanation belongs here versus /about? Could the page end after hero, action, map and one credit line?
5. Should the 路殺社 credit stay as a bar above everything, or become a designed line inside the hero?
6. On /en, should the large name be "Project FormosaWatch" with the Chinese secondary, or stay Chinese-first?
7. When is the badge redraw due, and will it be SVG? The hero cannot grow until it is.
