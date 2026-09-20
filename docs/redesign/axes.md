# The direction is nine switches, not two options

Written for the conversation about "neither Roundel nor Field journal, maybe something in between."

**In between is buildable, and cheaply.** The two directions are not two designs. They are two sets
of overrides on one shared base, and the lab's own CSS is already organised that way:

| | |
|---|---|
| `themes/base.css` | 51 tokens both directions inherit unchanged |
| set by both, **identically** | 7 tokens — already agreed, whatever you pick |
| set by both, **differently** | 39 tokens — the actual disagreement |
| Field journal only | 25 tokens — its whole type scale, its leading, its serif face, four extra semantic colours |

Counted from the files, not estimated: `themes/roundel.css` (105 lines) and `themes/journal.css`
(149) against `themes/base.css` (629).

The seven both directions already agree on are worth naming, because they are the ones nobody has to
argue about: `--lab-action` and `--lab-action-hover` (the ember, `#9a4e22`), `--lab-endemic` and
`--lab-endemic-field` (the two greens), `--lab-ink-900` and `--lab-ink-600`, and the rule that a
mixed map cell takes the lowest density step rather than a grey of its own.

## The 39 disagreements are eight decisions

Each is independently choosable. Pick a column per row.

| # | decision | Roundel | Field journal | tokens |
|---|---|---|---|---|
| 1 | **Display face** | Noto Sans TC **Black 900** | Noto Serif TC **Bold 700** (a Ming face) | `--weight-display`, `--font-display` |
| 2 | **Surfaces** | Blocks — forest and cream laid over the page | One sheet, one tinted band, dark ground only in the footer | 11 |
| 3 | **Map ground** | Dark: land is the badge's ring colour, sea near-black | Light survey sheet: pale water, a drawn coast, ink labels | 8 |
| 4 | **Density ramp** | Light means many (grass → sky on dark land) | Dark means many (ink weight on pale land) | 6 |
| 5 | **Type marks** | By **form** — solid, solid, hollow ring; mostly ember | By **hue** — madder, ochre, indigo | 4 |
| 6 | **Secondary action** | A second *material*: forest block, cream label | An outlined word | 2 |
| 7 | **Corners** | 4px | 0px | `--radius-sign` |
| 8 | **Type scale** | base.css's scale | Its own, larger and looser: body 16/1.75, masthead held at 48px on a phone instead of stepping down | 25 |

And one that is not a token:

9. **Section structure.** Roundel opens a section with a block of its own colour. Field journal opens
   it with a 2px rule and the heading out in the left margin, which is that direction's whole idea of
   hierarchy. This is the one difference that is not a colour, and it is already a switch:
   `Section.tsx` takes `heading: "block" | "margin"`, and its own comment calls it "the one
   structural difference the two directions are allowed". Everything below the heading is the same
   components in the same order either way.

## Three of these are not as free as they look

**4 follows from 3.** The ramp runs light-on-dark or dark-on-light because the eye reads weight
against the land it is on. Choosing a light map and Roundel's ramp gives you pale green on pale
paper. If you mix 3 and 4, the ramp has to be recomputed — `tools/ramp.mjs` does it, and the step
sizes in the comments (1.31 for Roundel, 1.38–1.40 for the journal) are the thing that keeps six
density classes from collapsing into each other in sunlight.

**3 reverses a decision that is on the record.** The map was decided dark. Field journal's light
survey sheet is allowed in the lab and nowhere else precisely because choosing it means reopening
that. It is question 3 on the compare page for the same reason.

**2 and 6 are one idea twice.** "Secondary is a forest block" only means anything in a design that
has forest blocks. Taking Roundel's surfaces with the journal's outlined secondary is coherent;
taking the journal's sheet with Roundel's block secondary puts the only filled dark thing on the
page on a button.

Everything else — 1, 5, 7, 8, 9 — is genuinely free.

## What a mix costs to build

A third direction is a theme file of roughly 40 lines plus a row in `LAB_DIRECTIONS`. Nothing else
changes: every page, every primitive and every test reads the tokens.

What it costs to *verify* is the real number, and it is small but not zero. Any pairing that puts
new text on a new ground has to be re-measured — `tools/contrast.mjs` for the type, `tools/ramp.mjs`
for the density classes — and the lab's own sweeps then say whether it holds:

```
npm run test:contrast -w @conservation/web   # 0 under AA, both locales, 390 and 1440
npm run test:a11y     -w @conservation/web
npm run test:reflow   -w @conservation/web
```

## What to bring to the conversation

Not "which one". These eight rows, and a column per row. The two built directions are two of the
256 combinations, and they were built to be argued with rather than picked from — which is what the
compare page now says.
