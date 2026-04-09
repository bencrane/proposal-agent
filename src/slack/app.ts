import { App, LogLevel } from "@slack/bolt";
import { getEnv } from "../config/env";
import { handleRefinementMessage } from "./handlers/refinement";

let _app: App | null = null;

export function getSlackApp(): App {
  if (!_app) {
    const env = getEnv();
    _app = new App({
      token: env.SLACK_BOT_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
      appToken: env.SLACK_APP_TOKEN,
      socketMode: true, // Use socket mode for dev — switch to HTTP events for prod if needed
      logLevel: env.LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO,
    });

    // Register message handler for thread replies (refinement)
    _app.message(async ({ message, say, client }) => {
      // Only handle messages in threads (replies to our proposal notifications)
      if (!("thread_ts" in message) || !message.thread_ts) return;
      if ("bot_id" in message && message.bot_id) return; // Ignore bot messages
      if (message.type !== "message" || !("text" in message) || !message.text) return;

      await handleRefinementMessage({
        channelId: message.channel,
        threadTs: message.thread_ts,
        userMessage: message.text,
        say,
      });
    });

    console.log("✅ Slack app initialized (socket mode)");
  }
  return _app;
}

export async function startSlack(): Promise<void> {
  const app = getSlackApp();
  await app.start();
  console.log("⚡ Slack bot is running");
}
