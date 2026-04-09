import Fastify from "fastify";
import { getEnv } from "./config/env";
import { loadAllTenants } from "./lib/tenant-config";
import { healthRoutes } from "./routes/health";
import { calcomWebhookRoutes } from "./routes/webhooks/calcom";
import { proposalRoutes } from "./routes/proposals";
import { startSlack } from "./slack/app";

async function main() {
  // Load environment
  const env = getEnv();

  // Load tenant configs from disk
  loadAllTenants();

  // Initialize Fastify
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  // Register routes
  await app.register(healthRoutes);
  await app.register(calcomWebhookRoutes);
  await app.register(proposalRoutes);

  // Start Fastify
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`🚀 Proposal Agent API running on port ${env.PORT}`);

  // Start Slack bot (socket mode — runs alongside Fastify)
  await startSlack();

  console.log(`
╔══════════════════════════════════════════════════════╗
║           PROPOSAL AGENT — RUNNING                   ║
║                                                      ║
║  API:    http://localhost:${env.PORT}                    ║
║  Health: http://localhost:${env.PORT}/health              ║
║  Slack:  Socket mode (listening for messages)        ║
║                                                      ║
║  Waiting for Cal.com webhooks...                     ║
╚══════════════════════════════════════════════════════╝
  `);
}

main().catch((err) => {
  console.error("💀 Fatal error:", err);
  process.exit(1);
});
