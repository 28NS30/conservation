# BioWatch International

The parent site at **biowatchintl.org**. Both projects are served as subpages of
this domain, not as separate sites:

| Path | App | Stack |
|---|---|---|
| `/` | this app | Next.js |
| `/ecowatch` | `apps/web` | Next.js — Taiwan, roadkill and invasive species |
| `/firewatch` | `apps/firewatch` | Vite SPA — Atlántico, Colombia, wildfires |

## How one domain serves three apps

Next.js **Multi-Zones**. This app rewrites `/ecowatch/:path*` and
`/firewatch/:path*` to the other two deployments, so a visitor sees one site
while each app keeps building, breaking and shipping on its own.

The rewrite is only half of it. Each child also has to *know* it is mounted
under a prefix, or it will emit root-relative URLs that miss:

- **EcoWatch** — `basePath` in `next.config.ts`, driven by
  `NEXT_PUBLIC_BASE_PATH` so the tests and any root deploy keep working. Next
  applies that to `<Link>` and routing but **not** to `next/image`, `fetch()`,
  service-worker registration, or the web manifest; `lib/basePath.ts` covers
  those.
- **FireWatch** — Vite's `base` for assets, plus a matching `basename` on
  `BrowserRouter`. Both read one exported constant.

Because each child prefixes its own asset URLs, a single `/:path*` rule per zone
is enough — scripts, styles and API calls all fall under it.

## Environment

| Variable | Where | Why |
|---|---|---|
| `ECOWATCH_ORIGIN` | this app | The EcoWatch deployment to rewrite to, and to read live counts from at build time. |
| `FIREWATCH_ORIGIN` | this app | The FireWatch deployment to rewrite to. |
| `NEXT_PUBLIC_BASE_PATH` | `apps/web` | `/ecowatch` when deployed as a zone; unset for a root deploy. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | this app | Defaults to `hello@biowatchintl.org`. |

The two children stay on their own Vercel projects — a Vercel project has one
Root Directory, so three apps need three projects regardless of how the URLs
look to a visitor.

## Known gaps

- **No BioWatch badge.** The two project badges were drawn by hand as a set; the
  parent has a typographic lockup standing in. A third in the same family should
  be drawn, then wired in here, as the favicon, and into an OG card.
- **FireWatch's figures are static**, taken from its own home page. EcoWatch's
  are read live from `/api/health`. FireWatch should grow the same endpoint.
- **No OG card for the apex**, so links preview as a bare URL.
