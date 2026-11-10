# The Little Wings Play School — Admin & Classes Dashboard

A simple, mobile-friendly dashboard for **The Little Wings Play School, Vuyyuru**. It is plain static files (`index.html`, `style.css`, `app.js`, `assets/logo.jpeg`). There is no build step, no server and nothing loaded from the internet.

## What it does
- **PIN lock**: on first run the admin creates a 4–6 digit PIN. Admin can add **teacher logins** (each teacher sees only their own class's students and attendance; no fees, staff or settings).
- **Dashboard**: students per class (Toddlers, Nursery, LKG, UKG), today's attendance %, fees collected this month, total pending, enquiries and conversions, simple charts, follow-ups due and birthdays.
- **Classes**: students per class with search; add, edit and delete students (DOB with auto age, parent, tap-to-call and WhatsApp, fee, emergency contact, medical notes, authorised pickup).
- **Attendance**: Present/Absent/Leave/Half-day taps, mark-all-present, a monthly register and an absent list (with WhatsApp message to the parent).
- **Fees**: record payments (Cash/UPI/Bank) with auto-numbered receipts, a pending list per month, printable receipts and WhatsApp sharing.
- **Enquiries**: track leads and follow-ups (due ones are highlighted). One click converts an enquiry into a student in the right class for the child's age.
- **Staff**: role, phone, class and monthly salary (admin only).
- **Settings**: school details, class teachers, teacher logins, PIN change, **Backup / Restore (JSON)** and **CSV exports**.

## Publish on GitHub Pages
1. Open the repo `TheLittleWingsPlayschool/Dashboard` on GitHub.
2. Click **Add file → Upload files**. Drag in *all* files from this folder (`index.html`, `style.css`, `app.js`, `README.md`, `.nojekyll` and the `assets` folder). Then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, then branch **main**, folder **/ (root)**, and click **Save**.
4. After a minute the app is live at `https://thelittlewingsplayschool.github.io/Dashboard/`.

(The `screens/` folder holds screenshots only. You don't need to upload it.)

## Important: data stays on one device
All data is saved in the **browser's localStorage on the device that entered it** (keys start with `lw_`). It is not uploaded anywhere, so:
- Another phone or computer will **not** see the same data.
- Clearing browser data, using private/incognito mode, or losing the device **erases it**.
- **Download a backup regularly** (Settings → Backup) and keep it in Google Drive or email. You can restore it on any device.

The PIN is a **convenience lock**, not strong security. It is stored as a salted SHA-256 hash, but anyone with the device and technical skill could read browser data.

For cloud sync later: all storage goes through the small `Store` module at the top of `app.js` (`load`, `save`, `exportAll`, `importAll`, `subscribe`).
