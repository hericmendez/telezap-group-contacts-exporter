import { loadConfig } from "./config.js";
import { WhatsAppManager } from "./whatsapp/manager.js";
import {
  GroupNotFoundError,
  AmbiguousGroupError,
} from "./whatsapp/group.js";
import { logger } from "./utils/logger.js";

// CLI is a thin consumer of WhatsAppManager:
//   CLI → WhatsAppManager → whatsapp-web.js
// Session/QR/lifecycle ownership lives in the manager, not here.

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.groupName) {
    logger.error('Missing group name. Set GROUP_NAME in .env or pass --group "My Group".');
    process.exit(1);
  }

  logger.info("Initializing WhatsApp client...");

  const manager = new WhatsAppManager();
  manager.attachProcessShutdownHandlers();

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled rejection: ${msg}`);
  });

  logger.info("Waiting for authentication... (scan QR if prompted)");

  try {
    await manager.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message);
    await manager.disconnect();
    process.exit(1);
  }

  const connectedNumber = manager.getConnectedNumber();
  if (connectedNumber) {
    logger.info(`Connected as: ${connectedNumber}`);
  }

  logger.info(`Searching for group: ${config.groupName}`);
  logger.info("Extracting participants...");
  logger.info("Resolving contacts...");
  logger.info("Exporting CSV...");

  // Respect OUTPUT_FILE override if set to non-default; otherwise the manager
  // derives output/<sanitized-group-name>.csv from the discovered group.
  const defaultOutput = "output/contacts.csv";
  const useOverride = config.outputFile !== defaultOutput;

  try {
    const result = await manager.exportGroup(
      config.groupName,
      useOverride ? { outputFile: config.outputFile } : undefined,
    );
    logger.info(`Group found: ${result.groupName}`);
    logger.info(`Group ID: ${result.groupId}`);
    logger.info(`Participants: ${result.participantCount}`);
    logger.info(`Participants extracted: ${result.participantCount}`);
    logger.info(`Contacts resolved: ${result.resolvedCount}`);
    logger.info(`Contacts unresolved: ${result.unresolvedCount}`);
    logger.info(`CSV exported: ${result.outputPath}`);
    await manager.disconnect();
    process.exit(0);
  } catch (err) {
    if (err instanceof GroupNotFoundError || err instanceof AmbiguousGroupError) {
      logger.error(err.message);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Export failed: ${message}`);
    }
    await manager.disconnect();
    process.exit(1);
  }
}

void main();
