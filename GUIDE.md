# VisionConnect Jobs: Simple Guide

This guide explains the whole project in simple English: what it is, how it works, how to put it online, and what to do if something goes wrong.

---

## 1. What is this?

VisionConnect Jobs is a free job website for students and graduates with **any disability**: blind or low vision, deaf or hard of hearing, mobility, speech, autism, intellectual disability, and more. Employers can post jobs and hire them.

The website works with a screen reader, a keyboard, voice commands, a magnifier, and even with JavaScript turned off.

---

## 2. Who uses it?

| Person | What they do |
|---|---|
| **Job seeker (student)** | Makes a profile, uploads a resume, searches jobs, applies, saves jobs, follows the status |
| **Employer** | Posts jobs, sees applicants, downloads resumes, changes the status of each applicant |
| **Admin** | Approves or rejects jobs, manages users |

---

## 3. How it works

### Job seeker
1. Register (choose "job seeker") and log in.
2. Fill the profile: skills, education, disability type, what support you need, how you like to be interviewed. Upload a resume (PDF, DOC, DOCX or TXT, up to 5 MB).
3. Search jobs. Apply with "Quick apply" or add a cover letter.
4. Follow the status on the dashboard: Applied, In review, Shortlisted, Hired, or Not selected. An email is sent when the status changes.

### Employer
1. Register (choose "employer") and log in.
2. Go to **Post a job** and fill the form: title, company, place, job type, description, salary, which disabilities the job suits, and what support you give (screen reader, wheelchair access, remote work, and so on).
3. The job is saved as **pending**. It is not public yet.
4. When the admin approves it, the job goes live.
5. See applicants, download resumes, and change each status. You can edit, close, reopen, or delete your job. If you edit a job, it goes for review again.

### Admin
1. Log in with the admin account.
2. Open **Admin → Jobs → Pending**.
3. **Approve** to make a job live, or **Reject** and write a reason. The employer can see the reason.
4. Open **Admin → Users** to switch a user on or off.

The admin account cannot be made from the website. Make it on the server with `npm run create-admin`.

---

## 4. Accessibility features

- Skip links, clear headings, and labelled forms
- Error messages are read out and take you to the field
- 3 colour themes: light, dark, high contrast
- 3 text sizes, wide spacing, and an option to turn animations off
- Read the page aloud
- Voice commands in English, Hindi and Marathi
- Works with a keyboard only
- Interview choices: phone, video, in person, written, text chat, sign language interpreter, video with live captions, wheelchair-accessible venue

---

## 5. Put it online (deploy)

### Step 1: Supabase (database and resume storage)
1. Make a free project at supabase.com.
2. Open **SQL Editor**, paste all of `db/schema.sql`, and press Run.
3. Resume storage: the app tries to make a private bucket called `resumes` by itself. If the log says it could not, open **Storage** and make a **private** bucket called `resumes`.
4. Open **Project Settings → API**. Copy the **Project URL** and the **service_role** key.
   Keep the service_role key secret. Never put it in the browser or on GitHub.

### Step 2: Choose a host that does not sleep
- **Best:** Oracle Cloud "Always Free" VM. It never sleeps. Install Node 22, run the app with `pm2`, and use Caddy for free HTTPS.
- **Easy:** any free Node host, plus a free pinger (Step 4).

### Step 3: Settings (environment variables)
Copy `.env.example` and fill it in. These are required:

| Name | What to put |
|---|---|
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | Your Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service_role key |
| `SESSION_SECRET` | A long random text. Make one with `openssl rand -hex 32` |
| `KEEP_ALIVE_URL` | Your public site address, for example `https://jobs.example.com` |

Needed for email (forgot password and status emails):

| Name | What to put |
|---|---|
| `BREVO_API_KEY` | Key from brevo.com (free: 300 emails a day) |
| `MAIL_FROM` | `"VisionConnect Jobs <your-verified-email>"`. Verify this email in Brevo first |
| `APP_URL` | Your public site address |

Shown on the Contact page: `CONTACT_EMAIL`, `CONTACT_PHONE`.

Only if your site has **no HTTPS** (for example a plain IP address): set `COOKIE_SECURE=false`. Without it, login will not stay logged in. Use HTTPS if you can.

Commands:
```
npm ci
npm start
```

### Step 4: Keep it awake
1. The app pings itself every 10 minutes (`/healthz?db=1`). This also keeps the free Supabase project from pausing.
2. A sleeping server cannot wake itself, so also add a free external pinger. UptimeRobot or cron-job.org will do. Set it to open `https://your-site/healthz?db=1` every 5 minutes.

### Step 5: Make the admin
Run this once on the server:
```
node scripts/create-admin.js you@example.com "Your Name" "a-strong-password"
```
(`npm run create-admin -- you@example.com "Your Name" "a-strong-password"` also works.) Then log in on the normal login page. After login, the admin goes straight to **/admin/dashboard**.

### Step 6: Test one full round
1. Register an employer and post a job.
2. Log in as admin and approve the job.
3. Register a seeker, fill the profile, upload a resume, and apply.
4. As the employer, open the applicant, download the resume, and change the status.
5. Check that the seeker got an email.
6. Try "Forgot password".
7. Try the site with a screen reader (NVDA or TalkBack) once.

---

## 6. Startup check

When the app starts, it prints lines that start with `[check]` in the host log. They tell you:
- if the database tables are missing (run `db/schema.sql`)
- if Supabase cannot be reached (wrong URL or key, or the project is paused)
- if there is no admin yet
- if email or contact settings are empty

Read these lines first when something looks wrong.

---

## 7. If something goes wrong

| Problem | Reason | Fix |
|---|---|---|
| App stops right at start | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `SESSION_SECRET` is missing | Set all three in the host settings |
| Every page shows error 500 | The database tables are missing | Run `db/schema.sql` in Supabase |
| Login does not stay | The site has no HTTPS | Use HTTPS, or set `COOKIE_SECURE=false` |
| Resume upload fails | The `resumes` bucket is missing | Make a private bucket called `resumes` in Supabase Storage |
| No emails arrive | Brevo key or sender email is wrong, or the sender is not verified | Verify the sender in Brevo and check `MAIL_FROM` |
| First page is slow | The host went to sleep | Add the external pinger |
| Site works but data fails | The Supabase free project is paused | Open Supabase and restore it. Keep the pinger on |
| Jobs not showing | The jobs are still pending | The admin must approve them |
| Resumes disappear after a redeploy | `STORAGE_DRIVER=local` on a host with a temporary disk | Use `STORAGE_DRIVER=supabase` |

---

## 8. What is still your job

- Ask a lawyer to read the Privacy and Terms pages. They are general text.
- Test with real screen reader users.
- Check the real Supabase, emails and hosting after you deploy. They were tested only on a local copy.
- There is no employer verification. The admin approval of each job is the safety check.
- The site is in English. Only the voice commands also work in Hindi and Marathi.

---

## 9. Security in short

- The database key stays on the server only.
- Passwords are hashed. Forms have CSRF protection. Login and similar actions are rate limited.
- Resumes are private. Only the owner, the admin, and an employer the student applied to can open them.
- Sessions are stored in the database.

---

## 10. Folders

```
server.js          main app
routes/            pages by area: auth, jobs, seeker, employer, admin, files
views/             page templates (EJS)
public/            CSS, small scripts, icon
db/schema.sql      database setup (run once)
lib/               helpers: labels, mail, storage, keep-alive, startup check
scripts/           create-admin, seed-demo
tests/             25 automatic tests
```

Useful commands: `npm start` (run), `npm run dev` (run while developing), `npm run create-admin`, `npm test` (needs a test Supabase, never use production).
