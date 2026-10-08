// Builds the cPanel upload package:  node deploy/cpanel/build.mjs [--with-data]
//
//   deploy/out/uhandisi-app.zip      the app: server bundle, website, startup file, package.json
//   deploy/out/uhandisi-data/        (--with-data) database export + uploads zip. PRIVATE: contains
//                                    users' details and password hashes; upload it, never share it.
import { execFileSync, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const api = path.join(root, "artifacts/api-server");
const web = path.join(root, "artifacts/uhandisi-school");
const out = path.join(root, "deploy/out");
const app = path.join(out, "uhandisi-app");
const withData = process.argv.includes("--with-data");
const run = (cmd, cwd, env = {}) => { console.log(`\n> ${cmd}`); execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } }); };

// Carry Daraja credentials from the private local API .env into the cPanel
// template. Never package the .env itself; only selected M-Pesa settings go in.
const localEnvPath = path.join(api, ".env");
const localEnv = existsSync(localEnvPath) ? readFileSync(localEnvPath, "utf8") : "";
const localSetting = (name) => {
  const match = localEnv.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : "";
};
const envValue = (name, fallback = "") => localSetting(name) || fallback;

// 1. Website (static files) and server bundle.
run("npx vite build --config vite.config.ts", web, { PORT: "5180", BASE_PATH: "/", NODE_ENV: "production" });
run("node build.mjs", api, { NODE_ENV: "production" });

// 2. Assemble the app folder.
rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
cpSync(path.join(api, "dist"), path.join(app, "dist"), { recursive: true });
cpSync(path.join(web, "dist/public"), path.join(app, "public"), { recursive: true });
cpSync(path.join(here, "app.cjs"), path.join(app, "app.cjs"));

// Only the packages the bundle loads at run time; everything else is inside dist/index.mjs.
const apiPkg = JSON.parse(readFileSync(path.join(api, "package.json"), "utf8"));
const runtime = ["mysql2", "nodemailer"];
writeFileSync(path.join(app, "package.json"), JSON.stringify({
  name: "uhandisi-school",
  version: "1.0.0",
  private: true,
  description: "Uhandisi School (built for cPanel Node.js hosting)",
  main: "app.cjs",
  scripts: { start: "node app.cjs" },
  engines: { node: ">=18.18" },
  dependencies: Object.fromEntries(runtime.map((name) => [name, apiPkg.dependencies[name]])),
}, null, 2) + "\n");

// Settings template for the server. The callback secret is new for each build.
writeFileSync(path.join(app, ".env.example"), `# Rename to .env on the server and fill in. Never share this file.
NODE_ENV=production

# From cPanel → MySQL Databases. Special characters in the password must be URL-encoded
# (@ → %40, # → %23, : → %3A, / → %2F, ? → %3F).
DATABASE_URL=mysql://CPANELUSER_uhandisi:PASSWORD@localhost:3306/CPANELUSER_uhandisi

# Your site's address. Links use the address people actually visit; this is the fallback.
PUBLIC_URL=${envValue("PUBLIC_URL", "https://uhandisischool.com")}

# Email for password reset codes: the cPanel mailbox. Put its password in SMTP_PASS.
SMTP_HOST=${envValue("SMTP_HOST", "mail.uhandisischool.com")}
SMTP_PORT=465
SMTP_USER=${envValue("SMTP_USER", "noreply@uhandisischool.com")}
SMTP_PASS=
MAIL_FROM=${envValue("MAIL_FROM", "Uhandisi School <noreply@uhandisischool.com>")}

# M-Pesa (Daraja). Values are copied from the private local API .env when present.
# Production STK Push also requires the production shortcode and Lipa Na M-Pesa passkey.
MPESA_ENV=${envValue("MPESA_ENV", "production")}
MPESA_CONSUMER_KEY=${envValue("MPESA_CONSUMER_KEY")}
MPESA_CONSUMER_SECRET=${envValue("MPESA_CONSUMER_SECRET")}
MPESA_SHORTCODE=${envValue("MPESA_SHORTCODE")}
MPESA_PASSKEY=${envValue("MPESA_PASSKEY")}
MPESA_TRANSACTION_TYPE=${envValue("MPESA_TRANSACTION_TYPE", "CustomerPayBillOnline")}
MPESA_TILL_NUMBER=${envValue("MPESA_TILL_NUMBER")}
MPESA_CALLBACK_URL=${envValue("MPESA_CALLBACK_URL", "https://uhandisischool.com/api/mpesa/callback")}
MPESA_CALLBACK_SECRET=${envValue("MPESA_CALLBACK_SECRET", randomBytes(24).toString("hex"))}
`);

// 3. Zip it (Windows 10+ tar writes zip files).
const zip = path.join(out, "uhandisi-app.zip");
rmSync(zip, { force: true });
execFileSync("tar", ["-a", "-c", "-f", zip, "-C", app, "."]);
console.log(`\nApp package: ${zip}`);

// 4. Optional: the local database and uploaded files, to carry your courses and users over.
if (withData) {
  const data = path.join(out, "uhandisi-data");
  rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  const mysqldump = process.env.MYSQLDUMP || "c:/xampp2/mysql/bin/mysqldump.exe";
  const dbName = new URL(readFileSync(path.join(api, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim()).pathname.slice(1);
  // No CREATE DATABASE (cPanel names databases itself). Logins and reset links aren't worth moving.
  const sql = execFileSync(mysqldump, ["-uroot", "--single-transaction", "--skip-lock-tables", "--no-tablespaces", "--default-character-set=utf8mb4",
    `--ignore-table=${dbName}.sessions`, `--ignore-table=${dbName}.password_resets`, dbName], { maxBuffer: 1024 * 1024 * 1024 });
  writeFileSync(path.join(data, `${dbName}.sql`), sql);
  if (existsSync(path.join(api, "uploads"))) execFileSync("tar", ["-a", "-c", "-f", path.join(data, "uploads.zip"), "-C", path.join(api, "uploads"), "."]);
  console.log(`Data (private): ${data}`);
}
