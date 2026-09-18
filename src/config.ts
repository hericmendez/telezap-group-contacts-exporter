import * as dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  groupName: string;
  outputFile: string;
}

/**
 * Parse CLI args: supports --group "Name" and --output "path"
 * CLI args take precedence over env vars.
 */
function getCliArg(name: string): string | undefined {
  const prefix = `--${name}`;
  const idx = process.argv.indexOf(prefix);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  // also support --name=value
  const eq = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  if (eq) return eq.slice(prefix.length + 1);
  return undefined;
}

export function loadConfig(): AppConfig {
  const groupName = getCliArg("group") ?? process.env.GROUP_NAME ?? "";
  const outputFile =
    getCliArg("output") ?? process.env.OUTPUT_FILE ?? "output/contacts.csv";

  return {
    groupName: groupName.trim(),
    outputFile: outputFile.trim() || "output/contacts.csv",
  };
}

export function validateConfig(config: AppConfig): void {
  if (!config.groupName) {
    throw new Error(
      'Missing group name. Set GROUP_NAME in .env or pass --group "My Group".',
    );
  }
  if (!config.outputFile) {
    throw new Error("Missing output file path.");
  }
}
