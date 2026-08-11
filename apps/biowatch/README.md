# BioWatch International

The parent site at **biowatchintl.org**. The projects live on subdomains and
keep their own stacks and repositories:

| | |
|---|---|
| `ecowatch.biowatchintl.org` | Taiwan — roadkill, invasive species. Next.js, in `apps/web` of this repo. |
| `firewatch.biowatchintl.org` | Atlántico, Colombia — wildfires. Vite SPA, separate repo. |

This app deliberately shares nothing at runtime with either. It is a static page
with one hourly `fetch`, so a project being down cannot take the parent with it.

## Environment

All optional; every one has a working default.

| Variable | Default | Why you would set it |
|---|---|---|
| `NEXT_PUBLIC_ECOWATCH_URL` | `https://ecowatch.biowatchintl.org` | Point a preview at the current Vercel URL before DNS is cut over. |
| `NEXT_PUBLIC_FIREWATCH_URL` | `https://firewatch.biowatchintl.org` | As above. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@biowatchintl.org` | Until the real address exists. |

## Deploying

Its own Vercel project, root directory `apps/biowatch`, pointed at the apex
domain. Do **not** add it to the existing project — that one deploys `apps/web`
and would start serving this instead.

## Known gaps

- **No BioWatch badge.** The two project badges were drawn by hand as a set; the
  parent has a typographic lockup standing in. A third badge in the same family
  should be drawn rather than generated, and then wired in here, as the favicon,
  and into the OG card.
- **FireWatch's figures are static**, taken from its own home page. EcoWatch's
  are read live from `/api/health`. Worth giving FireWatch the same endpoint —
  a hardcoded number is a number that goes stale.
- **No OG card yet.** Links to the apex will preview as a bare URL.
