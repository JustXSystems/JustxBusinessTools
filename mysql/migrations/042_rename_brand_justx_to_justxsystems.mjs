/**
 * Case-sensitive brand rename across all MySQL text/JSON columns:
 *   Justx Systems / Justx Business Tools / Justx BOS / bare Justx → Justxsystems…
 *
 * Complements 035 (which only rewrote JustX* with capital X). Lowercase
 * `justx` (emails, VPA, paths) and already-correct `Justxsystems` are untouched.
 *
 * @param {import("mysql2/promise").PoolConnection} conn
 */
export default async function migrate(conn) {
  /** @type {ReadonlyArray<[string, string]>} */
  const phraseRules = [
    ["JustXSystems", "Justxsystems"],
    ["JustxSystems", "Justxsystems"],
    ["JustX Business Tools", "Justxsystems Business Tools"],
    ["Justx Business Tools", "Justxsystems Business Tools"],
    ["JustX Systems LLP", "Justxsystems LLP"],
    ["Justx Systems LLP", "Justxsystems LLP"],
    ["JustX Systems", "Justxsystems"],
    ["Justx Systems", "Justxsystems"],
    ["JustX Sync Agent", "Justxsystems Sync Agent"],
    ["Justx Sync Agent", "Justxsystems Sync Agent"],
  ];

  function rename(text) {
    let s = String(text);
    // Shield already-correct brand so bare Justx replace cannot double it
    const shields = [];
    s = s.replace(/Justxsystems/g, (m) => {
      const i = shields.length;
      shields.push(m);
      return `\u0000SHIELD${i}\u0000`;
    });
    for (const [from, to] of phraseRules) {
      if (s.includes(from)) s = s.split(from).join(to);
    }
    s = s.replace(/JustX(?![Ss]ystems)/g, "Justxsystems");
    s = s.replace(/Justx(?![Ss]ystems)/g, "Justxsystems");
    s = s.replace(/\u0000SHIELD(\d+)\u0000/g, (_, i) => shields[Number(i)]);
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

    // Hit either capital-X legacy or bare Justx product chrome (Justx BOS, etc.)
    const [hits] = await q(
      `SELECT ${selectCols} FROM \`${table}\`
       WHERE \`${column}\` IS NOT NULL
         AND (
           CAST(\`${column}\` AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin LIKE ?
           OR CAST(\`${column}\` AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin LIKE ?
         )`,
      ["%JustX%", "%Justx%"],
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
      if (!raw.includes("JustX") && !raw.includes("Justx")) continue;
      const next = rename(raw);
      if (next === raw) continue;

      const whereReal = keyCols.map((k) => `\`${k}\` = ?`).join(" AND ");
      const pkValues = keyCols.map((_, i) => row[`pk${i}`]);

      await q(
        `UPDATE \`${table}\` SET \`${column}\` = ${isJson ? "CAST(? AS JSON)" : "?"} WHERE ${whereReal}`,
        [next, ...pkValues],
      );
      updated += 1;
    }
    if (updated) summary.push(`${table}.${column}=${updated}`);
  }

  if (summary.length) {
    console.log(`[042_rename_brand_justx_to_justxsystems] updated: ${summary.join(", ")}`);
  } else {
    console.log(`[042_rename_brand_justx_to_justxsystems] no Justx*/JustX* rows needed rewriting`);
  }
}
