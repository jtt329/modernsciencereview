import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: numberFromEnv("PG_POOL_MAX", 5),
  connectionTimeoutMillis: numberFromEnv("PG_CONNECTION_TIMEOUT_MS", 8000),
  idleTimeoutMillis: numberFromEnv("PG_IDLE_TIMEOUT_MS", 30000),
  query_timeout: numberFromEnv("PG_QUERY_TIMEOUT_MS", 30000),
  statement_timeout: numberFromEnv("PG_STATEMENT_TIMEOUT_MS", 30000),
});

pool.on("error", (err) => {
  console.error("Unexpected idle Postgres client error", err);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
