import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Glob every schema file directly so table registration never depends on
  // the index.ts barrel: a schema file missing a re-export would otherwise
  // be silently absent from push. The invariants script asserts that every
  // table referenced by the route layer appears in the DDL this config
  // resolves (drizzle-kit export).
  schema: path.join(__dirname, "./src/schema/*.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
