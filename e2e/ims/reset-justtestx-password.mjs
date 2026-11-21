/**
 * One-shot: reset JustTestX owner password on the DB pointed at by server/.env.
 * Usage on VPS: node e2e/ims/reset-justtestx-password.mjs
 */
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, "server/.env") });

const email = process.env.JUSTTESTX_EMAIL || "santhosh.hs@justxsystems.com";
const password = process.env.JUSTTESTX_PASSWORD || "Justx@2026";

const hash = await bcrypt.hash(password, 10);
const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [rows] = await conn.query("SELECT id, email, status FROM users WHERE email = ?", [email]);
console.log("user before:", rows);
if (!rows.length) {
  console.error("USER_MISSING:", email);
  process.exit(2);
}
await conn.query("UPDATE users SET password_hash = ?, status = 'active' WHERE email = ?", [hash, email]);
console.log("password_reset_ok", email);
await conn.end();
