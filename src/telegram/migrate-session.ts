import { migrateTelegramSession } from "./migrate.js";
import { logger } from "../utils/logger.js";

// Explicit legacy-session migration CLI:
//   pnpm telegram:migrate-session -- --user <app-user-id>
// Copies `.telegram_session` into that user's isolated scope (verifies,
// preserves the source, never prints session contents). See migrate.ts.

function getArg(name: string): string | undefined {
  const prefix = `--${name}`;
  const idx = process.argv.indexOf(prefix);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  if (eq) return eq.slice(prefix.length + 1);
  return undefined;
}

async function main(): Promise<void> {
  const userId = getArg("user")?.trim() ?? "";
  try {
    const result = await migrateTelegramSession({ userId });
    logger.info(`Legacy session: ${result.legacyPath}`);
    logger.info(`Destination: ${result.destinationPath}`);
    if (result.status === "migrated") {
      logger.info("Migrated and verified. Source preserved (not deleted).");
    } else if (result.status === "already-migrated") {
      logger.info("Already migrated (destination matches). Nothing to do.");
    } else {
      logger.info("No legacy session found. Nothing to do.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Migration failed: ${message}`);
    process.exit(1);
  }
}

void main();
