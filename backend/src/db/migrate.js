import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { pool } from "./pool.js";

const schema = new URL("../../../db/schema.sql", import.meta.url);
const lock = 748392001;
const readyQuery =
  "SELECT to_regclass('public.facilities') IS NOT NULL AS ready";

async function isReady(db) {
  const result = await db.query(readyQuery);
  return result.rows[0].ready;
}

export async function migrate() {
  const db = await pool.connect();
  let transaction = false;

  try {
    if (await isReady(db)) return;
    await db.query("BEGIN");
    transaction = true;
    await db.query("SELECT pg_advisory_xact_lock($1)", [lock]);
    if (!(await isReady(db))) {
      await db.query(await readFile(schema, "utf8"));
    }
    await db.query("COMMIT");
    transaction = false;
  } catch (error) {
    if (transaction) await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function main() {
  try {
    await migrate();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
