# The discussion forum

The team asked for a discussion forum with guidelines, accounts, and moderators
who can censor and delete. It is built, and it is **switched off**. This page is
for whoever turns it on and whoever moderates it.

## Where things are

| What | Where |
| --- | --- |
| The switch | `apps/web/lib/forum/gate.ts` (`FORUM_ENABLED`) |
| Tables, views, grants | `supabase/migrations/0019_forum.sql` |
| What is held for review | `apps/web/lib/forum/screen.ts` |
| Numbers and who-may-do-what | `apps/web/lib/forum/policy.ts` |
| Pages | `apps/web/app/[locale]/(site)/community/` |
| Member actions | `…/community/actions.ts` |
| Moderator actions | `…/community/moderation/actions.ts` |
| Export my posts | `apps/web/app/api/forum/export/route.ts` |
| Retention job | `apps/web/app/api/jobs/forum-retention/route.ts`, daily in `apps/web/vercel.json` |
| Tests | `apps/web/test/forum-*.test.mjs`, `apps/web/e2e/forum.spec.mjs` |

## Switched off

`FORUM_ENABLED` must be exactly `1` or `true` for the forum to exist. Anything
else, including unset, means every page under `/community`, both API routes, the
retention job and every forum server action answer **404**, nothing links to it,
and no forum query runs. `/api/health` does not ask for migration 0019 while it
is off. CI proves this on every push (`e2e/forum.spec.mjs` against the main
server) and runs the whole moderation loop against a second server with the
switch on.

## Before it opens (owner decisions)

1. **Legal review** of the age policy (13 and over, with a self-declared
   guardian acknowledgement from 13 to 17), the guidelines, the privacy notice
   and this runbook. See plan section 6, item 6.
2. **A moderator rota.** At least three people who can clear the queue every
   day. With fewer than three moderators, a new member's first two posts are
   *not* held (only posts the filters catch are), because a queue nobody clears
   teaches new members the forum is dead. `FORUM_REVIEW_FIRST_POSTS=1` or `=0`
   overrides the count.
3. **An adult safety contact** for the incidents below, and at least two
   admins, one of them an adult.
4. **Privacy notice and terms**: `/privacy` does not yet describe forum data.
   The guidelines' section 11 says what is kept; the privacy page should say the
   same before the forum opens.

## Turning it on

1. Apply `supabase/migrations/0019_forum.sql` to the database. It is additive
   and safe to re-run.
2. Set, in the deployment's environment:
   - `FORUM_IP_HASH_KEY`: a long random secret. Without it, production stores
     no IP hash at all rather than one that can be reversed.
   - `FORUM_ENABLED=1`.
3. Check `/api/health` reports `schemaCurrent: true` (it now also asks for 0019).
4. Grant roles, once, in SQL. After that, admins make and unmake moderators in
   the console; only the owner can make an admin.

   ```sql
   update profiles set role = 'admin' where id = '<user id>';
   ```

5. Every moderator joins the forum first (their actions are logged under their
   forum name) and reads the moderator notes below.
6. The pages stay `noindex` for the pilot. When the forum opens, add a link:
   the header nav (`components/site/SiteHeader.tsx`, the plan's "Community" tab),
   the footer's Explore list, and `/community` and `/community/guidelines` in
   `app/sitemap.ts`, and decide whether to lift `noindex` in
   `community/layout.tsx`.

## For moderators

The console is `/community/moderation`. Every post also has your tools under it
on the thread page.

- **Waiting for review**: posts the filters or the first-post rule held. The
  reason is shown. A post held for a location shows a warning: approve it only
  if it cannot point to a protected or sensitive animal. Otherwise use **Edit
  out a location**, which keeps the original where only moderators can read it
  and checks the new text again before approving.
- **Flagged**: posts with open flags, locations and safety first. One flag for
  a location, personal information or safety has already hidden the post.
- **Hide** keeps the post and shows its author your reason. **Delete** removes
  it; it is purged after 180 days.
- **Suspend**: up to 7 days for a moderator. Longer is an admin's decision.
  Moderators cannot suspend moderators or admins.
- You cannot approve, hide or delete your own posts. Another moderator decides.
- Every action is in the moderation log, with your forum name and your reason.
  The log cannot be edited or deleted, by anyone.
- **Appeals** arrive by email (the guidelines give the contact address). A
  different moderator from the one who acted looks again.

## What is kept, and for how long

| Data | Kept | Purged by |
| --- | --- | --- |
| Visible and hidden posts | until deleted | — |
| Soft-deleted posts and threads | 180 days | retention job |
| IP hash and user agent per post (`forum_post_meta`) | 180 days | retention job |
| Text moderators edited out (`forum_post_revisions`) | 180 days | retention job |
| Resolved flags | 180 days | retention job |
| Moderation log | indefinitely | — |
| Forum profile | until the member deletes it | "Delete my community account" in /me |

180 days follows 兒童及少年性剝削防制條例 Art. 8, which asks a platform to keep
removed content, the poster's data and the logs that long after removing
something on notice. When a member deletes their forum account, their posts
stay as "deleted member", and the per-post IP hash keeps their account id until
it is purged at 180 days. That is the one piece of their data kept after they
leave, and the reason is this law; it needs the legal review to confirm it.

**Legal hold.** A post or thread under legal hold is skipped by every purge. It
is set in SQL, on a legal request, by an admin:

```sql
update forum_posts set legal_hold = true where id = '<post id>';
update forum_threads set legal_hold = true where id = '<thread id>';
```

## Incidents

Draft, pending the legal review and the owner naming an adult safety contact.

- **Someone may be at risk of harming themselves or others.** Hide the post if
  it exposes them, and tell the adult safety contact at once. The guidelines
  point members to 1925 (安心專線, 24 hours) and to 110 / 119 in an emergency.
- **Sexual content involving a minor.** Delete it at once (the law asks for
  removal within 24 hours of notice), set legal hold on the post so it is kept
  for the authorities, suspend the account, and tell the adult safety contact,
  who reports it. Do not copy, screenshot or forward it.
- **Personal information** (a name, a school, a phone number). Edit it out, or
  hide the post, and tell the person whose information it was if they are a
  member.
- **A location of a protected animal** that got through. Edit it out. If it was
  public for a while, tell the team: the location is now known.

## Known limits

- A place **name** cannot be caught by a filter ("the second car park at
  陽明山"). The guidelines and the one-flag hide are the defence.
- One person can hide many posts by flagging them for a location. Flags are
  limited to 20 a day per account, and each shows who flagged it.
- There are no images, no direct messages, no reactions and no notifications in
  version 1, on purpose. Linking threads to species and reports is version 1.1.
