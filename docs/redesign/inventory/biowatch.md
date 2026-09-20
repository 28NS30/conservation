# Design inventory: BioWatch International (apps/biowatch)

Scope: `app/page.tsx` (264 lines, the whole site), `app/layout.tsx`, `app/globals.css`, `components/Project.tsx`, `lib/projects.ts`, `public/badge-*.png`, `README.md`. One route (`/`), English only, a static server component with zero client JS, revalidated hourly.

Evidence note. No production HTML could be fetched: the only URL recorded in the repo is `https://biowatchintl.org` (layout.tsx:4, README) and that name does not resolve; the Vercel project in `.vercel/project.json` returned 403. Instead I rendered the existing local prerender (`apps/biowatch/.next/server/app/index.html`, built 19 Aug) with headless Playwright and request interception (no server started, nothing written to the repo). Layout and classes are identical to HEAD; only project names/copy in `lib/projects.ts` changed since (HabitatWatch/FireWatch became FormosaWatch/FlamaWatch). Screenshots: local captures, not committed.

## What it is for

- `/` : tell a stranger (funder, researcher, would-be partner in a third country) what BioWatch is in ten seconds, and send them through a door to the project for their country. Secondary: invite people to reuse the data or start a project of their own.
- There is no other page: no about, no contact form, no 404 styling, no favicon, no OG card.

## What is on screen today

### Desktop (1440 wide, page is 2,973px tall)

1. Header, 77px. Left: a typographic lockup, "BIOWATCH" 16px tracked 0.2em over "INTERNATIONAL" at 9px tracked 0.3em. Right: three 12px anchor links (Projects, Method, Get involved). No emblem, no language switch.
2. Hero, to about y=590. 11px ember eyebrow "OPEN ENVIRONMENTAL MONITORING", then the h1 "The damage nobody writes down is the damage nobody fixes." at 48px semibold on two lines, an 18px three-line paragraph, an ember pill "See the projects" and an outline pill "How it works". Everything is left-aligned in a max-w-3xl column; the right 40% of the hero is empty paper. The eye lands on the headline, which is good, and then has nowhere to go: there is no image, mark or number above the fold. At 1440x900 the tops of the two badges are just cut off by the fold.
3. "Two places, one method" on a paper-100 band: h2, two-line intro, then two equal cards side by side. Each card: 96px round badge, project name in its own language (20px), 11px tracked ember latin name, place, a bold one-line "watches", a four-line 14px body, a rule, three stats (18px figure over 11px label), and an ember text link "Open FormosaWatch ->". The whole card is one `<a>`.
4. "The method": eyebrow, h2 "Anyone can report it. Everyone can see it.", three columns each with a 36px outlined numeral circle, a 16px heading and a 14px paragraph of four to five lines.
5. "Built to be copied" on paper-100: two paragraphs left, a 2x2 grid of small bordered tiles right (Open data / Open models / No accounts / Local first, 14px title over 12px line).
6. "Get involved": three equal bordered cards, each heading + paragraph + ember text link. Two of the three links are `mailto:`; the first just scrolls back up to #projects.
7. Footer: the lockup again, a one-line mission, right-aligned 12px links to the two projects and the email address.

Overall: five sections of identical vertical rhythm (py-20/24), alternating paper-50 and paper-100, nine bordered rounded cards, roughly 500 words of body copy, two small images. Calm, legible, competent, and generic.

### Phone (390 wide, page is 4,808px tall, about 5.7 screens)

Header lockup and the three nav links share one row with about 35px between them; it fits at 390 but has no slack for 320-360px. Fold = eyebrow, h1 at 36px on four lines, six-line paragraph, the two pills side by side. No image until the second screen. Project cards stack; "PROJECT FORMOSAWATCH" tracked caps wraps to two lines beside the badge; the three-column stat grid survives but every 11px label wraps to two lines. Method steps, the 2x2 tiles and the three involve cards all stack into one long column of similar-looking grey-green paragraphs. Nothing breaks; nothing stands out after the headline.

## Components

| File | Role | Used by | Verdict | Note |
|---|---|---|---|---|
| `app/page.tsx` | entire page: header, hero, 5 sections, footer, all copy inline | route `/` | rebuild | Structure is sound; cut sections and words, extract header/footer, give the hero a visual |
| `components/Project.tsx` | project "door" card; declares the `Project` type | page.tsx:94 | restyle | Right idea (badge-led door). Make the badge much bigger, add per-stat provenance, fix dd-before-dt order (:57-64), drop unused `live` or use it |
| `lib/projects.ts` | project copy, URLs, live count fetch with soft failure | page.tsx:18-19 | keep (edit copy) | Fetch/fallback logic is load-bearing; copy and stat labels need truth fixes |
| `app/globals.css` | tokens copied verbatim from apps/web (diff of `--color-*`/`--font-*` is empty) | layout | keep, trim | Carries bark/parchment/scale/moss map tokens this page never uses; `color-scheme: dark` on a light page (:89) |
| `app/layout.tsx` | metadata, `<html lang="en">` | all | keep | Needs icon + OG image; description says "currently in Taiwan and Colombia" |
| header/footer lockup | typographic stand-in for a missing emblem | page.tsx:26-33, 239-244 | rebuild | README "Known gaps" already says a third badge should be drawn |
| `public/badge-*.png` | 512px project badges | Project.tsx | keep until redrawn | Both still carry old names in the artwork |

## Design problems

1. The parent has no identity of its own. The header is 16px tracked caps over 9px tracked caps (page.tsx:26-33); FormosaWatch's home opens with a 320px emblem (shots/home-en-fold.png). The child looks like the institution and the parent looks like its terms page. The owner asked for "a lot bigger" logo with "only a little bit of text"; this page has the inverse. (biowatch-desktop-fold.png)
2. Nothing to look at above the fold on either viewport. The only pictorial assets the organisation owns, the two badges, are shown at 96px (Project.tsx:37-38) and start below the fold. The hero's right 40% is blank on desktop.
3. Both badges contradict the text beside them. The artwork reads "PROJECT ECOWATCH / 生態守望計畫" next to the heading 福爾摩沙守望計畫, and "PROYECTO FIREWATCH" next to "Proyecto FlamaWatch" (public/badge-formosawatch.png, badge-flamawatch.png). At 96px on a 2x screen the lettering is legible enough to notice. A visitor deciding whether this is a real organisation sees two names per project.
4. Too many words in too many identical boxes. Six sections, nine bordered rounded cards, about 500 words, all at 14px ink-600 with the same py-20 rhythm (page.tsx:83, 103, 147, 190). "The method", "Built to be copied" and the four tiles say the same thing three times. After the headline there is no second focal point (biowatch-desktop-full.png).
5. Small-text idiom. 9px "International" (page.tsx:30, 242), 11px eyebrows (:50, :104), 11px stat labels (Project.tsx:61) and 11px tracked latin name (Project.tsx:43), 12px nav (:34). Nav links have no padding, so tap targets are about 16px tall on a phone.
6. Statistics look equally current and are not (verified claim biowatch-stats). FormosaWatch's count is live-or-hardcoded-fallback with no label (projects.ts:65, :69); FlamaWatch's "171 wildfires in 2026" etc. were copied on 11 Aug with no as-of date (projects.ts:90-94); `live` is declared (Project.tsx:16) and never rendered. "2011–" / "years covered" (projects.ts:72) implies records run to today; FormosaWatch's own ribbon says 2011–2017.
7. The page implies BioWatch operates both projects. "Two places, one method" (page.tsx:85), "Two countries is enough to prove it travels" (:161), "Everything we have learned is yours" (:210), the footer listing both under the BIOWATCH lockup (:251-255), and a default FlamaWatch URL on a biowatchintl.org subdomain (projects.ts:15-17). The code comments and README say FlamaWatch is a separate organisation with an unconfirmed address. This breaks a standing owner decision.
8. Claims ahead of reality. "CC BY, published back to GBIF" (page.tsx:168) and "published back to the global biodiversity record" (:126): nothing has been published to GBIF. "Use the data" (:203-207) promises access and delivers a mailto to an address the README calls a placeholder.
9. Language handling. `<html lang="en">` with an untagged Chinese heading and Spanish name (projects.ts:57, :80), so the `:lang(zh-TW)` rule in globals.css:102 never matches and screen readers read 福爾摩沙守望計畫 with an English voice. The parent of a zh-TW-first project and a Spanish project is English-only.
10. Loose ends a visitor can hit: no favicon, no OG card (README known gaps), `color-scheme: dark` gives dark scrollbars on a paper page (globals.css:89, same defect as verified claim dark-tokens-on-light item 3 in apps/web), README documents `NEXT_PUBLIC_FIREWATCH_URL` while code reads `NEXT_PUBLIC_FLAMAWATCH_URL`, and the recorded domain does not resolve. FormosaWatch never links back to BioWatch (no match for "biowatch" anywhere in apps/web).

## What works

- The headline. "The damage nobody writes down is the damage nobody fixes." is the best sentence on either site; keep it and let it carry more.
- "Deliberately not a map" (page.tsx:9-16). Correct, and it matches the owner's coolness toward map-as-hero.
- The badge-led door card as a concept (Project.tsx:20-26): two hand-drawn badges from one hand are the family resemblance. They just need to be large.
- Project names in their own language first.
- Live count with soft failure: `formosawatchCounts()` returns null on error/timeout so the parent never 500s because a child is down (projects.ts:19-46).
- Zero client JavaScript, no fonts to download, two images: it is fast by construction.
- Shared, contrast-documented tokens (globals.css:14-33) and clean semantics: one h1, ordered list for steps, dl for stats, decorative badge `alt=""`.
- The privacy sentence in step 3 ("a precise map of an endangered animal is a map for poachers") states the location policy better than FormosaWatch does.

## Constraints a redesign must respect

- FlamaWatch is a separate organisation and site. Link to it as a partner; do not imply shared operation, do not invent its URL, and treat its figures and badge as theirs (source + date).
- Independence: "must not depend on the other's build" (globals.css:4-9); subdomains not subpaths, for Turnstile-hostname and cron-path reasons (README). Tokens are copied on purpose; if they are ever shared, it must be build-time only.
- The only runtime link to FormosaWatch is one hourly fetch of `/api/health` (counts only) with a 5s timeout and null fallback. Any "example record" shown here must come from a public FormosaWatch endpoint backed by `reports_public`, never from the database, and never with exact coordinates of obscured records.
- Data truths: all FormosaWatch records are imported TaiRON roadkill, 2011–2017, CC BY 4.0; no user reports, no report photos, no licensed wildlife photography; nothing published to GBIF. No "nobody has reported yet" sentence. Credit TaiRON where its numbers are quoted.
- Badges stay as drawn until the team redraws them; a larger badge makes the old lettering more visible, so sequence the redraw first or crop/mask the ring.
- Provenance has to be per stat, not per card (species can fall back while records is live; "2011–" is always static).
- Keep it static: no client bundles, no map, no web-font payload that FormosaWatch does not also adopt.
- WCAG 2.2 AA: ember-500 fails as text on paper (3.0:1), use ember-700; ink-500 is the quietest passing text. Tag non-English strings with `lang`. No letter-spacing on CJK.
- A Tailwind class without a matching `--color-*` token emits nothing, and this app has no design-tokens test and is not covered by CI (`.github/workflows/ci.yml` has no biowatch step).
- Visual relationship: same paper/ink/ember family and the same type system as FormosaWatch, but BioWatch should be the quieter frame around two loud badges, not a third competing brand. Redesign it after the FormosaWatch direction is proven, and inherit from it.

## Verified review claims in this area

- `biowatch-stats` (medium, hours): fallback and static figures are unlabelled, `live` is never rendered, "Use the data" is a mailto, GBIF tile overstates, and the page implies a common operator with FlamaWatch. Correction from verification: provenance must be per stat; there is no data-access destination yet, so point at FormosaWatch `/attribution` or `/reports`.
- Related, living in apps/web but mirrored here: `gbif-copy` (same overstatement at page.tsx:126, :168), `tiny-text` (9-11px idiom), `dark-tokens-on-light` item 3 (`color-scheme: dark`), `header-badge` (the old-name badge artwork, which this page also displays, for both projects).

## Questions for the owner

1. Is BioWatch International launching at all in the near term (the domain does not resolve)? If not, should this page be frozen until FormosaWatch's redesign is proven?
2. What is BioWatch's actual relationship to FlamaWatch today: founder, partner, or just a link? Do we have permission to show their badge and figures, and what is their real URL?
3. Will a BioWatch emblem be drawn in the same hand as the two badges, and will the two badges be redrawn with the current names at the same time?
4. Should the parent be English-only, or carry zh-TW and Spanish summaries?
5. Does `hello@biowatchintl.org` exist? If not, which address goes on the page?
6. Should FormosaWatch link back to BioWatch (footer credit), or is the parent meant to stay invisible from the child?
7. How short may this page get? A version with hero, two large badge doors and one contact line is possible; is "the method" and "built to be copied" content you want kept?
