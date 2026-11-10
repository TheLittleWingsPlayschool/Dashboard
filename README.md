# The Little Wings Play School — Admin & Classes Dashboard (v2.2, cloud) + Parents app

A mobile-friendly dashboard for **The Little Wings Play School, Vuyyuru**, live at
**https://thelittlewingsplayschool.github.io/Dashboard/**.

It is plain static files (no build step) hosted on GitHub Pages. Since v2 the data is kept in the
school's **private Supabase database** (project `little-wings-dashboard`, Mumbai region, free plan), so the
admin and teachers see the same data on every phone, each with their own login.

## What it does
- **Real logins**: email + password for every person (Supabase Auth). Roles: **Admin** and **Teacher**.
- **Dashboard**: students per class (Toddlers, Nursery, LKG, UKG), today's attendance %, fees collected, pending fees, enquiries, charts, follow-ups due, birthdays.
- **Classes**: students per class with search; add/edit/delete students (DOB with auto age, parent, tap-to-call and WhatsApp, fee, emergency contact, medical notes, authorised pickup).
- **Attendance**: Present/Absent/Leave/Half-day, mark-all-present, monthly register, absent list with a WhatsApp message to the parent.
- **Fees**: record payments (Cash/UPI/Bank) with auto-numbered, printable receipts and WhatsApp sharing; monthly pending list.
- **Enquiries**: leads and follow-ups; convert an enquiry into a student.
- **Staff**: role, phone, class and monthly salary (admin only).
- **Notices** (new in v2.2): admin posts to the whole school or one class; teachers post to their own class. Pin, optional "show until" date, delete. Parents see them in the Parents app.
- **Settings**: school details, class teachers, **teacher logins**, **parent logins**, change password, **backup/restore (JSON)**, **CSV exports**, and a one-time **import of old data** from v1.
- **Sync**: changes save online immediately. If the phone is offline they wait on the phone and upload automatically when the internet is back. The badge at the top shows **Online / Syncing / Offline · N / Sync problem** (tap it to retry). Other phones update live (Supabase Realtime), with a 30-second poll and a refresh whenever the app is reopened as back-ups.

## Roles and what the database allows
Access is enforced **in the database** with Row Level Security (RLS), not only hidden in the app:

| | Admin | Teacher | Parent (Parents app) |
|---|---|---|---|
| Students | all classes: read, add, edit, delete | **own class only**: read, add, edit (no delete) | **only their own child(ren)**: name and class, nothing else |
| Attendance | all classes | **own class only** | **only their own child's** status per day (never the rest of the class) |
| Notices | all: post, pin, delete | read school-wide + own class; post/pin/delete **own** notices for own class | read school-wide + their children's classes (not expired) |
| Monthly fees, payments/receipts, enquiries, staff & salaries | full access | **no access at all** (the database returns nothing) | **no access at all** |
| School settings | read and edit | read only (school name) | no access |
| Logins | create / edit / reset password / remove teachers and parents | change own password | change own password |

## First-time setup (the owner does this once)
1. Open https://thelittlewingsplayschool.github.io/Dashboard/ .
2. The very first visit shows **Create admin account**. Enter your name, email and a password (8+ characters).
   This first account becomes the **admin**. It can only happen once: after that, sign-ups are closed.
3. If you used the old version on this phone, go to **Settings → Backup & data** and tap
   **Import this device's old local data into the cloud** (once). On another device with old data, sign in
   as admin there and do the same. You can also restore an old backup file with **Restore from backup**.

> Do this soon after publishing: until the admin account exists, whoever opens the site first could create it.

## Adding teachers
**Settings → Teacher logins → Add teacher login**: name, class, the teacher's email and a temporary password
(tap *Suggest one*). Share the email and password with the teacher. They sign in on their phone and can change the
password in **Settings → My account**. From the same list you can **Edit** (name/class), set a **New password**, or **remove** a login.

Teacher accounts are created by a small server function (`supabase/functions/lw-admin`), which checks that the
caller is the admin. The secret service key lives only on Supabase's servers, never in this website.

## Parents app (new in v2.2)
A separate app for parents: **https://thelittlewingsplayschool.github.io/Dashboard/parents/** (folder `parents/`).
Parents sign in with their **mobile number** and a password from the school. They see:
- the child's name and class (a switcher if they have more than one child at the school),
- **Today**: present / absent / leave / half-day / not marked yet,
- **This month**: present, absent, leave and half-day counts and the attendance %,
- a **monthly calendar** (green present, red absent, yellow leave, blue half-day, purple Sunday/holiday, white not marked) with previous/next month,
- **Notices** from the school and from their child's class (pinned first, newest first, marked *School* or the class name). New notices appear live, the app also checks every minute and when it is reopened, and there is a 🔄 refresh button / pull-down to refresh.

It installs like the dashboard (iPhone Safari: Share → Add to Home Screen; Android Chrome: ⋮ → Install app) with its own
"Little Wings Parents" icon. Without internet it opens and shows the last saved view with an "offline" note.
**Sign out** (👤 → Sign out) removes the child's details from the phone. *Forgot password?* The app tells parents to ask the
school office (+91 79955 54105); the admin sets a new one.

### Creating a parent login (admin)
1. Add the child on **Classes** first.
2. Either open the child (Classes → tap the name) → **📲 Parents app → Create parent login**, or go to
   **Settings → Parent logins → Add parent login**.
3. Check the parent's name and **10-digit mobile number** (this is their login ID), tap *Suggest one* for a temporary password,
   tick the child — and brothers/sisters, so one login shows all of them — and tap **Create login**.
4. Tap **Send on WhatsApp** to send the parent the app link, their mobile number and password.

From **Settings → Parent logins** you can **Edit** (name, mobile number, linked children), set a **New password**, or
**remove** the login. One mobile number = one login.

How it works: parent logins are created by the `lw-admin` server function (admin only). Internally the mobile number is
stored as the address `<mobile>@parents.littlewings.app`; no email is ever sent to it. Parents cannot read any table
directly — they get their child's data only through two database functions (`parent_children`, `parent_attendance`) that
check the link between the parent and the child (`parent_students`). SQL: `supabase/parents.sql`.

## Optional Supabase settings (dashboard.supabase.com → project *little-wings-dashboard*)
Nothing is required for normal use. Only the **"Forgot password?" email link** needs this:
- **Authentication → URL Configuration**: set **Site URL** to `https://thelittlewingsplayschool.github.io/Dashboard/`
  and add the same address under **Redirect URLs**. (Without it, the reset email's link opens a localhost page.)
  Teachers can always ask the admin to set a new password instead.
- Supabase's built-in email sender is limited to a few emails per hour. For many reset emails, add your own SMTP under
  **Authentication → Emails → SMTP Settings**.
- On a paid plan you can also enable **Leaked password protection** (Authentication → Providers → Email).

"Confirm email" does **not** need to be changed: accounts made by the app are created already confirmed.

## Backup
Data is safe online, but still take **Settings → Download backup (JSON)** every month and keep it in Google Drive/email.
**Restore from backup** adds the file's records to the database (same IDs are updated; nothing is deleted).
CSV exports open in Excel/Google Sheets.

## Install as an app
The dashboard is a Progressive Web App. You can add it to your Home Screen so it opens like a regular app (no app store needed).

1. **iPhone (Safari):** open the dashboard → tap **Share** (the square with the arrow) → **Add to Home Screen**.
2. **Android (Chrome):** open the dashboard → tap **⋮** (the menu) → **Install app** or **Add to Home screen**.
3. **Computer (Chrome or Edge):** look for the install icon in the address bar, or use the browser menu.

On Android and desktop Chrome, an **Install app** button may also appear on the sign-in screen and in **Settings**. The same step-by-step is always listed there.

After the first visit, the app shell (the pages, styles, icons and the sign-in screen) is stored on the phone, so the dashboard still opens without internet. School data uses the same offline copy as before: changes wait on the phone and upload when you are back online. **Signing out still removes that data from the phone**, along with any changes not yet uploaded (the app warns first). When a new version is published, a banner says **New version available — tap to refresh**.

## Files
- `index.html`, `style.css`, `app.js` — the app. `Store` at the top of `app.js` is the only data layer (offline copy + sync).
- `config.js` — Supabase project URL and the **publishable** key (public by design; access is controlled by login + RLS).
- `manifest.webmanifest`, `sw.js`, `assets/icons/` — PWA manifest, service worker and icons (so the app can be installed and the shell works offline).
- `assets/vendor/supabase-js-2.119.0.js` — the official Supabase JavaScript client (bundled, no CDN needed).
- `supabase/schema.sql` — tables, RLS policies and triggers (documentation copy of what runs in the database).
- `supabase/parents.sql` — v2.2 additions: parent role, `parent_students`, `notices`, parent-only RPCs and their RLS (run after `schema.sql`).
- `supabase/functions/lw-admin/index.ts` — server function for creating the first admin and managing teacher and parent logins.
- `parents/` — the Parents app (`index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `sw.js`, `icons/`). It reuses `config.js`, the bundled Supabase client and the logo from the dashboard folder.

## Limitations
- **Last write wins**: if two people edit the same record at the same moment, the later save wins. Attendance is stored per class per day, so different classes never clash.
- Receipt numbers are checked against existing receipts, but two devices recording payments while both offline could still pick the same number.
- The offline copy uses the phone's browser storage (about 5 MB), enough for several years of a small school. Signing out removes it from that phone, along with any changes not yet uploaded (the app warns first). The installed app’s shell (pages and icons) stays on the phone so you can still reach the sign-in screen.
- Supabase's free plan pauses a project after about a week with no activity. Normal daily use keeps it awake. If it pauses, open the project in the Supabase dashboard and click **Restore**.
- Password-reset emails need the URL setting above and are limited by Supabase's free email sender.
- Parents app: there is no school holiday calendar yet, so only Sundays are shown as holidays; other closed days show as "not marked". Notices are text only (no photos/attachments). There are no push notifications: new notices show when the app is open (live) or next opened.
