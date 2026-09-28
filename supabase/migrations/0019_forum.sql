-- The discussion forum: its tables, and the wall between them and the public.
--
-- The forum ships DARK. Nothing reads these tables unless the server is
-- started with FORUM_ENABLED=1 (apps/web/lib/forum/gate.ts), and opening it
-- waits for a legal review and a moderator rota, which only the owner can
-- arrange. This file is additive, safe to re-run, and safe to apply to
-- production before the switch is ever turned on: it creates new objects,
-- seeds five categories and a starting word list, and touches no existing row.
--
-- THE SAME BOUNDARY AS REPORTS. A forum is a new way to publish a location,
-- and the site's one promise is that a protected animal's location is never
-- published at better than its blur. So the rule reports follow applies here:
--
--   * Every base table has row-level security on and no policy at all.
--   * `web_anon` — the role every public read runs as (lib/db.ts, asPublic) —
--     gets SELECT on four *_public views and nothing else. The views return
--     only visible posts in visible threads, and name people only by their
--     generated nickname: never a user id, never an email.
--   * `anon` and `authenticated`, the roles Supabase's REST API speaks as, get
--     nothing, not even the views. Nothing in this project uses that API
--     (0013), and the forum is not the place to start.
--   * The server writes on its own connection, where every action re-checks
--     the session and the role itself (apps/web/app/[locale]/(site)/community).
--
-- apps/web/test/forum-schema.test.mjs asserts all of that against the live
-- database: each public role is refused on each base table, and the views
-- never return a held, hidden or deleted post or an author's id.
--
-- RESTRICTED, AND PURGED. Two tables hold what is personal rather than
-- public: `forum_post_meta` (a keyed hash of the poster's IP address and their
-- browser's user agent) and `forum_post_revisions` (the text a moderator
-- edited out, which is usually exactly the location that must not be public).
-- The retention job (apps/web/app/api/jobs/forum-retention) deletes both after
-- 180 days, along with soft-deleted posts, unless a row is under legal hold.
-- 180 days is 兒童及少年性剝削防制條例 Art. 8's preservation period; see
-- docs/forum.md.

-- Give up rather than queue: see 0014. The only existing table this touches
-- is `profiles`, which the new foreign keys reference; creating one takes a
-- brief SHARE ROW EXCLUSIVE lock on it.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create table if not exists forum_categories (
  id                   serial primary key,
  slug                 text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_zh              text not null,
  name_en              text not null,
  description_zh       text not null,
  description_en       text not null,
  sort                 int  not null default 100,
  -- Announcements: anyone reads, only moderators start a thread.
  moderators_only_post boolean not null default false,
  archived             boolean not null default false,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Forum profiles: the forum's view of an account
-- ---------------------------------------------------------------------------

-- One row per person who has joined. Keyed by the same id as `profiles`, so the
-- forum uses the site's accounts and their roles and adds nothing to sign-in.
--
-- The nickname is GENERATED: an animal from a fixed list and four digits
-- (apps/web/lib/forum/nickname.ts). It is stored as the list's key and the
-- number rather than as text, so it reads 臺灣藍鵲 4821 to a Chinese reader and
-- Taiwan Blue Magpie 4821 to an English one while staying one identity, and
-- so no free text anyone typed — a real name, a school, a LINE id — can ever
-- be a name here. The key's shape is checked here; that it is on the list is
-- checked by the server.
--
-- Deleting this row is "delete my forum account": posts and threads keep
-- their text and lose their author (on delete set null), and read as
-- "deleted member". Sanctions are keyed to `profiles`, not to this row, so
-- leaving and rejoining does not end a suspension.
create table if not exists forum_profiles (
  user_id                uuid primary key references profiles(id) on delete cascade,
  nickname_key           text not null check (nickname_key ~ '^[a-z]+(-[a-z]+)*$'),
  nickname_no            int  not null check (nickname_no between 1000 and 9999),
  handle                 text generated always as (nickname_key || '-' || nickname_no::text) stored,
  -- An age BAND, not a birthdate: the least that answers the question. Under
  -- 13 is refused at the door and never stored.
  age_band               text not null check (age_band in ('13_17', '18_plus')),
  -- A self-declared acknowledgement, pending legal review of whether 13–17
  -- need verified guardian consent (plan section 7).
  guardian_ack_at        timestamptz,
  guidelines_version     int  not null check (guidelines_version >= 1),
  guidelines_accepted_at timestamptz not null,
  created_at             timestamptz not null default now(),
  constraint forum_profiles_guardian_ack
    check (age_band <> '13_17' or guardian_ack_at is not null),
  constraint forum_profiles_handle_unique unique (nickname_key, nickname_no)
);

create unique index if not exists forum_profiles_handle on forum_profiles (handle);

-- ---------------------------------------------------------------------------
-- Threads and posts
-- ---------------------------------------------------------------------------

-- A thread is a title plus its opening post. Its status follows the opening
-- post's (the server keeps them in step, in the same transaction): a title can
-- carry a location as easily as a body can, so a held opening post holds the
-- whole thread.
--
--   visible  public
--   held     waiting for a moderator; seen only by its author and moderators
--   hidden   a moderator took it down; kept, seen by its author and moderators
--   deleted  soft-deleted; purged after 180 days unless under legal hold
create table if not exists forum_threads (
  id                  uuid primary key default gen_random_uuid(),
  category_id         int  not null references forum_categories(id),
  author_id           uuid references forum_profiles(user_id) on delete set null,
  title               text not null check (char_length(title) between 1 and 120),
  status              text not null default 'visible'
                      check (status in ('visible', 'held', 'hidden', 'deleted')),
  locked              boolean not null default false,
  pinned_at           timestamptz,
  legal_hold          boolean not null default false,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  -- Kept by the trigger below from the thread's VISIBLE posts, so a list of
  -- threads sorted by activity never counts or dates a post nobody can see.
  visible_reply_count int not null default 0,
  last_activity_at    timestamptz not null default now()
);

create index if not exists forum_threads_listing
  on forum_threads (category_id, status, pinned_at desc nulls last, last_activity_at desc);
create index if not exists forum_threads_author on forum_threads (author_id);
create index if not exists forum_threads_deleted on forum_threads (deleted_at) where status = 'deleted';

create table if not exists forum_posts (
  id                   uuid primary key default gen_random_uuid(),
  thread_id            uuid not null references forum_threads(id) on delete cascade,
  author_id            uuid references forum_profiles(user_id) on delete set null,
  is_opener            boolean not null default false,
  -- Plain text. The pages render it as text, never as HTML or markdown.
  body                 text not null check (char_length(body) between 1 and 5000),
  status               text not null default 'visible'
                       check (status in ('visible', 'held', 'hidden', 'deleted')),
  -- Why it is held: 'coordinates', 'map_link', 'plus_code', 'contact',
  -- 'link', 'watched_word', 'first_posts', 'flagged'. Cleared on approval.
  held_reasons         text[] not null default '{}',
  -- A moderator's reason for hiding or deleting, shown to the author.
  moderator_note       text,
  edited_by_moderator  boolean not null default false,
  edited_at            timestamptz,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  legal_hold           boolean not null default false,
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index if not exists forum_posts_thread on forum_posts (thread_id, created_at);
create index if not exists forum_posts_author on forum_posts (author_id, created_at desc);
create index if not exists forum_posts_held on forum_posts (created_at) where status = 'held';
create index if not exists forum_posts_deleted on forum_posts (deleted_at) where status = 'deleted';
create unique index if not exists forum_posts_one_opener on forum_posts (thread_id) where is_opener;

/** Keep a thread's visible reply count and last activity in step with its posts. */
create or replace function forum_refresh_thread_stats() returns trigger
language plpgsql as $$
declare
  tid uuid := case when tg_op = 'DELETE' then old.thread_id else new.thread_id end;
begin
  update forum_threads t
     set visible_reply_count = greatest(
           (select count(*) from forum_posts p
             where p.thread_id = tid and p.status = 'visible') - 1, 0),
         last_activity_at = coalesce(
           (select max(p.created_at) from forum_posts p
             where p.thread_id = tid and p.status = 'visible'),
           t.created_at)
   where t.id = tid;
  return null;
end $$;

drop trigger if exists forum_posts_thread_stats on forum_posts;
create trigger forum_posts_thread_stats
  after insert or delete or update of status on forum_posts
  for each row execute function forum_refresh_thread_stats();

-- ---------------------------------------------------------------------------
-- Restricted: what is personal rather than public
-- ---------------------------------------------------------------------------

-- Who posted from where, for abuse and legal requests only. `ip_hash` is an
-- HMAC keyed by FORUM_IP_HASH_KEY, never the address itself. `author_id` is a
-- plain uuid with no foreign key on purpose: it has to outlive a deleted forum
-- account for the 180 days the law asks, and then it is purged.
create table if not exists forum_post_meta (
  post_id    uuid primary key references forum_posts(id) on delete cascade,
  author_id  uuid,
  ip_hash    text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists forum_post_meta_created on forum_post_meta (created_at);

-- The text as it was before a moderator edited it. Usually the location that
-- was edited OUT, so it is exactly as sensitive as a true coordinate: readable
-- in the moderation console, never in a public view, purged after 180 days.
create table if not exists forum_post_revisions (
  id           bigserial primary key,
  post_id      uuid not null references forum_posts(id) on delete cascade,
  title_before text,
  body_before  text not null,
  editor_id    uuid not null,
  reason       text not null,
  created_at   timestamptz not null default now()
);
create index if not exists forum_post_revisions_post on forum_post_revisions (post_id);
create index if not exists forum_post_revisions_created on forum_post_revisions (created_at);

-- ---------------------------------------------------------------------------
-- Flags, sanctions, watched words
-- ---------------------------------------------------------------------------

-- One flag of the first three reasons hides a post at once, pending review: a
-- wrong hide only delays a post, and a published location cannot be taken
-- back. 'spam' and 'other' hide at three flags from different people.
create table if not exists forum_flags (
  id          bigserial primary key,
  post_id     uuid not null references forum_posts(id) on delete cascade,
  reporter_id uuid references forum_profiles(user_id) on delete set null,
  reason      text not null check (reason in
                ('sensitive_location', 'personal_info', 'safety', 'spam', 'other')),
  note        text check (char_length(note) <= 500),
  status      text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint forum_flags_once unique (post_id, reporter_id)
);
create index if not exists forum_flags_open on forum_flags (post_id) where status = 'open';

-- Suspensions. Keyed to `profiles`, so deleting a forum profile and joining
-- again does not escape one. Moderators may suspend for up to 7 days; longer
-- is an admin's call (apps/web/lib/forum/policy.ts).
create table if not exists forum_sanctions (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null default 'suspend' check (kind in ('suspend')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  reason      text not null check (char_length(reason) between 1 and 500),
  actor_id    uuid not null,
  lifted_at   timestamptz,
  lifted_by   uuid,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists forum_sanctions_user on forum_sanctions (user_id, ends_at desc);

-- Words that hold a post for review. Matched on word boundaries for English
-- and as phrases for Chinese, after normalising the text, with an allowlist of
-- real animal names in code (apps/web/lib/forum/screen.ts). Stored lower-case
-- so the unique constraint means what it says.
--
-- There is deliberately no single 幹 below: it would hold 樹幹, 幹部 and 幹線
-- on a wildlife site. The screen refuses a lone Chinese character that sits
-- inside a longer word for the same reason, if a moderator ever adds one.
create table if not exists forum_watched_words (
  id         bigserial primary key,
  word       text not null unique check (word = lower(word) and char_length(word) between 1 and 60),
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The moderation audit log: append-only
-- ---------------------------------------------------------------------------

-- Every moderator action writes a row here in the same transaction as the
-- change it records, with who did it, to what, and why.
--
-- No foreign keys, deliberately. `on delete set null` is an UPDATE, which the
-- trigger below refuses, so a foreign key here would make deleting an account
-- impossible. Ids are kept as plain values and resolved to nicknames when the
-- log is read.
create table if not exists forum_mod_actions (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  actor_id        uuid not null,
  action          text not null check (action in (
                    'approve', 'hide', 'redact', 'delete',
                    'lock', 'unlock', 'pin', 'unpin', 'move',
                    'suspend', 'lift', 'set_role',
                    'word_add', 'word_remove')),
  target_type     text not null check (target_type in ('post', 'thread', 'user', 'word')),
  target_id       text not null,
  subject_user_id uuid,
  reason          text,
  detail          jsonb not null default '{}'
);
create index if not exists forum_mod_actions_created on forum_mod_actions (created_at desc);

create or replace function forum_mod_actions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'forum_mod_actions is append-only: % refused', tg_op
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists forum_mod_actions_no_update on forum_mod_actions;
create trigger forum_mod_actions_no_update
  before update or delete on forum_mod_actions
  for each row execute function forum_mod_actions_append_only();

drop trigger if exists forum_mod_actions_no_truncate on forum_mod_actions;
create trigger forum_mod_actions_no_truncate
  before truncate on forum_mod_actions
  for each statement execute function forum_mod_actions_append_only();

-- ---------------------------------------------------------------------------
-- The public read surface
-- ---------------------------------------------------------------------------

-- security_barrier on each: the filters below are the whole boundary, and a
-- barrier view evaluates them before any condition a caller adds, so no
-- function in a caller's WHERE clause can see a row the view would drop.

create or replace view forum_categories_public with (security_barrier) as
  select c.id, c.slug, c.name_zh, c.name_en, c.description_zh, c.description_en,
         c.sort, c.moderators_only_post,
         (select count(*) from forum_threads t
           where t.category_id = c.id and t.status = 'visible')::int as thread_count,
         (select coalesce(sum(t.visible_reply_count + 1), 0) from forum_threads t
           where t.category_id = c.id and t.status = 'visible')::int as post_count,
         (select max(t.last_activity_at) from forum_threads t
           where t.category_id = c.id and t.status = 'visible') as last_activity_at
    from forum_categories c
   where not c.archived;

create or replace view forum_threads_public with (security_barrier) as
  select t.id, t.category_id, c.slug as category_slug, t.title, t.locked,
         t.pinned_at, t.created_at, t.last_activity_at,
         t.visible_reply_count as reply_count,
         fp.handle as author_handle
    from forum_threads t
    join forum_categories c on c.id = t.category_id and not c.archived
    left join forum_profiles fp on fp.user_id = t.author_id
   where t.status = 'visible';

create or replace view forum_posts_public with (security_barrier) as
  select p.id, p.thread_id, p.is_opener, p.body, p.created_at, p.edited_at,
         p.edited_by_moderator,
         fp.handle as author_handle,
         coalesce(pr.role in ('moderator', 'admin'), false) as author_is_moderator
    from forum_posts p
    join forum_threads t on t.id = p.thread_id and t.status = 'visible'
    join forum_categories c on c.id = t.category_id and not c.archived
    left join forum_profiles fp on fp.user_id = p.author_id
    left join profiles pr on pr.id = p.author_id and fp.user_id is not null
   where p.status = 'visible';

-- A nickname's public page: the month they joined, whether they moderate, how
-- many visible posts they have. Not their age band, not their flags, not their
-- sanctions, and not a list of anything they reported (see the /me page's note
-- on why a per-person roster of taxa is kept private).
create or replace view forum_profiles_public with (security_barrier) as
  select fp.handle, fp.nickname_key, fp.nickname_no,
         date_trunc('month', fp.created_at)::date as joined_month,
         coalesce(pr.role in ('moderator', 'admin'), false) as is_moderator,
         (select count(*) from forum_posts p
            join forum_threads t on t.id = p.thread_id and t.status = 'visible'
           where p.author_id = fp.user_id and p.status = 'visible')::int as post_count
    from forum_profiles fp
    left join profiles pr on pr.id = fp.user_id;

-- ---------------------------------------------------------------------------
-- Grants and row-level security
-- ---------------------------------------------------------------------------

alter table forum_categories     enable row level security;
alter table forum_profiles       enable row level security;
alter table forum_threads        enable row level security;
alter table forum_posts          enable row level security;
alter table forum_post_meta      enable row level security;
alter table forum_post_revisions enable row level security;
alter table forum_flags          enable row level security;
alter table forum_sanctions      enable row level security;
alter table forum_watched_words  enable row level security;
alter table forum_mod_actions    enable row level security;

-- Nothing on a base table for any public role. Revoked explicitly, not left to
-- 0013's default privileges: those apply only to tables created by the role
-- that ran 0013, and this file may one day be run by another.
revoke all on forum_categories, forum_profiles, forum_threads, forum_posts,
              forum_post_meta, forum_post_revisions, forum_flags, forum_sanctions,
              forum_watched_words, forum_mod_actions
  from public, web_anon;
revoke all on forum_categories_public, forum_threads_public, forum_posts_public,
              forum_profiles_public
  from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on forum_categories, forum_profiles, forum_threads, forum_posts,
                       forum_post_meta, forum_post_revisions, forum_flags, forum_sanctions,
                       forum_watched_words, forum_mod_actions,
                       forum_categories_public, forum_threads_public, forum_posts_public,
                       forum_profiles_public
           from %I', r);
      execute format(
        'revoke all on sequence forum_categories_id_seq, forum_post_revisions_id_seq,
                                forum_flags_id_seq, forum_sanctions_id_seq,
                                forum_watched_words_id_seq, forum_mod_actions_id_seq
           from %I', r);
    end if;
  end loop;
end $$;

grant select on forum_categories_public, forum_threads_public, forum_posts_public,
                forum_profiles_public
  to web_anon;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------

insert into forum_categories
  (slug, name_zh, name_en, description_zh, description_en, sort, moderators_only_post)
values
  ('announcements', '公告', 'Announcements',
   '團隊的消息與社群的更新。只有版主可以開新話題。',
   'News from the team and changes to the community. Only moderators start threads here.',
   0, true),
  ('sightings-id', '目擊與物種辨識', 'Sightings & ID help',
   '分享你看到的動物，或請大家幫忙認物種。不要寫出確切地點。',
   'Share what you saw, or ask what it is. Leave out exact locations.',
   10, false),
  ('roadkill', '路殺與道路安全', 'Roadkill & road safety',
   '路殺、受傷的動物，以及怎麼讓道路對動物更安全。',
   'Roadkill, injured animals, and how to make roads safer for wildlife.',
   20, false),
  ('invasive', '外來入侵種', 'Invasive species',
   '辨認外來入侵種、了解牠們的影響，以及該怎麼通報。',
   'Recognising invasive species, what they do, and how to report them.',
   30, false),
  ('project', '關於這個計畫', 'The project',
   '對網站的建議、想法和問題。',
   'Ideas, questions and suggestions about this site and the project.',
   40, false)
on conflict (slug) do nothing;

-- A starting list, deliberately short: common Taiwanese and English abuse and
-- the phrases that most need an adult to see them. Moderators add and remove
-- words in the console, and each change is audited. Holding is not blocking:
-- a false match only delays a post until someone reads it.
insert into forum_watched_words (word, note) values
  ('幹你娘', 'profanity'), ('幹拎娘', 'profanity'), ('幹林娘', 'profanity'),
  ('機掰', 'profanity'), ('雞掰', 'profanity'), ('靠北', 'profanity'),
  ('靠杯', 'profanity'), ('ㄍㄋㄋ', 'profanity'), ('他媽的', 'profanity'),
  ('王八蛋', 'insult'), ('賤人', 'insult'), ('婊子', 'insult'),
  ('智障', 'insult'), ('腦殘', 'insult'),
  ('去死', 'safety: may need an adult to read it'),
  ('自殺', 'safety: may need an adult to read it'),
  ('fuck', 'profanity'), ('shit', 'profanity'), ('bitch', 'insult'),
  ('cunt', 'insult'), ('asshole', 'insult'), ('slut', 'insult'),
  ('whore', 'insult'), ('faggot', 'slur'), ('nigger', 'slur'),
  ('retard', 'insult'), ('kys', 'safety: "kill yourself"'),
  ('kill yourself', 'safety: may need an adult to read it')
on conflict (word) do nothing;
