// Guard around `drizzle-kit push --force`.
//
// A force push can auto-truncate tables to satisfy a schema change — during
// the v19 deploy it offered to truncate calibration_pairs. In a data-bearing
// service that must never happen silently on a routine deploy. This guard
// refuses unless ALLOW_DESTRUCTIVE_DB_PUSH=true is explicitly set, turning a
// silent data-loss footgun into a deliberate, opt-in action. Prefer reviewed
// migrations (drizzle-kit generate + migrate) for schema changes.

import { spawnSync } from "node:child_process";

if (process.env.ALLOW_DESTRUCTIVE_DB_PUSH !== "true") {
  console.error(
    [
      "Refusing `drizzle-kit push --force`: it can auto-truncate tables to satisfy a",
      "schema change and silently destroy data (it offered to wipe calibration_pairs",
      "during the v19 deploy).",
      "",
      "To run it deliberately:  ALLOW_DESTRUCTIVE_DB_PUSH=true pnpm --filter @workspace/db run push-force",
      "For a non-destructive change, prefer reviewed migrations:",
      "  pnpm --filter @workspace/db run push     (interactive, no --force)",
    ].join("\n"),
  );
  process.exit(1);
}

const result = spawnSync(
  "drizzle-kit",
  ["push", "--force", "--config", "./drizzle.config.ts"],
  { stdio: "inherit", shell: true },
);
process.exit(result.status ?? 1);
