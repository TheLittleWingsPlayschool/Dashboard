# The Little Wings Play School — Admin & Classes Dashboard (v2, cloud)

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
- **Settings**: school details, class teachers, **teacher logins**, change password, **backup/restore (JSON)**, **CSV exports**, and a one-time **import of old data** from v1.
- **Sync**: changes save online immediately. If the phone is offline they wait on the phone and upload automatically when the internet is back. The badge at the top shows **Online / Syncing / Offline · N / Sync problem** (tap it to retry). Other phones update live (Supabase Realtime), with a 30-second poll and a refresh whenever the app is reopened as back-ups.

## Roles and what the database allows
Access is enforced **in the database** with Row Level Security (RLS), not only hidden in the app:

| | Admin | Teacher |
|---|---|---|
| Students | all classes: read, add, edit, delete | **own class only**: read, add, edit (no delete) |
| Attendance | all classes | **own class only** |
| Monthly fees, payments/receipts, enquiries, staff & salaries | full access | **no access at all** (the database returns nothing) |
| School settings | read and edit | read only (school name) |
| Logins | create / edit / reset password / remove teachers | change own password |

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

## Files
- `index.html`, `style.css`, `app.js` — the app. `Store` at the top of `app.js` is the only data layer (offline copy + sync).
- `config.js` — Supabase project URL and the **publishable** key (public by design; access is controlled by login + RLS).
- `assets/vendor/supabase-js-2.119.0.js` — the official Supabase JavaScript client (bundled, no CDN needed).
- `supabase/schema.sql` — tables, RLS policies and triggers (documentation copy of what runs in the database).
- `supabase/functions/lw-admin/index.ts` — server function for creating the first admin and managing teacher logins.

## Limitations
- **Last write wins**: if two people edit the same record at the same moment, the later save wins. Attendance is stored per class per day, so different classes never clash.
- Receipt numbers are checked against existing receipts, but two devices recording payments while both offline could still pick the same number.
- The offline copy uses the phone's browser storage (about 5 MB), enough for several years of a small school. Signing out removes it from that phone, along with any changes not yet uploaded (the app warns first).
- Supabase's free plan pauses a project after about a week with no activity. Normal daily use keeps it awake. If it pauses, open the project in the Supabase dashboard and click **Restore**.
- Password-reset emails need the URL setting above and are limited by Supabase's free email sender.
