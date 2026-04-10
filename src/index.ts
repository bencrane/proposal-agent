import Fastify from "fastify";
import { getEnv, getReadiness } from "./config/env";
import { loadAllTenants } from "./lib/tenant-config";
import { healthRoutes } from "./routes/health";
import { calcomWebhookRoutes } from "./routes/webhooks/calcom";
import { proposalRoutes } from "./routes/proposals";

async function main() {
  const env = getEnv();
  const { ready, missing } = getReadiness();

  loadAllTenants();

  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
  });

  await app.register(healthRoutes);
  await app.register(calcomWebhookRoutes);
  await app.register(proposalRoutes);

  const port = env.PORT;
  await app.listen({ port, host: "0.0.0.0" });

  if (
    env.SLACK_ENABLE_SOCKET_MODE &&
    env.SLACK_BOT_TOKEN &&
    env.SLACK_SIGNING_SECRET &&
    env.SLACK_APP_TOKEN
  ) {
    const { startSlack } = await import("./slack/app");
    try {
      await startSlack();
      console.log("⚡ Slack bot is running");
    } catch (err) {
      app.log.warn(
        { err },
        "Slack bot failed to start, continuing without Slack integration"
      );
    }
  } else if (env.SLACK_BOT_TOKEN || env.SLACK_SIGNING_SECRET || env.SLACK_APP_TOKEN) {
    app.log.info(
      "Slack credentials found, but socket mode is disabled. Set SLACK_ENABLE_SOCKET_MODE=true to start Slack bot."
    );
  }

  console.log(`
╔══════════════════════════════════════════════════════╗
║           PROPOSAL AGENT — RUNNING                   ║
║  API:    http://0.0.0.0:${port}                          ║
║  Health: http://0.0.0.0:${port}/health                    ║
╠══════════════════════════════════════════════════════╣
║  ✅ Ready:   ${ready.join(", ") || "none"}
║  ⚠️  Missing: ${missing.join(", ") || "none — fully configured!"}
╚══════════════════════════════════════════════════════╝
  `);
}

main().catch((err) => {
  console.error("💀 Fatal error:", err);
  process.exit(1);
});
