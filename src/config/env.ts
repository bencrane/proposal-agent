import { z } from "zod";

const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const envSchema = z.object({
  // Supabase (shared with Service-Engine-X)
  SUPABASE_URL: emptyStringToUndefined(z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: emptyStringToUndefined(z.string().min(1).optional()),

  // Service-Engine-X Internal API
  SERVICE_ENGINE_API_URL: emptyStringToUndefined(z.string().url().default("https://api.serviceengine.xyz")),
  SERVICE_ENGINE_INTERNAL_KEY: emptyStringToUndefined(z.string().min(1).optional()),

  // OpenAI
  OPENAI_API_KEY: emptyStringToUndefined(z.string().min(1).optional()),

  // Granola
  GRANOLA_API_KEY: emptyStringToUndefined(z.string().min(1).optional()),

  // Slack
  SLACK_BOT_TOKEN: emptyStringToUndefined(z.string().min(1).optional()),
  SLACK_SIGNING_SECRET: emptyStringToUndefined(z.string().min(1).optional()),
  SLACK_APP_TOKEN: emptyStringToUndefined(z.string().min(1).optional()),
  SLACK_ENABLE_SOCKET_MODE: z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return ["1", "true", "yes", "on"].includes(normalized);
    }
    return false;
  }, z.boolean()),

  // Cal.com
  CALCOM_WEBHOOK_SECRET: emptyStringToUndefined(z.string().min(1).optional()),

  // App
  PORT: emptyStringToUndefined(z.coerce.number().int().min(1).max(65535).default(3100)),
  NODE_ENV: emptyStringToUndefined(z.enum(["development", "production", "test"]).default("development")),
  LOG_LEVEL: emptyStringToUndefined(z.enum(["debug", "info", "warn", "error"]).default("info")),
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
    slack: !!(
      env.SLACK_ENABLE_SOCKET_MODE &&
      env.SLACK_BOT_TOKEN &&
      env.SLACK_SIGNING_SECRET &&
      env.SLACK_APP_TOKEN
    ),
    calcom: !!(env.CALCOM_WEBHOOK_SECRET),
  };

  const ready = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { ready, missing };
}
