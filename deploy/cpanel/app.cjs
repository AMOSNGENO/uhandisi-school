// Startup file for cPanel "Setup Node.js App" (Phusion Passenger).
// Passenger needs a CommonJS file; this one loads .env and then starts the server bundle in dist/.
const fs = require("node:fs");
const path = require("node:path");

// Settings from .env, unless the same name is already set in cPanel's Environment variables.
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  // Windows editors may start the file with an invisible BOM, which would hide the first setting.
  for (const line of fs.readFileSync(envFile, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}

process.env.NODE_ENV = process.env.NODE_ENV || "production";
// Passenger decides the real port itself; the server only needs some value.
process.env.PORT = process.env.PORT || "3000";

import(path.join(__dirname, "dist", "index.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]:)/, "file:///$1")).catch((err) => {
  console.error("Uhandisi School failed to start:", err);
  process.exit(1);
});
