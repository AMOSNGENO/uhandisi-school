import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set, e.g. mysql://root@localhost:3306/uhandisi_school",
  );
}

export const pool = mysql.createPool({ uri: process.env.DATABASE_URL, timezone: "Z" });
export const db = drizzle(pool, { schema, mode: "default" });

export * from "./schema";
export { setupDatabase } from "./setup";
export { hashPassword, verifyPassword } from "./password";
