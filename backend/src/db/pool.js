import pg from "pg";

const url = process.env.DATABASE_URL?.replace(/sslmode=[^&]+/, "sslmode=no-verify");
if (!url) throw new Error("PostgreSQL connection is required");

export const pool = new pg.Pool({
  connectionString: url,
  max: 5,
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error", error.code || "unknown");
});
