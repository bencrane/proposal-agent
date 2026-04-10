# Railway + Doppler + Docker Deployment Guide

Canonical reference for deploying services to Railway using Doppler for secrets and Docker for builds. Based on a real production incident with `proposal-agent` and the working pattern established by `paid-engine-x-api`.

---

## The Incident: What Went Wrong

`proposal-agent` deployed to Railway but failed health checks on every deploy. The app booted successfully, Doppler injected secrets, Fastify started, all integrations loaded. But Railway kept killing the container.

### Root cause: Doppler was overriding Railway's PORT

Railway assigns a port to every service and routes traffic to it. It sets `PORT` in the container environment so the app knows where to listen. The problem: Doppler also had `PORT=3100` and `NODE_ENV=development` as secrets.

The `doppler run --` wrapper **replaces** environment variables with Doppler's values before starting the app. So Railway would set `PORT=<railway-assigned>`, then Doppler would overwrite it with `PORT=3100`. The app would bind to 3100. Railway would send health checks to its own assigned port. Nothing listening. Health check fails. Container killed.

The app logs looked completely healthy — that's what made this hard to diagnose:

```
Server listening at http://0.0.0.0:3100
✅ Ready: supabase, service_engine, openai, granola, calcom
```

Everything was "fine" except Railway couldn't reach the app.

### Secondary issues

1. **Health check timeout was 5 seconds.** If Doppler secret fetch or tenant loading took a beat, Railway would kill the container before it even started.
2. **Health check path was `/health`** which called `getReadiness()` and built an integration status report. Unnecessary work for a liveness probe.
3. **No `.dockerignore`** so `node_modules/`, `.env`, `.git/` were all copied into the Docker build context, bloating images and slowing builds.

### What was fixed

1. **Removed `PORT` and `NODE_ENV` from Doppler.** These are platform-managed variables, not application secrets.
2. **Changed health check path to `/health/live`** — a minimal liveness probe that returns `{ status: "live" }`.
3. **Increased health check timeout from 5s to 30s** to match the working `paid-engine-x-api` pattern.
4. **Added `.dockerignore`** to exclude `node_modules`, `dist`, `.env`, `.git`, and markdown files.

---

## The Rule

**Doppler is for application secrets. Railway is for platform configuration. Never put platform variables in Doppler.**

### What goes in Doppler

- API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GRANOLA_API_KEY`)
- Database credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLICKHOUSE_PASSWORD`)
- Service-to-service auth tokens (`SERVICE_ENGINE_INTERNAL_KEY`, `SLACK_BOT_TOKEN`)
- OAuth secrets (`LINKEDIN_CLIENT_SECRET`, `META_APP_SECRET`)
- Webhook secrets (`CALCOM_WEBHOOK_SECRET`)
- Application-level config that varies by environment (`LOG_LEVEL`, `CORS_ORIGINS`, `RATE_LIMIT_RPM`)

### What does NOT go in Doppler

- `PORT` — Railway sets this. Doppler will override it and break routing.
- `NODE_ENV` / `ENV` — Set in Railway service settings if needed, not Doppler.
- `RAILWAY_*` — Any Railway-injected variable.
- `HOST` / `HOSTNAME` — Platform-managed.

---

## Reference Architecture

### Dockerfile (Node/TypeScript)

```dockerfile
FROM node:22-slim

# Install Doppler CLI
RUN apt-get update && apt-get install -y apt-transport-https ca-certificates curl gnupg && \
    curl -sLf --retry 3 --tlsv1.2 --proto "=https" \
      'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | \
      gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" | \
      tee /etc/apt/sources.list.d/doppler-cli.list && \
    apt-get update && apt-get install -y doppler && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["doppler", "run", "--", "node", "dist/index.js"]
```

### Dockerfile (Python/FastAPI)

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    apt-transport-https ca-certificates curl gnupg \
    && curl -sLf --retry 3 --tlsv1.2 --proto "=https" \
       'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | \
       gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" > \
       /etc/apt/sources.list.d/doppler-cli.list \
    && apt-get update && apt-get install -y doppler \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY . .

EXPOSE 8080

CMD ["doppler", "run", "--", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

Note: Python projects can hardcode the port in the CMD since uvicorn takes `--port` as a flag. Node projects should read `process.env.PORT` (which Railway sets) with a sensible default for local dev.

### railway.toml

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
healthcheckPath = "/health/live"
healthcheckTimeout = 30
```

- **Always use `/health/live`** for the health check — a minimal liveness probe, not a full status report.
- **Always set timeout to 30 seconds.** Doppler secret fetch + app initialization can take time. 5 seconds is not enough.
- **Always set restart policy** with a retry cap to avoid infinite restart loops.

### .dockerignore

```
node_modules
dist
.env
.env.*
.git
.gitignore
*.md
```

Every project must have this. Without it, Docker copies everything (including `node_modules/`, `.env` with local secrets, and `.git/` history) into the build context.

### Health check endpoints

Every service should expose three endpoints:

```
GET /health/live  → { status: "live" }           # Railway liveness probe. Fast. No dependencies.
GET /health/ready → { status: "ready" }           # Readiness check. Can test DB connectivity.
GET /health       → { status: "ok", ... }         # Full status report for debugging/monitoring.
```

Railway should point at `/health/live`. The other endpoints are for operators and dashboards.

### Railway service variables

Set exactly one variable in Railway's service environment:

```
DOPPLER_TOKEN = dp.st.prd.xxxxx
```

This is the Doppler service token for the production config. Everything else comes through Doppler at runtime via `doppler run --`.

### Doppler project setup

- **Project name:** matches the repo name (e.g., `proposal-agent`, `paid-engine-x-api`)
- **Environments:** `dev`, `stg`, `prd`
- **Never store:** `PORT`, `NODE_ENV`, `HOST`, or any Railway-managed variable

---

## New Project Checklist

1. Create Doppler project with `dev`, `stg`, `prd` configs
2. Add application secrets to Doppler (API keys, DB credentials, auth tokens)
3. Verify `PORT`, `NODE_ENV`, `HOST` are NOT in Doppler
4. Create `Dockerfile` with Doppler CLI installed and `doppler run --` in CMD
5. Create `.dockerignore` excluding `node_modules`, `dist`, `.env`, `.git`
6. Create `railway.toml` with `/health/live` health check and 30s timeout
7. Implement `/health/live`, `/health/ready`, and `/health` endpoints
8. In Railway, set `DOPPLER_TOKEN` as the only service variable
9. Deploy and verify health checks pass in Railway logs

---

## Debugging Railway Deploy Failures

If a deploy fails after the app appears to start successfully:

1. **Check the port.** Look for `Server listening at http://...:<port>` in logs. If it's not Railway's expected port, Doppler is probably overriding `PORT`.
2. **Check Doppler secrets.** Run `doppler secrets --project <name> --config prd` and verify `PORT`, `NODE_ENV`, `HOST` are not listed.
3. **Check the health check path.** Make sure `railway.toml` points to an endpoint that exists and responds fast.
4. **Check the timeout.** If the app takes more than the configured `healthcheckTimeout` to boot, Railway kills it. 30 seconds is the safe default.
5. **Check `.dockerignore`.** Missing it means slow builds and bloated images, which can cause build timeouts.
