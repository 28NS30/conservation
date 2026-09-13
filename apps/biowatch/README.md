# BioWatch International

The parent site at **biowatchintl.org**. Each project runs on its own subdomain
and deploys independently:

| Domain | App | Stack |
|---|---|---|
| `biowatchintl.org` | this app | Next.js |
| `formosawatch.biowatchintl.org` | `apps/web` | Next.js — Taiwan, roadkill and invasive species |

Two Vercel projects, one repository. A Vercel project has a single Root
Directory, so two apps need two projects however the URLs look.

FireWatch used to live here as `apps/firewatch` and has been deleted. Its
Colombian successor, FlamaWatch, is a separate organisation with its own site;
nothing of it is built from this repository.

This app shares nothing with FormosaWatch at runtime. It is a static page with
one hourly `fetch` for FormosaWatch's record count, which returns null rather than
throwing — a parent that 500s because a child is briefly down would be a worse
failure than a missing number.

## Why subdomains rather than subpages

Both were built and worked. Subpages were reverted because the cutover fails
quietly on a site already taking real reports: a base path moves the API routes,
so the classification cron 404s and reports pile up unidentified with nothing
logging an error, and Turnstile validates on hostname, so every submission is
rejected until the new domain is on its allowlist.

`apps/web/lib/basePath.ts` still exists and is inert. It documents what a prefix
would require if that decision is ever revisited.

## Environment

All optional; each has a working default.

| Variable | Default | Why you would set it |
|---|---|---|
| `NEXT_PUBLIC_FORMOSAWATCH_URL` | `https://formosawatch.biowatchintl.org` | Point a preview at a Vercel URL before DNS is cut over. |
| `NEXT_PUBLIC_FIREWATCH_URL` | `https://firewatch.biowatchintl.org` | As above. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@biowatchintl.org` | Until the real address exists. |

## Known gaps

- **No BioWatch badge.** The two project badges were drawn by hand as a set; the
  parent has a typographic lockup standing in. A third in the same family should
  be drawn, then wired in here, as the favicon, and into an OG card.
- **The Colombia figures are static**, taken from that project's own home page.
  FormosaWatch's are read live from `/api/health`. A live count would need the
  other project to publish an equivalent endpoint, and it is run by a separate
  organisation, so that is a request rather than a task.
- **No OG card for the apex**, so links preview as a bare URL.
