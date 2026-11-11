# The Little Wings Play School — Admin & Classes Dashboard (v2.9, cloud) + Parents app (v1.7)

A mobile-friendly dashboard for **The Little Wings Play School, Vuyyuru**, live at
**https://thelittlewingsplayschool.github.io/Dashboard/**.

It is plain static files (no build step) hosted on GitHub Pages. Since v2 the data is kept in the
school's **private Supabase database** (project `little-wings-dashboard`, Mumbai region, free plan), so the
admin and teachers see the same data on every phone, each with their own login.

## What it does
- **Real logins**: email + password for every person (Supabase Auth). Roles: **Admin** and **Teacher**.
- **Dashboard**: students per class (Toddlers, Nursery, LKG, UKG), today's attendance %, fees collected, pending fees, enquiries, charts, follow-ups due, birthdays.
- **Classes / Admission**: students per class with search and an Active/Inactive filter; add/edit/delete students (DOB with auto age, mother/father/guardian names and mobiles, address, yearly fee for all classes, optional nursery monthly fee, section after class, status, private photo, emergency contact, medical notes, authorised pickup). Inactive students stay listed but are left out of attendance and fee dues.
- **Attendance**: Present/Absent/Leave/Half-day, mark-all-present, monthly register, absent list with a WhatsApp message to the parent.
- **Fees**: record payments (Cash/UPI/Bank) for one month or several months at once (term / advance), monthly pending list, and **professional fee receipts** (new in v2.3, see below).
- **Enquiries** (updated in v2.4): student name, date of birth, father/mother names and mobiles, optional qualifications, address, and feedback (Interested or Doubtful); search and filter; call and WhatsApp buttons; convert an enquiry into an admission (the form is pre-filled and the enquiry is marked converted).
- **Staff**: role, phone, class and monthly salary (admin only).
- **Notices** (new in v2.2): admin posts to the whole school or one class; teachers post to their own class. Pin, optional "show until" date, delete. Parents see them in the Parents app.
- **Settings**: school details (including configurable class sections), class teachers, **teacher logins**, **parent logins**, change password, **backup/restore (JSON)**, **CSV exports**, and a one-time **import of old data** from v1.
- **Sync**: changes save online immediately. If the phone is offline they wait on the phone and upload automatically when the internet is back. The badge at the top shows **Online / Syncing / Offline · N / Sync problem** (tap it to retry). Other phones update live (Supabase Realtime), with a 30-second poll and a refresh whenever the app is reopened as back-ups.

## Roles and what the database allows
Access is enforced **in the database** with Row Level Security (RLS), not only hidden in the app:

| | Admin | Teacher | Parent (Parents app) |
|---|---|---|---|
| Students | all classes: read, add, edit, delete | **own class only**: read, add, edit (no delete) | **only their own child(ren)**: name and class, nothing else |
| Attendance | all classes | **own class only** | **only their own child's** status per day (never the rest of the class) |
| Notices | all: post, pin, delete | read school-wide + own class; post/pin/delete **own** notices for own class | read school-wide + their children's classes (not expired) |
| Monthly fees, payments/receipts | full access | **no access at all** (the database returns nothing) | **only their own child's** fee summary and receipts, and only when the admin turns on *Show fees to parents* (v2.3); no internal notes |
| Enquiries, staff & salaries | full access | **no access at all** | **no access at all** |
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

## Fee receipts (new in v2.3)
Every payment gets a printable receipt (Fees → 🧾, or a student → **All receipts**). It shows the logo, school name, address,
phone/WhatsApp and email (from **Settings → School details**), receipt number, date, student, class, parent, the month(s) paid for,
monthly fee, amount paid, payment mode and UPI/bank reference, the **amount in words** (e.g. *Rupees One Thousand Five Hundred Only*,
Indian lakh/crore style), the **balance due after this payment**, **Received by** (the admin's name) with a signature line, and
*This is a computer-generated receipt*. Internal payment notes are never printed.

Buttons on the receipt:
- **Share on WhatsApp**: opens WhatsApp with a short receipt summary, addressed to the parent's WhatsApp/phone number when it is saved on the student.
- **Save image**: makes a PNG of the receipt (drawn on the phone, nothing is uploaded). On phones that support it the share sheet opens, so you can send the image straight to the parent on WhatsApp; otherwise it downloads.
- **Save as PDF**: opens the print window with one receipt on an A4 page. Choose **Save as PDF** as the printer (iPhone: Share → Save to Files). The file is named after the receipt.
- **Print (2 copies)**: one A4 page with a *Parent copy* and an *Office copy* and a cut line.

**Months covered**: when recording a payment you can choose 1–12 months (for example a 3-month term). The amount is split over those
months (each month's due first, any extra on the last month), so dues and the Parents app stay correct. Old payments keep working.

**Receipt numbers**: `<prefix>-0001, -0002…` (prefix in Settings). A new number is never one that already exists. *Known limitation:* if
two phones record payments while **both** are offline, both can pick the same number. After they sync, the Fees page shows a warning
**Same receipt number used twice** with a **Give new number** button for the newer payment (the older one keeps its number).

### Fees in the Parents app (admin switch)
Parents get a **💰 Fees** tab showing, for each of their own children: monthly fee, pending fees (calculated exactly like the dashboard,
from the later of the admission month and *Track pending fees from*), this month's status, months paid, total paid, and the list of
payments with date, amount, month(s), mode and receipt number. **View / Print receipt** opens the same receipt design (Print / Save as PDF,
Save image, Share on WhatsApp).

It is **off** until you switch it on: **Settings → 💰 Fees in the Parents app → Show fees to parents**. While it is off, parents see
*"Fee details are not shown yet"*, and any fee details saved on their phone are removed at the next refresh. The switch is checked
inside the database, so it cannot be bypassed from a browser.

How it works: parents still cannot read the `payments` or `student_fees` tables (RLS unchanged). They get data only through two database
functions, `parent_fees(student)` and `parent_payments(student)`, which return rows only for a child linked to that parent login, only parent-safe
fields (no notes, no staff data, no other child), and nothing unless `settings.data.showFeesToParents` is `true`. SQL: `supabase/receipts.sql`.

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
Data is safe online, but still take a backup every month: **More → Backup → Download backup (Excel)** and keep the file in Google Drive or email. The Excel file has one sheet each for students, enquiries, payments, attendance, notices, expenses, salaries, staff, staff attendance and holidays. **Full backup (JSON)** is the complete copy that **Restore from backup** can read back (it adds the file's records; same IDs are updated; nothing is deleted). The page shows the last backup date, and the dashboard shows a reminder when it is more than 30 days old.
CSV exports open in Excel/Google Sheets.

## Install as an app
The dashboard is a Progressive Web App. You can add it to your Home Screen so it opens like a regular app (no app store needed).

1. **iPhone (Safari):** open the dashboard → tap **Share** (the square with the arrow) → **Add to Home Screen**.
2. **Android (Chrome):** open the dashboard → tap **⋮** (the menu) → **Install app** or **Add to Home screen**.
3. **Computer (Chrome or Edge):** look for the install icon in the address bar, or use the browser menu.

On Android and desktop Chrome, an **Install app** button may also appear on the sign-in screen and in **Settings**. The same step-by-step is always listed there.

After the first visit, the app shell (the pages, styles, icons and the sign-in screen) is stored on the phone, so the dashboard still opens without internet. School data uses the same offline copy as before: changes wait on the phone and upload when you are back online. **Signing out still removes that data from the phone**, along with any changes not yet uploaded (the app warns first). When a new version is published, a banner says **New version available — tap to refresh**.

## Enquiries, admission and photos (new in v2.4)
The **Enquiries** page (admin only) records a child's name and date of birth, both parents' names and mobiles, optional qualifications, address, and feedback: **Interested** or **Doubtful**. You can search, filter by feedback, call or WhatsApp either parent, and **Convert to admission**, which opens the student form already filled in and marks the enquiry as converted.

The admission / student form now has mother, father and guardian names and mobiles, the student's address, a **yearly fee** (all classes), an optional **monthly fee for Nursery only**, **status** (Active / Inactive) and a **section** chosen after the class (sections are set in Settings, default A–D). If the monthly fee is left blank, pending dues and receipts show yearly fee ÷ 12; existing stored payments are not changed. Inactive (and older “Left”) students stay on the list but are excluded from attendance and fee dues.

Student photos are uploaded to a **private** Supabase Storage bucket, resized on the phone first (about 600 px JPEG). The bucket is never public: the app uses short-lived signed URLs. Teachers can see photos of their own class only; parents see only their own child's photo, plus section and status, in the Parents app. Enquiries stay hidden from teachers and parents (the database returns nothing).

## New in v2.5 (Batch 1)
On a phone the bottom bar has **Dashboard, Classes, Attendance, Fees, Enquiries** and **More**. More opens Pending fees, Reports, Expenses, Staff, Holidays, Notices, Backup and Settings.

- **Pending fees** (admin): every student with dues, with this month and earlier months shown separately. Use **Remind** to open WhatsApp with a ready message, or **Remind all** to step through parents one by one. The page shows when each parent was last reminded (IST). You can change the message in **Settings → WhatsApp messages**.
- **Fee rules** (Settings, both **off** by default):
  - **Late fee:** a flat amount, or an amount per day with an optional monthly cap. It applies after the due day (1–28) from a chosen month, until that month's fee is fully paid.
  - **Sibling discount:** % or ₹ off the monthly fee for the 2nd and later child who shares a parent mobile with a child admitted earlier.
  - Dues, receipts, the Pending page, reports and the Parents app all use the same rules (the database has the same calculation). Payments already saved are never changed.
- **Birthdays:** a dashboard card for today and the next 7 days, with a WhatsApp **Wish** button. The greeting can be edited in Settings.
- **Holidays & events:** Sundays are always holidays. Holidays you add are skipped on the Attendance page (with **Mark anyway**) and in working-day counts. Teachers can view the list, and parents see it in the Parents app (v1.3). Only the admin can change it.
- **Expenses:** date, category, amount, mode and note, with monthly totals and a breakdown by category.
- **Staff** (admin): three tabs.
  - **Staff:** the staff list.
  - **Salary:** record a payment with advance, deduction and bonus, then get a printable **salary slip** (Print / Save as PDF).
  - **Attendance:** present, absent or half-day for each staff member.
- **Reports** (admin):
  - **Fees:** expected, collected and pending by class and by month.
  - **Attendance:** % by class and by student.
  - **Enquiries → admission:** by month and by feedback.
  - **Profit:** fees received vs expenses vs salaries.
  - Every report can be printed or saved as PDF, and all four export to one Excel file.
- **Excel backup** (no internet library: `assets/xlsx-lite.js` writes the .xlsx in the browser) and a backup reminder. See *Backup*.
- **Website enquiry form:** a public Edge Function, `lw-enquiry`. It only **adds** an enquiry (source *Website*, marked **NEW** in Enquiries and on the dashboard) and never reads data. It checks the website address, validates every field, has a hidden spam trap and a minimum fill time, and limits each device to 3 an hour (6 a day). The same mobile can only send once in 6 hours, and the whole form takes at most 60 a day. A ready-to-paste form for the school website is kept outside this repo (copy it into the website's `index.html`).

Database: run `supabase/batch1.sql` after `enquiry_admission.sql`. It adds the `holidays`, `expenses`, `salaries`, `staff_attendance`, `fee_reminders` and `web_enquiry_hits` tables, all with RLS. Teachers can only read holidays, and parents get holidays through the `parent_holidays()` RPC only. The file also adds the fee-rule functions and the new `parent_fees()` columns `late_fee` and `discount`.

## New in v2.6 (Batch 2, part A)
Teachers now also get **More** (Homework, Timetable, Exams, Gallery, Holidays, Notices, Account). Admin-only screens are marked below.

- **Homework & updates:** the class teacher (own class) or the admin posts *Homework*, *Today we learned* or *Meal* notes with an optional photo. Photos are compressed on the phone and kept in the private `class-media` bucket. Parents see their own child's class posts (last 30 days) in the Parents app, with photos through short-lived signed links.
- **Timetable:** a Mon–Sat timetable per class. The admin or that class's teacher edits it; parents can only read it (Parents app → More → Timetable).
- **Exams & report cards:** create an exam/term with subjects (marks out of a maximum, or grade-only subjects), enter marks/grades/remarks (AB = absent). The printable report card has the logo and can be printed / saved as PDF or shared on WhatsApp. Only the **admin** can turn on **Publish**; the database blocks teachers from publishing. Parents see only their own child's **published** report cards.
- **Admission documents** (admin): in a student's details, upload Aadhaar, birth certificate, etc. (PDF or photo, up to 10 MB) to the private `student-docs` bucket. Opened with a 2-minute signed link; delete removes the file. Teachers and parents can never read them.
- **Transport** (admin): vans with driver name and phone, vehicle number and route; assign students with their own van fee and start month. The van fee is a **separate line** in the monthly dues (with the same late-fee rule) and on receipts. Saved payments are never rewritten; unticking a student ends the van from this month, earlier months keep their van fee. **Print van list.**
- **ID cards & TC** (admin): printable ID cards, 8 per A4 sheet (85.6 × 54 mm), with photo, class & section, parent phone and the school address. **Issue TC** prints a transfer certificate (TC-0001…), sets the student to *Left* or *Inactive* with the leaving date, and records the dues on the TC. Attendance, fees and receipts stay.
- **Year-end promotion** (admin): pick students and their next class (or *Leaves*), the new **academic year** and the month the new class/fee starts. **Preview** before saving; **Undo last promotion** restores class, status and fees. Earlier months keep their old fee (saved as fee history in `student_fees.fee_hist`), so past dues are not re-priced; attendance and payment history are untouched. Fees can carry over or use a new yearly fee per class.
- **Parent messages** (admin): parents send feedback from the app (max 1 per 2 minutes and 5 a day). Inbox with **New / All**, **Mark seen**, **Reply** and delete; parents see *Sent / Seen / Replied* and your reply.
- **Audit log** (admin): database triggers record every add/change/delete on students, student fees, payments and settings (who, when, old → new). Keys that look like passwords, PINs or tokens are never recorded. Filter by table, change type, dates and text. Nobody can write or edit the log from the app.
- **Gallery** (admin uploads): albums for the whole school or one class. Photos are compressed (max 1600 px), videos MP4/WebM/MOV up to 25 MB, all in the private `gallery` bucket with signed links. Parents see whole-school albums and their own child's class albums; delete removes the file.

Parents app v1.4: new **Updates** tab (homework/daily notes), and **More** with Fees, Timetable, Report cards (print/PDF, WhatsApp), Gallery and Feedback. The fee summary and receipts show the van fee line.

Database: run `supabase/batch2.sql` after `batch1.sql` (already applied to the project). It adds `class_posts`, `timetables`, `exams`, `marks` (class-scoped RLS), `vans`, `student_docs`, `promotions`, `feedback`, `albums`, `audit_log`, `push_subscriptions`, `push_log` (all with RLS), the three private buckets with storage policies, van/fee-history fee functions, and the parent RPCs `parent_posts`, `parent_timetable`, `parent_report_cards`, `parent_albums`, `parent_feedback_send`, `parent_feedback_list`. `parent_fees()` gains `van_fee`; `parent_payments()` gains `van_fee`.

## New in v2.7 (Batch 2, part B)
- **Language: English / తెలుగు / हिन्दी.** The dashboard has a language menu in the top bar (and in More); the Parents app has one on the sign-in screen and in More → Language. The choice is saved on the device (and with the login, so it follows the person). Names typed by the school are shown as entered.
- **Phone alerts (Web Push) for the Parents app.** Parents tap **More → Alerts → Turn on alerts** (Android Chrome; on iPhone the app must first be added to the Home Screen, iOS 16.4+). They get an alert for new notices, homework/daily updates for their child's class, an absent mark today, new gallery albums, and fee reminders (only while fees are shown to parents). Tapping an alert opens the right tab. **Send a test alert** checks the phone. Signing out removes that phone's subscription. Each alert is sent once per item (re-saving does not alert twice).
- Server: Edge Function `lw-push` (in `supabase/functions/lw-push/`, standard Web Push: RFC 8291 encryption + VAPID, no external service). It checks the login itself, only admin/teacher can trigger alerts (teachers only for their own class), and it reads subscriptions with the server key, never from the browser. Subscriptions are stored in `push_subscriptions` (each parent can only see/delete their own; RLS).

### One-time setup for phone alerts (owner, ~2 minutes)
Until this is done the apps work normally and show *Phone alerts are not switched on yet*.
1. Dashboard → **More → Settings → Phone alerts → Create alert keys**. Two keys are shown **once** in your browser (nothing is saved anywhere).
2. In **supabase.com → project little-wings-dashboard → Edge Functions → Secrets**, add:
   - `VAPID_PUBLIC_KEY` = the public key
   - `VAPID_PRIVATE_KEY` = the private key
   - optional `VAPID_SUBJECT` = `mailto:thelittlewingsplayschool@gmail.com`
3. Reload Settings: the card turns green. Parents can now turn on alerts.

Never paste the private key into WhatsApp, email, a chat or this repository. If it was ever shared, create a new pair, replace both secrets, and parents simply tap *Turn on alerts* again.

## v2.7.1 — easier menu
The menu is grouped into **Daily, Students, Money, School** and **Admin**. On a computer the side menu now scrolls on its own (short laptop screens), and each group can be folded by tapping its heading (remembered on that device; the group of the open page always opens). On a phone the **More** page uses the same groups. The *New version available* bar now sits just above the bottom bar and no longer covers menu items.

## v2.9 — share the receipt itself, not just text

- **Share receipt** (fee receipt), **Share slip** (salary slip) and **Share** (report card) now send a real file: a picture (PNG, about 2× sharp; JPEG if it would be over ~1.5 MB) through the phone's share sheet, so it can go straight to WhatsApp or any app. **Share PDF** sends a one-page A4 PDF instead.
- The file is made on the phone when the receipt opens (logo, ₹ sign, Telugu/Hindi names included), so the tap shares at once. Closing the share sheet shows no error.
- On a computer (no file sharing), the file is downloaded and WhatsApp Web opens to the parent's number with the message — attach the downloaded file there. The app says "saved — attach it in WhatsApp"; it never claims it was attached.
- **Save image**, **Save PDF**, **Print** and the old **Text only** WhatsApp link are kept.
- Parents app v1.7: the same Share / Share PDF / Save buttons on fee receipts and report cards (English, Telugu, Hindi).
- ID cards are unchanged (multi-card A4 sheets; still Print / Save as PDF).

## v2.8 — never lose typed changes
Every form in the dashboard (pop-ups and page forms such as Settings, Timetable, Marks, Notices, Promotion, Documents) remembers the values it was opened with. If something was changed and you try to leave — **Cancel**, **✕**, **Esc**, tapping outside, the phone/browser **Back** button, the menu, another page, switching class/date, **Sign out**, or closing/reloading the tab — a small box asks:
- **Save** — saves (if something is missing it stays on the form and shows what to fix),
- **Keep editing** — (selected by default) closes the box only,
- **Discard** — drops the changes and continues.

If nothing was changed it closes straight away. Unsaved attendance (class and staff) is treated the same way. Save buttons show *Saving…* and cannot be tapped twice. Saving still works offline (it uploads when the internet is back). Labels are in English, తెలుగు and हिन्दी. The Parents app (v1.6) asks the same before leaving a typed, unsent **Feedback** message (Send / Keep editing / Discard).

## Files
- `index.html`, `style.css`, `app.js` — the app. `Store` at the top of `app.js` is the only data layer (offline copy + sync).
- `config.js` — Supabase project URL and the **publishable** key (public by design; access is controlled by login + RLS).
- `manifest.webmanifest`, `sw.js`, `assets/icons/` — PWA manifest, service worker and icons (so the app can be installed and the shell works offline).
- `assets/vendor/supabase-js-2.119.0.js` — the official Supabase JavaScript client (bundled, no CDN needed).
- `supabase/schema.sql` — tables, RLS policies and triggers (documentation copy of what runs in the database).
- `supabase/parents.sql` — v2.2 additions: parent role, `parent_students`, `notices`, parent-only RPCs and their RLS (run after `schema.sql`).
- `supabase/receipts.sql` — v2.3: `parent_fees` / `parent_payments` RPCs for the Parents app Fees tab (run after `parents.sql`).
- `supabase/enquiry_admission.sql` — v2.4: yearly fee column, private `student-photos` bucket and RLS, expanded `parent_children()` (section, status, photo path), and `parent_fees()` dues that treat Inactive like Left and use yearly÷12 when no nursery monthly fee is set (run after `receipts.sql`).
- `assets/receipt.js`, `assets/receipt.css` — the shared fee receipt (HTML, print to one A4 page, PNG image, WhatsApp text, amount in words), used by both apps. No external libraries.
- `supabase/batch1.sql` — v2.5: holidays, expenses, salaries, staff attendance, fee reminders, website-enquiry rate-limit log (all RLS), `parent_holidays()`, fee rules (late fee, sibling discount) in `parent_fees()`.
- `supabase/batch2.sql` — v2.6: homework/updates, timetables, exams & marks, vans and van fee, fee history, admission documents, promotions, feedback, albums, audit log (triggers), push subscriptions (all RLS), private `class-media` / `student-docs` / `gallery` buckets and the new parent RPCs.
- `supabase/functions/lw-push/index.ts`, `webpush.ts` — v2.7 phone alerts (Web Push) function; the VAPID private key is only an Edge Function secret.
- `supabase/functions/lw-enquiry/index.ts` — v2.5 public website enquiry form endpoint (insert-only, validated, rate-limited).
- `assets/xlsx-lite.js` — tiny Excel (.xlsx) writer for backups and reports.
- `supabase/functions/lw-admin/index.ts` — server function for creating the first admin and managing teacher and parent logins.
- `parents/` — the Parents app (`index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `sw.js`, `icons/`). It reuses `config.js`, the bundled Supabase client and the logo from the dashboard folder.

## Limitations
- **Last write wins**: if two people edit the same record at the same moment, the later save wins. Attendance is stored per class per day, so different classes never clash.
- Receipt numbers are checked against existing receipts, but two devices recording payments while both offline could still pick the same number; the Fees page then shows a warning with a one-tap fix (see *Fee receipts*).
- *Save as PDF* uses the phone's print window (no PDF library is bundled). The receipt image is a PNG; there is no automatic attachment to WhatsApp messages — WhatsApp links carry the text summary, and the image can be shared from the share sheet.
- Apart from the optional sibling discount, one-off concessions are not a separate field: record the amount actually paid (and lower the student's fee if the concession is permanent).
- The offline copy uses the phone's browser storage (about 5 MB), enough for several years of a small school. Signing out removes it from that phone, along with any changes not yet uploaded (the app warns first). The installed app’s shell (pages and icons) stays on the phone so you can still reach the sign-in screen.
- Supabase's free plan pauses a project after about a week with no activity. Normal daily use keeps it awake. If it pauses, open the project in the Supabase dashboard and click **Restore**.
- Password-reset emails need the URL setting above and are limited by Supabase's free email sender.
- Parents app: there is no school holiday calendar yet, so only Sundays are shown as holidays; other closed days show as "not marked". Notices are text only (no photos/attachments). There are no push notifications: new notices show when the app is open (live) or next opened.
