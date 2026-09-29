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
5. **Supabase → Authentication → Emails → Templates → Magic Link.** Subject:
   `福爾摩沙守望計畫 登入碼 · Your sign-in code`. Body:

   ```html
   <p>你的登入碼 · Your sign-in code:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>在登入頁輸入這組數字。也可以直接開啟這個連結：<br>
      Type it on the sign-in page, or open this link:</p>
   <p><a href="{{ .ConfirmationURL }}">登入 · Sign in</a></p>
   <p>如果不是你要求的，請忽略這封信。 · If you did not ask for this, ignore this email.</p>
   ```

   The sign-in page already accepts both the code and the link.

**Check:** sign in on the live site with an address that is not in the Supabase
project. The email should arrive within a minute with a 6-digit code.

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
select id, 'moderator' from auth.users where email = 'someone@example.com'
on conflict (id) do update set role = excluded.role;
```

Use `'admin'` instead of `'moderator'` for an admin. At least two admins, one of
them an adult.

**Check:** that person opens /admin and sees the queue, not "Moderators only".

---

## 4. The new AI model service

**Unblocks:** the model service measured on 1,144 photos of dead animals, which
names a species by itself only where it is right at least 95% of the time. The
current service keeps running until then.

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
