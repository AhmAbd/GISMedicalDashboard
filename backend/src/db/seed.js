import { readFile } from "node:fs/promises";

import { migrate } from "./migrate.js";
import { pool } from "./pool.js";

try {
  await migrate();
  const file = new URL("../../../db/seed.sql", import.meta.url);
  await pool.query(await readFile(file, "utf8"));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
