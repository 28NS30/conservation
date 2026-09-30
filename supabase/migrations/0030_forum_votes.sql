-- The forum, organised like Reddit: votes, a score on every post, and replies
-- that answer other replies.
--
-- Additive, safe to re-run, and safe to apply while the forum is switched off
-- (it still is: see 0019 and apps/web/lib/forum/gate.ts). It adds one table,
-- three columns to forum_posts, and three columns to each of two public views;
-- it changes no existing row.
--
-- VOTES. A member votes a post up or down, once, and may change or take back
-- the vote. A thread's vote is its opening post's: the thread is its title
-- plus that post, and they already share a status (0019). So `forum_votes`
-- is keyed by post and voter and nothing else.
--
-- Votes are never public one by one. `forum_votes` is a base table like the
-- others: row-level security on, no policy, nothing granted to any public
-- role. The public reads a TOTAL, `score`, through the two views it already
-- reads. No public role gains a table, a view or a function here.
--
-- WHY THE SCORE IS KEPT BY A TRIGGER, AND BY DELTA. The feeds sort every
-- thread by it, so it is stored on the post rather than summed on each read,
-- and a trigger on forum_votes keeps it, in the same transaction as the vote:
-- no code path can change a vote and forget the score. The trigger adds the
-- change (+1, -2, ...) rather than recounting. A recount reads the votes as
-- they were when its statement began, so two votes on one post at the same
-- moment would each count without the other and the second would overwrite
-- the first. An addition is applied to the row as it stands once the first
-- has committed, so it cannot lose one. apps/web/test/forum-votes.test.mjs
-- checks the stored score against a fresh sum after every kind of change.
--
-- WHAT MAY BE VOTED ON. The server decides (lib/forum/policy.ts voteRefusal),
-- and the trigger below refuses the two things that must never happen whatever
-- the code does: a vote on your own post, and a vote on a post the public
-- cannot see (held, hidden, deleted, or in a thread that is).
--
-- THREADED REPLIES. `parent_id` is the reply a reply answers; null for a
-- reply to the thread itself, and for the opening post. `path` is where the
-- reply sits in the tree: the ids above it, top first. Both are set once, on
-- insert, by a trigger, and never change afterwards.
--
-- The tree is four levels deep (apps/web/lib/forum/policy.ts
-- REPLY_DEPTH_MAX). A reply to a reply on the fourth level goes beside it on
-- the fourth level rather than under it, so `path` is at most three ids long
-- and the page never indents past four. `parent_id` still names the reply it
-- answers, and the page says "replying to …" when that is not the one it sits
-- under.
--
-- `path` is in the public view, so the public can see the ids of posts it
-- cannot read: a visible reply under a hidden one has to know where the
-- hidden one was, or the tree breaks. An id says nothing else: not the text,
-- not the author, not whether it was held, hidden or deleted. The page shows
-- each as "[removed]".
--
-- When the retention job purges a deleted reply for good, the replies to it
-- keep their `path`, so they stay where they were under a "[removed]", and
-- their `parent_id` goes null (the foreign key's ON DELETE SET NULL).

-- Give up rather than queue: see 0014. Adding the columns and the foreign key
-- takes a brief ACCESS EXCLUSIVE lock on forum_posts.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Replies to replies
-- ---------------------------------------------------------------------------

alter table forum_posts add column if not exists parent_id uuid;
alter table forum_posts add column if not exists path uuid[] not null default '{}';
alter table forum_posts add column if not exists score int not null default 0;

-- A reply answers a post in its own thread: the foreign key is on the pair,
-- so a reply can never hang from another thread's post. It needs the pair to
-- be unique, which it is (the id alone is), declared.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'forum_posts_thread_id_id_key') then
    alter table forum_posts add constraint forum_posts_thread_id_id_key unique (thread_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forum_posts_parent_fkey') then
    -- SET NULL (parent_id) only: the thread id is the reply's own and stays.
    alter table forum_posts add constraint forum_posts_parent_fkey
      foreign key (thread_id, parent_id) references forum_posts (thread_id, id)
      on delete set null (parent_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forum_posts_path_depth') then
    alter table forum_posts add constraint forum_posts_path_depth check (cardinality(path) <= 3);
  end if;
end $$;

create index if not exists forum_posts_parent on forum_posts (thread_id, parent_id) where parent_id is not null;

/**
 * Place a reply in its thread's tree, once.
 *
 * On insert: under its parent, or beside it when the parent is already on the
 * fourth level. On update: `path` keeps its value whatever the statement said,
 * and `parent_id` may only go to null, which is what the purge's foreign key
 * does. Nothing in the app moves a reply; this makes sure nothing can.
 */
create or replace function forum_place_reply() returns trigger
language plpgsql as $$
declare
  parent_path uuid[];
  parent_opener boolean;
begin
  if tg_op = 'UPDATE' then
    new.path := old.path;
    if new.parent_id is not null and new.parent_id is distinct from old.parent_id then
      raise exception 'a reply keeps the post it answers' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  new.path := '{}';
  if new.parent_id is null then
    return new;
  end if;
  if new.is_opener then
    raise exception 'an opening post answers nobody' using errcode = 'check_violation';
  end if;

  select p.path, p.is_opener into parent_path, parent_opener
    from forum_posts p
   where p.id = new.parent_id and p.thread_id = new.thread_id;
  -- Not found: the foreign key refuses the row once this returns.
  if not found then
    return new;
  end if;
  -- A reply to the thread is a top-level reply, and says so with a null
  -- parent; the server never sends the opening post as a parent.
  if parent_opener then
    raise exception 'a reply to the opening post has no parent' using errcode = 'check_violation';
  end if;

  -- Three ids above it is the fourth level: go beside the parent, not under.
  if cardinality(parent_path) < 3 then
    new.path := parent_path || new.parent_id;
  else
    new.path := parent_path;
  end if;
  return new;
end $$;

drop trigger if exists forum_posts_place_reply on forum_posts;
create trigger forum_posts_place_reply
  before insert or update of parent_id, path on forum_posts
  for each row execute function forum_place_reply();

-- ---------------------------------------------------------------------------
-- Votes
-- ---------------------------------------------------------------------------

-- One row per member per post they have voted on. Taking a vote back deletes
-- the row; there is no zero. Leaving the forum deletes a member's votes with
-- their profile (a vote says what someone liked, which is theirs to take
-- with them), and the scores they counted in go down with them.
create table if not exists forum_votes (
  post_id    uuid not null references forum_posts(id) on delete cascade,
  voter_id   uuid not null references forum_profiles(user_id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, voter_id)
);
create index if not exists forum_votes_voter on forum_votes (voter_id);

/**
 * Refuse a vote nobody may cast: on your own post, or on a post the public
 * cannot read. The author is the post's, or, when they have left and come
 * back, the one its metadata kept (as moderation/actions.ts POST_AUTHOR does
 * for review), so leaving and rejoining does not let anyone vote for their
 * own words.
 */
create or replace function forum_votes_check() returns trigger
language plpgsql as $$
declare
  author uuid;
  post_status text;
  thread_status text;
begin
  select coalesce(p.author_id, (select pm.author_id from forum_post_meta pm where pm.post_id = p.id)),
         p.status, t.status
    into author, post_status, thread_status
    from forum_posts p
    join forum_threads t on t.id = p.thread_id
   where p.id = new.post_id;
  if author = new.voter_id then
    raise exception 'a member cannot vote on their own post' using errcode = 'check_violation';
  end if;
  if post_status is distinct from 'visible' or thread_status is distinct from 'visible' then
    raise exception 'only a visible post can be voted on' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists forum_votes_check on forum_votes;
create trigger forum_votes_check
  before insert or update on forum_votes
  for each row execute function forum_votes_check();

/** Keep forum_posts.score equal to the sum of its votes. See the note at the top on why by delta. */
create or replace function forum_votes_score() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update forum_posts set score = score + new.value where id = new.post_id;
  elsif tg_op = 'DELETE' then
    -- When the post itself is being purged this finds no row, which is right.
    update forum_posts set score = score - old.value where id = old.post_id;
  elsif new.post_id = old.post_id then
    update forum_posts set score = score - old.value + new.value where id = new.post_id;
  else
    update forum_posts set score = score - old.value where id = old.post_id;
    update forum_posts set score = score + new.value where id = new.post_id;
  end if;
  return null;
end $$;

drop trigger if exists forum_votes_score on forum_votes;
create trigger forum_votes_score
  after insert or delete or update of value, post_id on forum_votes
  for each row execute function forum_votes_score();

-- ---------------------------------------------------------------------------
-- The public views: the same rows as 0019, three more columns each
-- ---------------------------------------------------------------------------

-- `create or replace` keeps the grants and may only add columns at the end,
-- which is all this does. The filters are 0019's, unchanged.
--
-- `hot` is Reddit's ranking: the order of magnitude of the score, plus the
-- time the thread was started in units of 12.5 hours (45,000 seconds). A
-- thread ten times better liked ranks with one started 12.5 hours later, so
-- a well-liked thread stays near the top for about a day and then gives way.
-- Computed here, from the score and the start time the view already shows, so
-- every feed sorts by the same number; lib/forum/rank.ts hotRank() is the same
-- sum in TypeScript, and apps/web/test/forum-votes.test.mjs holds them equal.
-- 1134028003 is Reddit's own epoch (8 December 2005); any fixed instant would
-- do, it only keeps the number small.
create or replace view forum_threads_public with (security_barrier) as
  select t.id, t.category_id, c.slug as category_slug, t.title, t.locked,
         t.pinned_at, t.created_at, t.last_activity_at,
         t.visible_reply_count as reply_count,
         fp.handle as author_handle,
         op.id as opener_id,
         coalesce(op.score, 0) as score,
         (sign(coalesce(op.score, 0))::float8 * log(greatest(abs(coalesce(op.score, 0)), 1)::float8)
           + (extract(epoch from t.created_at)::float8 - 1134028003) / 45000) as hot
    from forum_threads t
    join forum_categories c on c.id = t.category_id and not c.archived
    left join forum_profiles fp on fp.user_id = t.author_id
    left join forum_posts op on op.thread_id = t.id and op.is_opener
   where t.status = 'visible';

create or replace view forum_posts_public with (security_barrier) as
  select p.id, p.thread_id, p.is_opener, p.body, p.created_at, p.edited_at,
         p.edited_by_moderator,
         fp.handle as author_handle,
         coalesce(pr.role in ('moderator', 'admin'), false) as author_is_moderator,
         p.parent_id, p.path, p.score
    from forum_posts p
    join forum_threads t on t.id = p.thread_id and t.status = 'visible'
    join forum_categories c on c.id = t.category_id and not c.archived
    left join forum_profiles fp on fp.user_id = p.author_id
    left join profiles pr on pr.id = p.author_id and fp.user_id is not null
   where p.status = 'visible';

-- ---------------------------------------------------------------------------
-- Grants and row-level security
-- ---------------------------------------------------------------------------

alter table forum_votes enable row level security;
revoke all on forum_votes from public, web_anon;

-- The new functions run only as triggers, which are not checked for EXECUTE.
-- 0024 made new functions start closed; this says so for these three anyway,
-- in case this file is run by a role that 0024's default did not cover.
revoke execute on function forum_place_reply(), forum_votes_check(), forum_votes_score() from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on forum_votes from %I', r);
      execute format(
        'revoke execute on function forum_place_reply(), forum_votes_check(), forum_votes_score() from %I', r);
    end if;
  end loop;
end $$;
