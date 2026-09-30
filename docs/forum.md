# The discussion forum

The team asked for a discussion forum with guidelines, accounts, and moderators
who can censor and delete, and then for it to be organised like Reddit, with
subreddits. It is built, and it is **switched off**. This page is for whoever
turns it on and whoever moderates it.

## Where things are

| What | Where |
| --- | --- |
| The switch | `apps/web/lib/forum/gate.ts` (`FORUM_ENABLED`) |
| Tables, views, grants | `supabase/migrations/0019_forum.sql` |
| Votes, scores, replies to replies | `supabase/migrations/0030_forum_votes.sql` |
| What is held for review | `apps/web/lib/forum/screen.ts` |
| Numbers and who-may-do-what | `apps/web/lib/forum/policy.ts` |
| Hot, New, Top; Best and New | `apps/web/lib/forum/rank.ts` |
| The reply tree | `apps/web/lib/forum/tree.ts` |
| Pages | `apps/web/app/[locale]/(site)/community/` |
| Member actions | `…/community/actions.ts` |
| Moderator actions | `…/community/moderation/actions.ts` |
| Export my posts | `apps/web/app/api/forum/export/route.ts` |
| Retention job | `apps/web/app/api/jobs/forum-retention/route.ts`, daily in `apps/web/vercel.json` |
| Tests | `apps/web/test/forum-*.test.mjs`, `apps/web/e2e/forum.spec.mjs` |

## How it is organised

Like Reddit. The forum's categories are its **communities** (its subreddits):
Announcements, Sightings & ID help, Roadkill & road safety, Invasive species,
and The project. Only moderators start threads in Announcements.

- **`/community`** is the front page: one feed of threads from every
  community, with the list of communities beside it (above it on a phone).
- **`/community/c/<slug>`** is one community: what it is for, a link to the
  guidelines, its own feed, and a place to start a thread. Its pinned threads
  lead its feed in every order; the front page does not pin.
- **Every feed sorts Hot, New or Top**, and Top looks back a day, a week or all
  time (`?sort=top&t=week`). Hot is Reddit's: the order of magnitude of the
  score plus the time the thread started, in units of 12.5 hours, so ten
  times the score is worth 12.5 hours and a well-liked thread gives way after
  about a day. The number is the `hot` column of `forum_threads_public`;
  `rank.ts` has the same sum, and a test holds them equal.
- **Votes.** Members vote each thread and each reply up or down, once, and can
  change or take back the vote (pressing the same arrow again). A thread's vote
  is its opening post's. Only members vote, on the current guidelines and not
  suspended; nobody votes on their own post, on anything held, hidden or
  deleted, on a post whose author has left, or in a locked thread. Votes are
  rate limited (30 a minute, 500 a day; 15 and 150 in an account's first
  week). Only totals are ever shown: nobody, moderators included, sees who
  voted for what on the site.
- **Replies to replies**, nested four levels deep. A reply to a fourth-level
  reply goes beside it, marked "replying to …". Replies sort Best (score,
  then the older first) or New; the fourth level is always in the order it
  was said. A reply that is held, hidden or deleted, with answers under it,
  shows as "[removed]" to everyone who cannot read it, and the answers stay
  where they were. A page of a thread is twenty top-level replies with
  everything under them.

Every reply, at any depth, is screened, held, flagged and moderated exactly as
before: the reply form is the same action with a `parent`.

### How the score is kept

`forum_posts.score` is kept by a trigger on `forum_votes`, in the same
transaction as the vote, by adding the change rather than recounting. A
recount reads the votes as they were when its statement began, so two votes
at the same moment could each miss the other; an addition is applied to the
row as it stands and cannot lose one. The feeds sort by it, so it is stored,
not summed on every page. `test/forum-votes.test.mjs` checks the stored score
against a fresh sum after every kind of change. A second trigger refuses a
vote on your own post, on a post the public cannot see, or on a post whose
author has left, whatever the code does.

### Why a departed member's posts take no votes

"Nobody votes on their own post" needs to know who wrote the post. Once its
author has left the forum, the post's `author_id` is null, and only its
`forum_post_meta` row still says who they were; the retention job purges that
after 180 days, and deleting the whole site account clears it at once. After
that a member who left and came back (or signed up again) could vote for their
own words, and nothing could tell. Keeping a marker of the author, even a
keyed hash, would keep exactly the link between an account and its posts that
the purge exists to remove. So a post whose author has left keeps the score it
has and takes no new votes, from anyone: the page shows it without arrows and
the action and the trigger refuse one. The votes it already had stay counted;
a voter who leaves takes theirs with them, as anywhere. This is the same call
`canReview` makes for a moderator when a post's author cannot be told.

To check it by hand, this should return no rows:

```sql
select p.id, p.score, coalesce(sum(v.value), 0) as summed
  from forum_posts p left join forum_votes v on v.post_id = p.id
 group by p.id having p.score <> coalesce(sum(v.value), 0);
```

### Who can see a vote

`forum_votes` is a base table like the others: row-level security on, no
policy, nothing granted to any public role, and no view reads it. The public
views carry the total (`score`) and where a reply sits (`parent_id`, `path`).
`path` can name the id of a post the public cannot read, because a reply
under a hidden one has to know where it was; an id says nothing else. If vote
manipulation is suspected, an admin can read `forum_votes` in SQL; there is no
screen for it, on purpose.

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
   The guidelines' section 12 says what is kept, votes included; the privacy
   page should say the same before the forum opens.

## Turning it on

1. Apply `supabase/migrations/0019_forum.sql`, then
   `supabase/migrations/0030_forum_votes.sql`, to the database. Both are
   additive and safe to re-run.
2. Set, in the deployment's environment:
   - `FORUM_IP_HASH_KEY`: a long random secret. Without it, production stores
     no IP hash at all rather than one that can be reversed.
   - `FORUM_ENABLED=1`.
3. Check `/api/health` reports `schemaCurrent: true` (with the forum on, it
   also asks for 0019 and 0030).
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
- **Pinned** threads lead their community's feed in every sort. **Locked**
  threads take no replies (except yours) and no votes.
- **Hiding a reply** that has answers leaves "[removed]" in its place for
  everyone else; the answers stay. You still see it, marked hidden.
- **Votes** are totals only; there is no tool to see or remove one person's
  votes. Guideline 7 forbids second accounts, asking for votes and following
  someone around to vote them down; treat a breach like spam (a suspension if
  it continues). Moving a thread to another community keeps its votes.
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
| Votes (`forum_votes`) | until the member deletes their forum account, or the post is purged | on delete cascade |

180 days follows 兒童及少年性剝削防制條例 Art. 8, which asks a platform to keep
removed content, the poster's data and the logs that long after removing
something on notice. When a member deletes their forum account, their posts
stay as "deleted member", keeping the score they had (see "Why a departed
member's posts take no votes"), and the per-post IP hash keeps their account id
until it is purged at 180 days. That is the one piece of their data kept after they
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
- There are no images, no direct messages and no notifications in version 1,
  on purpose. Votes are the one reaction. Linking threads to species and
  reports is version 1.1.
- Votes have no fuzzing and no weighting: a determined person with several
  accounts can move a score. Each account has to join (an account, an age
  band, the guidelines), and votes are rate limited; the guidelines and the
  moderators are the rest of the defence.
- The voting rule is part of guidelines **version 1**. Nobody has accepted
  version 1 yet (the forum has never been open), so `GUIDELINES_VERSION` was
  not raised for it. Once the forum is open, a change like that raises it, and
  every member is asked to accept the guidelines again.
- A page of a thread reads the whole thread to build its tree, as the public
  page always did. At a few thousand replies that wants a limit.
- When the retention job purges a deleted reply for good, its answers keep
  their place under "[removed]" (their `path` remembers) but lose the link
  to it (`parent_id` goes null), so a fourth-level answer to it no longer says
  whom it answered.
