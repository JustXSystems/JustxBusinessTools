/* eslint-disable no-console */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

(async () => {
  const email = process.env.JUSTTESTX_EMAIL || "santhosh.hs@justxsystems.com";
  const password = process.env.JUSTTESTX_PASSWORD || "Justx@2026";
  console.log("db_user", process.env.DB_USER, "db", process.env.DB_NAME, "email", email);
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
    console.error("USER_MISSING");
    process.exit(2);
  }
  await conn.query("UPDATE users SET password_hash = ?, status = 'active' WHERE email = ?", [hash, email]);
  console.log("password_reset_ok", email);
  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
