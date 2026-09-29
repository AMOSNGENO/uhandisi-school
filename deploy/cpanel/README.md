# Putting Uhandisi School on cPanel

You need two files from `deploy/out/`, and both are made by `node deploy/cpanel/build.mjs --with-data`.

| File | What it is |
|---|---|
| `uhandisi-app.zip` | The whole site: the website, the server, and the startup file. |
| `uhandisi-data/` | Your current database (`uhandisi_school.sql`) and uploaded files (`uploads.zip`). **Private:** it holds users' details and password hashes. Upload it; don't email it or share it. |

The whole job takes about 20 minutes.

---

## 0. Check your hosting can run Node.js

In cPanel, go to **Software → Setup Node.js App**. If that icon isn't there, the plan can't run this site. Ask your host to switch it on, or move to a plan that includes Node.js. Most Kenyan hosts (Truehost, HostPinnacle, Safaricom Cloud and others) offer it on their cPanel plans.

## 1. Switch on HTTPS

Logging in only works over `https://`, because the login cookie is marked secure.

- In **Security → SSL/TLS Status**, make sure your domain has a certificate. If it doesn't, click **Run AutoSSL**.
- If the site should live on a subdomain (for example `learn.yourdomain.co.ke`), first create it in **Domains**.

## 2. Create the database and load your data

1. Go to **Databases → MySQL® Databases**.
   - **Create New Database:** `uhandisi`. cPanel names it `CPANELUSER_uhandisi`.
   - **Add New User:** `uhandisi`, with a strong password from the generator. Copy the password somewhere safe.
   - **Add User To Database:** pick that user and that database, tick **ALL PRIVILEGES**, and click **Make Changes**.
2. Go to **Databases → phpMyAdmin**.
   1. Click the new database on the left.
   2. Open **Import**, then **Choose File**, and pick `uhandisi_school.sql`.
   3. Click **Import**. It should end with a green success message and about 20 tables on the left.

## 3. Upload the site

Put the site in your home folder, **not** in `public_html`. That keeps the settings file and uploads out of public reach.

1. Open **Files → File Manager**. Stay in your home folder (the one that contains `public_html`).
2. Click **+ Folder** and name it `uhandisi-app`.
3. Open `uhandisi-app`, click **Upload**, and choose `uhandisi-app.zip`.
4. When the upload finishes, go back, right-click the zip, and choose **Extract** into `/uhandisi-app`.
5. Inside `uhandisi-app`, create a folder named `uploads`. Upload `uploads.zip` into it, then **Extract** it there.
6. Delete both zip files.

`uhandisi-app` should now contain `app.cjs`, `package.json`, `dist`, `public`, `uploads` and `.env.example`. If you can't see `.env.example`, open **Settings** (top right) and tick **Show Hidden Files**.

## 4. Fill in the settings

1. Rename `.env.example` to `.env`.
2. Right-click `.env` and choose **Edit**.
3. Change these two lines:

```
DATABASE_URL=mysql://CPANELUSER_uhandisi:YOURPASSWORD@localhost:3306/CPANELUSER_uhandisi
PUBLIC_URL=https://yourdomain.co.ke
```

Replace:
- `CPANELUSER_uhandisi` with the exact database name and user name shown in MySQL® Databases (both carry the prefix).
- `YOURPASSWORD` with the database password.

If the password contains `@ # : / ?`, write those characters as `%40 %23 %3A %2F %3F`.

You can leave the email and M-Pesa lines empty for now; see step 7. Save the file.

## 5. Create the Node.js app

1. Go to **Software → Setup Node.js App → Create Application**.
2. Fill in:
   - **Node.js version:** the newest offered, 20 or higher (18.18 is the minimum).
   - **Application mode:** Production
   - **Application root:** `uhandisi-app`
   - **Application URL:** your domain or subdomain
   - **Application startup file:** `app.cjs`
3. Click **Create**.
4. On the same page, click **Run NPM Install** and wait for it to finish. It installs two small packages.
5. Scroll up and click **Restart**.

If the Application URL already had a site (an old `index.html` or WordPress in `public_html`), move those files out of the way first. Otherwise they can show instead of this site.

## 6. Check it works

1. Open `https://yourdomain.co.ke`. You should see the homepage with your hero photo.
2. Log in with your admin account (`admin@uhandisi.com`, same password as on your PC).
3. Open a course and a certificate to make sure files show.

The first visit after a restart can take a few seconds while the app wakes up.

## 7. Later: email and M-Pesa

After any change to `.env`, click **Restart** in Setup Node.js App.

**Email** (password reset links):
1. Create a mailbox in **Email → Email Accounts**, for example `no-reply@yourdomain.co.ke`.
2. In `.env`, set these, then restart:

```
SMTP_HOST=mail.yourdomain.co.ke
SMTP_PORT=465
SMTP_USER=no-reply@yourdomain.co.ke
SMTP_PASS=that mailbox's password
MAIL_FROM=Uhandisi School <no-reply@yourdomain.co.ke>
```

**M-Pesa:**
1. Fill in the `MPESA_` lines with your production Daraja keys.
2. Register the callback URL with Safaricom: `https://yourdomain.co.ke/api/mpesa/callback`. The package already sets it, and `MPESA_CALLBACK_SECRET` has already been generated for you.

## Updating the site later

1. On your PC, run `node deploy/cpanel/build.mjs`. Leave out `--with-data` so your live database isn't touched.
2. Upload the new `uhandisi-app.zip` into `uhandisi-app` and **Extract**. Overwrite when asked.
3. Your `.env` and `uploads` folder aren't in the zip, so they stay as they are.
4. Click **Restart**.

## Backups

Your live data is the database plus the `uhandisi-app/uploads` folder.

- **Backup** (or **JetBackup**, if your host has it) downloads both.
- Take one every week and before every update. Keep copies off the server too.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Incomplete response", 503, or "We're sorry, but something went wrong" | Open `uhandisi-app/stderr.log` in File Manager. The last lines say what failed. |
| `Cannot find package 'mysql2'` in the log | Click **Run NPM Install**, then **Restart**. |
| `Access denied for user` in the log | The name or password in `DATABASE_URL` is wrong. Check the prefix and the `%` encoding. |
| Login button does nothing / you're logged straight out | Open the site with `https://`. Check that AutoSSL finished. |
| Old site still showing | Remove the old files at that address (see step 5), then **Restart**. |
| Uploading big IMS/SCORM zips fails | Your host limits upload size. Ask them to raise it, or upload smaller packages. |
