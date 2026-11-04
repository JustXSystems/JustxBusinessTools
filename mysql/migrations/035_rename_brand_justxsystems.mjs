/**
 * Case-sensitive brand rename across all MySQL text/JSON columns:
 *   JustXSystems → Justxsystems (and longer phrases), then JustX → Justxsystems
 *
 * Lowercase `justx` (emails, VPA, paths) is untouched.
 * Invoked by server migration runner (supports .mjs migrations).
 *
 * @param {import("mysql2/promise").PoolConnection} conn
 */
export default async function migrate(conn) {
  /** @type {ReadonlyArray<[string, string]>} */
  const rules = [
    ["JustXSystems", "Justxsystems"],
    ["JustX Business Tools", "Justxsystems Business Tools"],
    ["JustX Systems LLP", "Justxsystems LLP"],
    ["JustX Systems", "Justxsystems"],
    ["JustX Sync Agent", "Justxsystems Sync Agent"],
    ["JustX", "Justxsystems"],
  ];

  function rename(text) {
    let s = String(text);
    for (const [from, to] of rules) {
      if (s.includes(from)) s = s.split(from).join(to);
    }
    return s;
  }

  /** Positional `?` bindings — pool has namedPlaceholders:true which breaks `?` arrays. */
  function q(sql, values = []) {
    return conn.query({ sql, values, namedPlaceholders: false });
  }

  const [dbRows] = await q(`SELECT DATABASE() AS db`);
  const db = String(/** @type {{ db: string }[]} */ (dbRows)[0]?.db || "").trim();
  if (!db) throw new Error("No database selected");

  const [cols] = await q(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json')
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [db],
  );

  const [pkRows] = await q(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [db],
  );

  /** @type {Map<string, string[]>} */
  const pks = new Map();
  for (const r of /** @type {{ tableName: string; columnName: string }[]} */ (pkRows)) {
    const list = pks.get(r.tableName) || [];
    list.push(r.columnName);
    pks.set(r.tableName, list);
  }

  const skipTables = new Set(["schema_migrations"]);

  const summary = [];
  for (const col of /** @type {{ tableName: string; columnName: string; dataType: string }[]} */ (cols)) {
    const table = col.tableName;
    const column = col.columnName;
    if (skipTables.has(table)) continue;

    const isJson = col.dataType === "json";
    const keyCols = pks.get(table) || [];
    if (!keyCols.length) continue; // skip tables without PK (unsafe bulk rewrite)

    const selectCols = [
      ...keyCols.map((k, i) => `\`${k}\` AS \`pk${i}\``),
      `\`${column}\` AS __v`,
    ].join(", ");

    const [hits] = await q(
      `SELECT ${selectCols} FROM \`${table}\`
       WHERE \`${column}\` IS NOT NULL
         AND CAST(\`${column}\` AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin LIKE ?`,
      ["%JustX%"],
    );
    const rows = /** @type {Record<string, unknown>[]} */ (hits);
    if (!rows.length) continue;

    let updated = 0;
    for (const row of rows) {
      const rawVal = row.__v;
      const raw =
        rawVal == null
          ? ""
          : typeof rawVal === "string"
            ? rawVal
            : typeof rawVal === "object"
              ? JSON.stringify(rawVal)
              : String(rawVal);
      if (!raw.includes("JustX")) continue;
      const next = rename(raw);
      if (next === raw) continue;

      const where = keyCols.map((_, i) => `\`pk_col_${i}\` = ?`).join(" AND ");
      // Rebuild with real column names (aliases only used for SELECT)
      const whereReal = keyCols.map((k) => `\`${k}\` = ?`).join(" AND ");
      const pkValues = keyCols.map((_, i) => row[`pk${i}`]);
      void where;

      await q(
        `UPDATE \`${table}\` SET \`${column}\` = ${isJson ? "CAST(? AS JSON)" : "?"} WHERE ${whereReal}`,
        [next, ...pkValues],
      );
      updated += 1;
    }
    if (updated) summary.push(`${table}.${column}=${updated}`);
  }

  if (summary.length) {
    console.log(`[035_rename_brand_justxsystems] updated: ${summary.join(", ")}`);
  } else {
    console.log(`[035_rename_brand_justxsystems] no JustX* rows found`);
  }
}
