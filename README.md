# VisionConnect Jobs

Accessible job portal for job seekers with any disability, and employers who want to hire them.
Node 18+, Express, EJS (server-rendered, works without JavaScript), Supabase.

## Set up (once)
1. Supabase -> SQL Editor -> paste and run **`db/schema.sql`**. It is safe on a new project and on your existing one (adds missing columns, removes the old unsafe public policies, creates the `sessions` table).
2. Render -> Environment: set the variables from `.env.example`. **`SUPABASE_SERVICE_ROLE_KEY` is now required** (the anon key can no longer read or write anything, by design).
3. Create your admin: `node scripts/create-admin.js you@example.com "Your Name" "a-strong-password"`
4. Deploy. The private `resumes` storage bucket is created automatically on start.

## Keep it awake (Render free tier)
The server pings its own public address every 10 minutes (`lib/keepalive.js`), which also keeps your free Supabase project active. This starts automatically on Render. **Add one free external pinger as well**, because a service that is already asleep cannot wake itself: create a free monitor at uptimerobot.com (or cron-job.org) for `https://YOUR-SITE.onrender.com/healthz?db=1` every 5 minutes.

## Emails (forgot password, notifications)
Create a free Brevo account, verify one sender email, create an API key, then set `MAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `MAIL_FROM`. Without them the site works, but "Forgot password" cannot send emails.

## Run locally
`npm install && cp .env.example .env` (fill it in) then `npm run dev`.
Optional demo data for a TEST project: `node scripts/seed-demo.js`.

## Tests
`npm test` runs 25 end-to-end tests against a real database. Point `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` at a **test** project (tests create and delete their own data) and set `STORAGE_DRIVER=local`.

## Accessibility features
Skip links, landmarks, one h1 per page, labelled forms with an error summary that takes focus, field-level errors tied with `aria-describedby`, status announcements, 48px targets, two-tone focus ring, 3 text sizes, light / dark / high-contrast themes, wide spacing, reduced motion, read-aloud, voice commands (English, Hindi, Marathi), reflow to 320px at the largest text size. Automated axe-core scan: 0 violations on all pages in all 3 themes. **Still test with real NVDA / JAWS / TalkBack users before launch.**

## Security notes
Strict CSP (no inline scripts or styles), CSRF tokens, login rate limit, bcrypt, sessions stored in the database, RLS locked for public roles, private resume storage with owner / admin / applied-employer access only.
