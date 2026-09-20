# Test hooks: what a check is allowed to hold on to

**Status: proposed, needs the owner's yes.** Default is yes. Nothing in this
repository depends on it yet; every workstream after W2 does.

## The problem

A check has to find the thing it is checking. Today it finds it by description:
`main section img`, `a[href*="/report?category="]`, `[lang="zh-TW"] > span`,
`.bg-ink-900.text-paper-50`. Each of those is a sentence about how the page is
built this month, and the redesign rebuilds every page. When they break they
break in the most expensive way — a real check failing for a fake reason, on
somebody else's branch, a day after the change that caused it.

## The proposal

Eight `data-testid` attributes in production markup:

| Hook | On | What a check asks it |
|---|---|---|
| `emblem` | the badge on the home hero | how wide is it at this viewport |
| `report-action` | the primary "report something" control | is there exactly one, is it above the fold |
| `map-action` | the primary "open the map" control | the same |
| `legend` | the map legend | does it describe what the map is drawing |
| `flow-step` | each step of the report flow | can the flow be walked |
| `flow-submit` | the submit control of that flow | as above |
| `receipt-status` | the status line of a submission receipt | does it say what actually happened |
| `status-tag` | a published/withheld/queued tag anywhere | as above |

They ship in production HTML. That is the point: a hook that only exists in a
test build is not the thing the reader sees, and the two drift.

## Why not roles and ARIA

Use them wherever they say the right thing — a check that finds the submit
button by its accessible name is checking something a reader also uses, and
that is better than a hook. Three of these have no such handle. The emblem is a
decorative image: it has no role worth querying and no name worth pinning, its
alt text is a design decision, and "the second image in the first section" is
exactly the kind of description this document exists to stop. The status tag and
the receipt status are identified today by their colours.

So: roles, `aria-*` and `href` first; a hook where the page offers nothing
stable. The migration policy in `docs/qa-harness.md` says which assertions
become which.

## If the answer is no

Everything above is still achievable through roles, `aria-*` and `href`, except
the emblem, which goes back to a structural selector and will break on the first
hero rebuild. That is a real cost and a small one; it is a reasonable thing to
choose if putting test attributes in shipped markup is not wanted.
