# Inventory: tests, CI and design tooling (area "tests")

Scope: `apps/web/e2e/*`, `apps/web/test/*.test.mjs`, `scripts/verify-deploy.mjs`, `apps/web/eslint.config.mjs`, `.github/workflows/ci.yml`. Read at c73bb8d. Nothing here is visitor-facing; it is the net a redesign falls into. `apps/biowatch` has no tests at all and CI never lints, typechecks or builds it.

## What it is for

- `pages.spec.mjs` (CI): every route renders in a real browser in both locales with no leaked i18n key, no client exception, no 5xx; plus the home layout promises and the map's a11y/URL contract.
- `focus.spec.mjs` (CI): every Tab stop on 7 pages shows a ring.
- `map.spec.mjs` (CI): the map actually paints; writes `e2e/map-render.png` (committed, uploaded as CI artifact). Prints JSON, asserts nothing, always exits 0.
- `offline.spec.mjs` (CI): queue offline, flush once, leave a receipt, no duplicate.
- `test/*.test.mjs` (CI, `node --test` against the running build + PostGIS fixture): privacy, tiles, stats, i18n parity, and several markup/copy pins.
- `_shots.mjs`, `_contrast.mjs`: manual design helpers, not in CI, hard-coded to `localhost:3000`.
- `verify-deploy.mjs`: manual post-deploy smoke test against production.
- Lint: stock `eslint-config-next` + unused-vars. No design rules of any kind.

## What is on screen today (the layouts these tests pin)

- Home, desktop (`home-fold.png`): 320px pangolin badge left, 福爾摩沙守望計畫 h1 + tracked "PROJECT FORMOSAWATCH" + one-line tagline right; then "你看到了什麼？" and three bordered door cards with coloured top rules, all above an 900px fold. Below (`home-full.png`): map pills (3 animals, 4 places), three text columns, the anniversary ledger with raw coordinates, a 3-step strip, two explainers, closing CTA, footer. The eye lands on the badge, which still reads PROJECT ECOWATCH. Everything after the doors is small grey text of near-equal weight.
- Home, phone (`home-phone-fold.png`): 172px badge beside a two-line h1 (福爾摩沙 / 守望計畫), doors stacked with a left colour bar; all three doors fit in 844px. This is exactly what `checkHome` enforces.
- Report (`report-fold.png`, `report-phone-fold.png`): "新增通報", then pill buttons (selected = solid near-black), sub-pills, a species input, a bare dashed "+" photo box, dark mini-map with a default pin. `report-form.test.mjs` recognises the selected pill by its Tailwind classes.
- Map (`map-fold.png`, `map-phone-fold.png`): dark full-bleed canvas, rainbow dots, 篩選 pill top-left, legend card bottom-right; phone header drops the nav row entirely. The committed `e2e/map-render.png` is the same view at 1280 with the Next dev "N" badge baked in, i.e. it was shot from a dev server and is not a usable baseline.
- Season (`season-fold.png`): "0 / 40" card; the test pins the covered-square number and one English sentence.
- Species detail (`species-detail-en-fold.png`): 10px status chips; tests pin chip text ("CITES Appendix II<", "IUCN Vulnerable").
- Login (`login-fold.png`) and 404 (`notfound-phone-fold.png`, which has no site header): no browser test covers either.

## Components

| file | role | used by | verdict | note |
|---|---|---|---|---|
| e2e/pages.spec.mjs | render + i18n leak + home layout + map a11y/URL | CI | keep, rebuild `checkHome` | lines 87-167 pin today's hero; rest is invariant |
| e2e/focus.spec.mjs | focus ring on every Tab stop | CI | keep, widen | add /login, /season, species + report detail, /en, phone width |
| e2e/map.spec.mjs | proves WebGL paint | CI | rebuild | asserts nothing (no `process.exit(1)`); turn JSON into assertions |
| e2e/map-render.png | "baseline" | git, CI artifact | delete from git | overwritten on every run, never compared |
| e2e/offline.spec.mjs | offline queue e2e | CI | keep | design-agnostic (drives IndexedDB, not the form) |
| e2e/_shots.mjs | full-page screenshots | manual | rebuild | 9 routes, 1180/390 only, zh only, fixed sleeps, localhost only |
| e2e/_contrast.mjs | rendered AA contrast audit | manual | keep, promote to CI | 8 routes, zh only; depends on `data-on-dark` marker and hard-coded paper `[250,247,240]` floor |
| test/design-tokens.test.mjs | class -> token existence | CI | keep, extend | `FAMILIES` list is hard-coded |
| test/home.test.mjs | home copy, doors, links, preload, ledger SQL | CI | split | half invariant, half markup |
| test/report-form.test.mjs | category deep-link contract | CI | restyle | `selected()` matches `bg-ink-900 text-paper-50` |
| test/sign-in.test.mjs | /auth/callback routing | CI | keep | reads login page path; no markup |
| test/tiles.test.mjs, map-bins, basemap, privacy, stats, coverage, export, my-reports, admin-auth, team, i18n, species | data, privacy, perf contracts | CI | keep | a few string pins, listed below |
| scripts/verify-deploy.mjs | production smoke | manual | keep, loosen one check | "wordmark" regex on home HTML |
| eslint.config.mjs | lint | CI | extend | no a11y plugin beyond next defaults, no class/type-scale rule |
| .github/workflows/ci.yml | pipeline | GitHub | extend | one job; biowatch absent |

## Design problems

1. The home hero is pinned to the pixel. `pages.spec.mjs:90-97` expects badge widths 320/272/172/<=158 at six viewports, `:150` exactly three `a[href*="/report?category="]`, `:151` doors above the fold, `:105` a span reading "Project FormosaWatch" on one line, `:132` `[lang="zh-TW"] > span` halves. The intent (big badge, little text, action above the fold, no mid-name break, no sideways scroll, `lang` on the Chinese name) is the owner's brief and must survive; the numbers and selectors (`main section img`) will fail on the first new composition.
2. `home.test.mjs` hard-codes copy and structure: the zh tagline (`:30`), the English tagline (`:58`), the preload `imageSizes="(min-width: 1024px) 320px` string (`:37`), exactly 3 taxon links and exactly 4 place links with `z=11` (`:51`, `:70`), and a hand-mirrored `MAP_PLACES` array (`:18`). Any copy edit or a home that drops the pills fails CI for non-reasons. The sensitive-taxon check (`:62-80`) and non-empty-place check are real invariants and should follow whatever replaces the pills.
3. `report-form.test.mjs:31` finds the chosen category by the class string `bg-ink-900 text-paper-50`, and `:24` by `<h3>牠還活著嗎？</h3>`. The owner wants the pills gone; the contract (door -> preselected group, unknown -> fallback, injured -> roadkill group, `aria-pressed`) is sound but should be read from `aria-pressed="true"`/`aria-checked`, not from colours or heading level.
4. Only home is ever tested below 1000px. `pages.spec.mjs:180` runs every other page at 1000x800, focus at 1100x850, map at 1280x800. Verified claim `map-mobile-nav` (phone map has no nav) lives exactly in this blind spot; a phone-first redesign has no guard.
5. No visual regression exists. `_shots.mjs` writes to a gitignored folder, compares nothing, skips season/privacy/login/me/404/report-detail and all `/en` routes, uses 1180 not 1440, and sleeps 15s per map page. `map-render.png` is overwritten each run (`map.spec.mjs:100`), so it records the last run, not a baseline.
6. `map.spec.mjs` cannot fail: it logs `renderedByMode`, `missingLayers`, console errors and exits 0. The CI step named "Map renders end to end" proves only that Chromium launched. The performance work the owner cares about has no budget test either: nothing asserts time-to-first-tile, the MapLibre module preload, or content-page bundle size.
7. Contrast is audited by hand. `_contrast.mjs` is the best tool in the folder and found real bugs (4.05:1 parchment-500; a 1.06:1 chip), but CI never runs it, so verified claim `dark-tokens-on-light` shipped. It also assumes the page floor is `#faf7f0` (`:110`) and the map chrome is `#0b1410` (`:99`); a new palette silently skews it.
8. Nothing enforces type scale or target size. Verified claim `tiny-text` (10px chips, 9px chart labels, 20px remove button) is invisible to every check. `design-tokens.test.mjs` covers colour steps only, and its `FAMILIES` list (`:20`) means a newly named family (or `sky-*`, which caused `dark-tokens-on-light`) is simply not inspected.
9. No axe/ARIA scan. `pages.spec.mjs:273-287` checks accessible names on /map only; `login-a11y` (unlabelled input, no form) and `chart-a11y` pass CI. `focus.spec.mjs` omits /login, /season, species detail, report detail and skips date inputs by design (`:46-50`).
10. Drift in hand-kept lists: `pages.spec.mjs:48-71` NAMESPACES lacks `team` (present in `messages/en.json`), so a leaked `team.*` key would pass; PAGES lacks /login, /reports/[id], 404 and most `/en` routes.
11. `verify-deploy.mjs:67-71` decides "is this the new build" by finding `project formosawatch` in home HTML, and `:59` by the zh `<title>`. A logo-only hero or an SVG wordmark breaks the first; keep a text alternative or switch to a build-id meta tag.
12. String pins in otherwise sound tests: `coverage.test.mjs` requires "left out of the squares above"; `species.test.mjs` requires `CITES Appendix II<` (chip text followed by a tag) and "IUCN 易危"; `map-bins.test.mjs:58` requires the literal `["heat","bins","dots"]` order. These protect real decisions (exclusion disclosure, Taiwan wording, countable default) but will break on copy polish.

## What works

- Tests explain why they exist; nearly every assertion records the bug that motivated it. Keep that habit.
- Privacy is tested at the right layer (SQL roles, the view, the trigger) and is untouched by any visual change: `privacy.test.mjs`, `my-reports.test.mjs`, `admin-auth.test.mjs`, tile bounds.
- `tiles.test.mjs` "transfer" block and `verify-deploy` gzip/Vary checks guard the map speed the owner asked for.
- i18n parity, placeholder parity, CJK-ratio guard, leaked-key scan in a real browser, and explicit locale per context (`pages.spec.mjs:179-182`).
- Skip-link-before-canvas, replaceState URL sync, focus-ring sweep: real a11y/UX invariants phrased independent of styling.
- `_contrast.mjs` composites alpha layers properly and measures own text nodes; it is CI-ready with a base URL and exit code.
- `team.test.mjs` (no invented people) and the `/field.svg` 404 encode owner decisions.

## Constraints a redesign must respect

- Privacy: no test may be "fixed" by reading `reports`; `verify-deploy.mjs:174` scans home HTML for 5+ decimal `"lat"`. A ledger or hero that prints coordinates must stay on `location_public`.
- Home links to species must stay non-sensitive, non-protected, zh-named (`home.test.mjs:62-80`); place links must open on non-empty views.
- `window.__map` exists only under `NEXT_PUBLIC_E2E=1`; layer ids `reports-cells|dots|points|heat` and source `reports-agg` are referenced by specs.
- `data-on-dark` on overlay chrome is how the contrast audit knows the map is behind it (`SiteHeader.tsx:56`).
- Global `:focus-visible` ring in `globals.css:130`; do not add `outline-none` for looks.
- Tailwind silently drops classes without a `--color-*` token; extend `FAMILIES` when tokens are renamed, and migrate tokens and classes in one PR.
- CI runs against `next start` with a fixture DB (not 46k rows); layout tests must not depend on production counts.
- Playwright sends no Accept-Language; always set `locale` per context.
- Never reintroduce heat as default; keep density/type as a switch (`map-bins.test.mjs`).
- New zh-TW copy needs a native reader; i18n parity test will force both catalogues.

## Verified review claims in this area

No claim is about the tests themselves; these are the ones whose fix lands here or that the suite failed to catch:
- `map-mobile-nav`: no phone-width check outside home; add one.
- `lang-drops-query`: add a Playwright case that switches language with a query string.
- `tiny-text`: no type-scale or target-size lint.
- `dark-tokens-on-light`: contrast audit not in CI; token test ignores non-palette families.
- `login-a11y`, `chart-a11y`: no axe pass; /login not in focus or pages spec.
- `legend-type-heat`, `legend-points`: `map-bins` pins modes, nothing pins the legend.
- `injured-guidance`, `raw-errors`, `form-emphasis`, `report-prefill`: `report-form.test.mjs` covers doors only and pins the pill classes.
- `header-badge`, `ledger-coords`: `home.test.mjs`/`checkHome` pin the badge sizes and ledger SQL.
- `season-coverage`, `gbif-copy`: `coverage.test.mjs` / `export.test.mjs` pin data, plus one English sentence.

## Questions for the owner

1. Is "three report doors above the fold at 360px and up" still a promise, or may the new home lead with one action?
2. Are the 3-animal and 4-place map shortcuts staying? If not, the tests guarding them go too.
3. May we commit baseline screenshots (roughly 40 PNGs, a few MB) or should baselines live as CI artifacts only?
4. Which viewports are the contract: 390, 768, 1440, plus 320 reflow?
5. Should CI start covering `apps/biowatch` (lint, build, one render check)?
6. Is a slower CI (axe + contrast + screenshots, several extra minutes) acceptable?
