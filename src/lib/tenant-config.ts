import * as fs from "fs";
import * as path from "path";
import type { TenantConfig } from "../types";

const TENANTS_DIR = path.resolve(__dirname, "../../tenants");

// Cache: slug → config
const configCache = new Map<string, TenantConfig>();
// Cache: email → slug
const emailToSlug = new Map<string, string>();
// Cache: slug → md files
const mdCache = new Map<string, Map<string, string>>();

/**
 * Load all tenant configs from disk on startup.
 */
export function loadAllTenants(): void {
  configCache.clear();
  emailToSlug.clear();
  mdCache.clear();

  if (!fs.existsSync(TENANTS_DIR)) {
    console.warn(`⚠️  Tenants directory not found: ${TENANTS_DIR}`);
    return;
  }

  const slugs = fs.readdirSync(TENANTS_DIR).filter((f) => {
    return fs.statSync(path.join(TENANTS_DIR, f)).isDirectory();
  });

  for (const slug of slugs) {
    const configPath = path.join(TENANTS_DIR, slug, "config.json");
    if (!fs.existsSync(configPath)) {
      console.warn(`⚠️  No config.json for tenant: ${slug}`);
      continue;
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const config: TenantConfig = JSON.parse(raw);
    config.slug = slug;
    configCache.set(slug, config);

    for (const email of config.organizer_emails) {
      emailToSlug.set(email.toLowerCase(), slug);
    }

    // Load all .md files recursively
    const mdFiles = new Map<string, string>();
    loadMdFiles(path.join(TENANTS_DIR, slug), slug, mdFiles);
    mdCache.set(slug, mdFiles);

    console.log(`✅ Loaded tenant: ${slug} (${config.organizer_emails.length} emails, ${mdFiles.size} config files)`);
  }
}

function loadMdFiles(dir: string, tenantSlug: string, result: Map<string, string>, prefix = ""): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      loadMdFiles(path.join(dir, entry.name), tenantSlug, result, rel);
    } else if (entry.name.endsWith(".md")) {
      result.set(rel, fs.readFileSync(path.join(dir, entry.name), "utf-8"));
    }
  }
}

/**
 * Resolve tenant from organizer email.
 */
export function resolveTenantByEmail(email: string): TenantConfig | null {
  const slug = emailToSlug.get(email.toLowerCase());
  if (!slug) return null;
  return configCache.get(slug) ?? null;
}

/**
 * Get tenant config by slug.
 */
export function getTenantConfig(slug: string): TenantConfig | null {
  return configCache.get(slug) ?? null;
}

/**
 * Get all .md config files for a tenant, concatenated by category.
 * Returns a map like: { "services": "...all service md...", "pricing": "...", ... }
 */
export function getTenantContext(slug: string): Record<string, string> {
  const files = mdCache.get(slug);
  if (!files) return {};

  const context: Record<string, string> = {};
  for (const [filePath, content] of files) {
    // Group by top-level directory: "services/cold-email.md" → "services"
    const category = filePath.includes("/") ? filePath.split("/")[0] : "root";
    if (!context[category]) {
      context[category] = "";
    }
    context[category] += `\n\n--- ${filePath} ---\n${content}`;
  }
  return context;
}

/**
 * Get a specific .md file for a tenant.
 */
export function getTenantFile(slug: string, filePath: string): string | null {
  return mdCache.get(slug)?.get(filePath) ?? null;
}
