/**
 * Next.js server boot hook (Node.js runtime).
 *
 * Registers process-wide SIGINT/SIGTERM cleanup exactly once per process so
 * every active WhatsApp/Telegram client is destroyed on shutdown. Noisy
 * per-manager handlers are avoided here on purpose: a single coordination
 * point (src/lib/lifecycle.ts) walks both registries. Registration itself
 * is idempotent, so development HMR cannot stack duplicate handlers.
 */
export async function register(): Promise<void> {
  const { registerProcessShutdownHandlers } = await import("./lib/lifecycle.js");
  registerProcessShutdownHandlers();
}
