import * as readline from "node:readline";
import { hashPassword } from "./hash.js";

// Administrative helper: print a TELEZAP_USERS password hash entry.
// Usage: pnpm auth:hash -- <username>   (then type the password + Enter)
// Only the hash is printed — put it into `.env`, never the password.
async function main(): Promise<void> {
  // pnpm forwards a literal "--" separator; ignore it.
  const username = process.argv.slice(2).find((a) => a !== "--")?.trim();
  if (!username || username.includes(":") || username.includes(",")) {
    console.error('Usage: pnpm auth:hash -- <username> (no ":" or "," allowed)');
    process.exit(1);
  }
  const password = await readLine("Password (input hidden is not supported, avoid shoulder-surfing): ");
  if (!password) {
    console.error("Empty password refused.");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  console.log(`\nAdd to .env TELEZAP_USERS (append with "," if users exist):\n\n${username}:${hash}`);
}

function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

void main();
