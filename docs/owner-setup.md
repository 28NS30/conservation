# Owner setup: the steps only Neo can take

Each of these needs an account, a payment method or a decision that belongs to
the owner. Everything they unblock is already built and live, waiting on the
switch. They are ordered by what they unblock, and each says how to check it
worked.

Nothing here needs a code change or a deploy unless it says so.

Production: Vercel project `conservation-web`, Supabase project
`evfvpkmafcadbwmqdjxq` (Tokyo).

---

## 1. Email sending, so the public can sign in

**Unblocks:** sign-in for anyone, not only members of the Supabase project; the
6-digit code in the sign-in email; a sensible email rate limit.

**Why it is blocked:** Supabase's built-in mailer sends two emails an hour, only
to members of the Supabase project, and refuses template edits.

**Needs first:** a domain you control (step 2 of the roadmap's owner list), so
mail can be sent from it. Resend's free plan (100 emails a day) is enough.

1. **Resend** (resend.com): create an account, then **Domains → Add domain**.
   Add the DNS records it shows at your domain registrar and wait until Resend
   says *Verified*.
2. **Resend → API Keys → Create API key**, sending access only. Copy it once;
   it goes straight into Supabase in the next step and nowhere else. Do not
   paste it into chat, a document or the repository.
3. **Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP**
   (older dashboards put it under Project Settings → Authentication):
   - Sender email: `noreply@<your domain>`
   - Sender name: `福爾摩沙守望計畫`
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend`
   - Password: the API key from step 2
4. **Supabase → Authentication → Rate Limits:** raise *emails sent per hour*
   (30 is plenty to start).
5. **The email templates are already set** (30 September 2026), for both
   *Magic Link* and *Confirm signup*, from `supabase/templates/sign-in-code.html`:
   the 6-digit code and no link. Leave them as they are when you set up SMTP.
   No link, because a school's mail scanner that opens it spends the code; and
   both templates, because a first sign-in is a sign-up, and Supabase sends
   *Confirm signup* for it. The code lasts 15 minutes.
6. **Turn on the check against automated sign-in emails.** Supabase sends a
   sign-in email to anyone who asks, from your domain, against one hourly
   limit for the whole project, so a script could use it all up and block every
   real sign-in for the rest of the hour. The sign-in form already sends a
   Cloudflare Turnstile token with each request; Supabase ignores it until this
   is on. **Supabase → Authentication → Attack Protection → Enable Captcha
   protection:** provider *Cloudflare Turnstile*, secret key: the same Turnstile
   secret key the website uses (`TURNSTILE_SECRET_KEY` in Vercel; Cloudflare →
   Turnstile → your site → Settings). Paste it there yourself, not into chat.

**Check:** sign in on the live site with an address that is not in the Supabase
project. The email should arrive within a minute with a 6-digit code and no
link. After step 6, the sign-in page shows the Turnstile box and still works.

---

## 2. "Continue with Google"

**Unblocks:** the Google button on the sign-in page. It works before the domain
exists. Schools often block Google sign-in for under-18 accounts, so the email
code stays the fallback.

1. **Google Cloud Console** (console.cloud.google.com): create a project, then
   **APIs & Services → OAuth consent screen**: External; app name
   `福爾摩沙守望計畫 Project FormosaWatch`; a support email; the scopes stay the
   defaults (email, profile, openid).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.** Authorised redirect URI:
   `https://evfvpkmafcadbwmqdjxq.supabase.co/auth/v1/callback`
3. **Supabase → Authentication → Sign In / Providers → Google:** enable it and
   paste the client ID and client secret from step 2.
4. **Publish the consent screen** in Google Cloud when you are ready for anyone
   to use it. Until then only the test users you list there can sign in.

The site notices by itself: the sign-in page asks Supabase whether Google is on
(`apps/web/lib/authProviders.ts`) and shows the button within a few minutes.

**Check:** open the sign-in page. "Continue with Google" appears, and signing in
returns you to the page you started from.

---

## 3. The first moderators and admins

**Unblocks:** the moderation queue (/admin), test reports, and later the forum's
moderator tools.

Each person first signs in once on the live site, so their account exists. Then,
in **Supabase → SQL Editor**, with their email address:

```sql
insert into profiles (id, role)
select id, 'moderator' from auth.users
 where email = 'someone@example.com'
   and email_confirmed_at is not null
   and coalesce(encrypted_password, '') = ''
on conflict (id) do update set role = excluded.role;
```

Use `'admin'` instead of `'moderator'` for an admin. At least two admins, one of
them an adult.

If it says `INSERT 0 0`, the account either has not signed in yet or **has a
password**, which this site never sets. Supabase accepts a password sign-up from
anyone, so someone may have registered that address first to get in later as
its owner. The site refuses sessions opened with a password, but do not give
that account a role: delete the user in **Authentication → Users**, and have the
person sign in again with the emailed code.

**Check:** that person opens /admin and sees the queue, not "Moderators only".

---

## 4. The new AI model service

**Unblocks:** the model service measured on 1,144 photos of dead animals, which
names a species by itself only where it is right at least 95% of the time; and
the security fixes to the service (#123): a request without the token no longer
starts a GPU, and the service fetches no URLs. Both are merged and wait on this
step. A deploy on 30 September stopped at Modal's payment check and left the
current service (v2, 5 August) running unchanged.

1. **Modal** (modal.com, account `neolava2`): **Settings → Billing → add a
   payment method.** Modal now requires one to deploy GPU services. At this
   site's volume the use should stay inside Modal's free monthly credit, and a
   spending limit can be set on the same page.
2. The rest is engineering, written out in `docs/ai-rollout.md` (steps 3 to 7):
   deploy the service, smoke-test it, set `ML_CONTRACT=2` in Vercel production,
   redeploy, and check the next identification.

---

## 5. The discussion forum

**Unblocks:** the forum, built and switched off.

**Needs first:** the legal review of the terms, privacy notice and forum age
policy; public sign-in (step 1); and enough moderators to cover every day.

**Vercel → conservation-web → Settings → Environment Variables:** add
`FORUM_ENABLED` = `1` for Production, then redeploy the latest production
deployment. `docs/forum.md` describes the pilot.

**Check:** /community opens (it answers 404 while the variable is unset).
Nothing in the site's menus links to it yet, on purpose, so the pilot can run
with the team by direct link; a menu link is a small code change for the day it
opens to everyone.

---

## Also on the owner's list

These need people or agreements rather than settings: the legal review, contacting
TaiRON, the team roster for /team, the badge redraw, native readers for the
Chinese text, the numbers to give for injured animals and invasive species, and
a real-phone test. For that last one, sign in as a moderator and use the test
links on /admin, so nothing sent during the test is shown publicly.
