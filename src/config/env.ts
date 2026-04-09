import { z } from "zod";

const envSchema = z.object({
  // Supabase (shared with Service-Engine-X)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Service-Engine-X Internal API
  SERVICE_ENGINE_API_URL: z.string().url().default("https://api.serviceengine.xyz"),
  SERVICE_ENGINE_INTERNAL_KEY: z.string().min(1).optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1).optional(),

  // Granola
  GRANOLA_API_KEY: z.string().min(1).optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  SLACK_APP_TOKEN: z.string().min(1).optional(),

  // Cal.com
  CALCOM_WEBHOOK_SECRET: z.string().min(1).optional(),

  // App
  PORT: z.coerce.number().default(3100),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error("❌ Invalid environment variables:");
      for (const issue of result.error.issues) {
        console.error(`   ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}

export function getReadiness(): { ready: string[]; missing: string[] } {
  const env = getEnv();
  const checks: Record<string, boolean> = {
    supabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    service_engine: !!(env.SERVICE_ENGINE_INTERNAL_KEY),
    openai: !!(env.OPENAI_API_KEY),
    granola: !!(env.GRANOLA_API_KEY),
    slack: !!(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET && env.SLACK_APP_TOKEN),
    calcom: !!(env.CALCOM_WEBHOOK_SECRET),
  };

  const ready = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { ready, missing };
}
