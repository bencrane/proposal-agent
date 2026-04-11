# Proposal Agent v1 (Calgary) -- How It Works

## What Is This?

An AI-powered backend service that **automatically generates personalized sales proposals after calls end**. The system listens for Cal.com webhook events (`MEETING_ENDED`), fetches the call transcript from Granola, analyzes it with GPT-4o, generates an 11-section proposal, and posts it to Slack for human refinement.

**Core value:** eliminates manual proposal writing. A salesperson finishes a call, and within minutes a tailored, multi-section proposal draft appears in Slack ready for review and refinement via natural language.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript |
| HTTP Server | Fastify 5 |
| Real-time Messaging | Slack Bolt (socket mode) |
| Database | Supabase (PostgreSQL) |
| LLM | OpenAI GPT-4o (JSON mode) |
| Transcription | Granola API |
| Proposal Storage | Service-Engine-X (internal API) |
| Secrets | Doppler CLI |
| Hosting | Railway (Docker) |
| IDs | nanoid (12 chars) |
| Validation | Zod |

---

## Directory Structure

```
calgary/
├── src/
│   ├── index.ts                       # App entrypoint
│   ├── agents/
│   │   ├── orchestrator.ts            # Main pipeline coordinator
│   │   ├── transcript-processor.ts    # Extracts sales intel from transcript
│   │   ├── proposal-assembler.ts      # Generates 11-section proposal
│   │   └── refinement.ts             # Handles edits via Slack chat
│   ├── config/
│   │   └── env.ts                     # Zod-based env var validation
│   ├── integrations/
│   │   ├── granola.ts                 # Granola API client
│   │   └── service-engine.ts          # Service-Engine-X API client
│   ├── lib/
│   │   ├── openai.ts                  # OpenAI client singleton
│   │   ├── supabase.ts                # Supabase client singleton
│   │   └── tenant-config.ts           # Tenant loading + caching
│   ├── routes/
│   │   ├── health.ts                  # Health check endpoints
│   │   ├── proposals.ts              # Proposal job admin/debug API
│   │   └── webhooks/
│   │       └── calcom.ts             # Cal.com webhook receiver
│   ├── services/
│   │   └── proposal-job.ts           # Database CRUD (Supabase)
│   ├── slack/
│   │   ├── app.ts                     # Slack app init (socket mode)
│   │   └── handlers/
│   │       ├── proposal-notify.ts     # Posts draft to Slack
│   │       └── refinement.ts         # Handles thread replies
│   └── types/
│       └── index.ts                   # TypeScript interfaces
├── tenants/
│   └── outboundsolutions/
│       ├── config.json                # Tenant identity + org mapping
│       ├── services/                  # Service description markdown files
│       ├── pricing/
│       │   └── models.md             # Pricing strategy definitions
│       ├── proposal-template/
│       │   ├── structure.md           # 11-section structure guide
│       │   ├── tone.md                # Voice & tone guide
│       │   ├── our-approach.md        # Static section template
│       │   ├── engagement.md          # Build/Launch/Optimize phases
│       │   └── your-role.md           # Client responsibilities
│       └── verticals/
│           ├── default.md             # Generic B2B context
│           └── spirits-cpg.md         # CPG/spirits vertical
├── migrations/
│   └── 001_proposal_agent_jobs.sql    # Database schema
├── Dockerfile
├── railway.toml
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Application Startup

When `node dist/index.js` runs (via Doppler):

1. **Env validation** -- Zod schema validates all environment variables. Missing required vars = process exit.
2. **Tenant loading** -- Reads all `tenants/{slug}/config.json` from disk. Caches tenant configs in memory by slug and by organizer email.
3. **Fastify HTTP server** -- Registers routes (health, webhooks, proposals API). Binds to `0.0.0.0:3100`.
4. **Slack bot** (optional) -- If `SLACK_ENABLE_SOCKET_MODE=true` and credentials present, connects via socket mode and registers the thread reply handler.
5. **Startup banner** -- Logs which integrations are active vs. missing.

---

## The Main Pipeline

This is the core workflow, orchestrated by `src/agents/orchestrator.ts`:

```
Cal.com Webhook (MEETING_ENDED)
       │
       ▼
┌─────────────────────────────────┐
│  1. Create Job                  │
│     status: pending_transcript  │
│     Resolve tenant by email     │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  2. Poll Granola for Transcript │
│     Up to 10 attempts, 60s gap │
│     Match by date + attendees   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  3. Transcript Processor        │
│     GPT-4o extracts:            │
│     - Lead name/email/company   │
│     - Pain points               │
│     - Budget signals            │
│     - Services discussed        │
│     - Enthusiasm level          │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  4. Proposal Assembler          │
│     GPT-4o generates:           │
│     - 11-section proposal       │
│     - Pricing config            │
│     Uses tenant context (svc    │
│     docs, pricing models,       │
│     templates, vertical data)   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  5. Create in Service-Engine-X  │
│     POST /api/internal/proposals│
│     Gets proposal_id + public_id│
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  6. Notify Slack                │
│     Post to tenant channel      │
│     Show exec summary preview   │
│     Show pricing suggestion     │
│     Store thread_ts for replies │
└──────────────┬──────────────────┘
               │
               ▼
       Job status: in_review
       (awaiting Slack refinement)
```

### Step-by-Step Detail

**Step 1 -- Webhook received.** `POST /webhooks/calcom` receives the event. The organizer's email is used to look up the tenant. A job row is created in Supabase with all meeting metadata.

**Step 2 -- Transcript polling.** Granola needs time to process the recording. The system polls `GET /v1/notes` every 60 seconds (up to 10 attempts), filtering by date range and matching attendees. When found, the full transcript is fetched via `GET /v1/notes/{id}?include=transcript`.

**Step 3 -- Intelligence extraction.** The raw transcript (speaker + text + timestamps) is sent to GPT-4o with a structured JSON schema. The model returns sales-relevant intel: who the lead is, what they care about, what services they asked about, how enthusiastic they seemed, and any budget signals.

**Step 4 -- Proposal generation.** The extracted intel, plus all tenant context files (service descriptions, pricing models, proposal templates, vertical-specific knowledge), are assembled into a prompt. GPT-4o generates a complete 11-section proposal in markdown, plus a pricing configuration object.

**Step 5 -- System of record.** The proposal is created in Service-Engine-X as a draft, which assigns a `public_id` for the shareable link (e.g., `outboundsolutions.com/p/{public_id}`).

**Step 6 -- Slack notification.** A formatted message with the executive summary, suggested pricing, and a link to the full proposal is posted to the tenant's configured Slack channel. The thread timestamp is stored so the system can listen for refinement requests.

---

## Refinement Loop (Slack Thread)

After the draft is posted, the salesperson can refine it by replying in the Slack thread with natural language:

```
Slack Thread Reply
("change pricing to $500 pilot then $25K for 500 samples")
       │
       ▼
┌─────────────────────────────────┐
│  1. Message Handler             │
│     Match thread_ts to job      │
│     Load current proposal state │
│     Load refinement history     │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  2. Refinement Agent (GPT-4o)   │
│     Input: current sections +   │
│     conversation history + msg  │
│     Output:                     │
│     - action: update | finalize │
│     - updated_sections: {...}   │
│     - explanation: "Changed..." │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  3. Apply Changes               │
│     Merge updated sections      │
│     Append to refinement_history│
│     Sync to Service-Engine-X    │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  4. Reply in Slack Thread       │
│     Show what changed           │
│     Link to updated proposal    │
│     "Reply with more changes    │
│      or say 'looks good'"       │
└─────────────────────────────────┘
```

When the user says "looks good" or "send it", the refinement agent detects the finalize intent, marks the job as `finalized`, and offers to email the proposal to the prospect via Service-Engine-X.

---

## The 11-Section Proposal Structure

Every generated proposal follows this structure, defined in `tenants/{slug}/proposal-template/structure.md`:

| # | Section | Content |
|---|---------|---------|
| 1 | **Executive Summary** | 2-3 sentences. What, for whom, goal. |
| 2 | **The Opportunity** | Why now. Momentum signals. Constraints they're hitting. |
| 3 | **The Assessment** | Their current approach. Why it's inefficient. Cost of status quo. |
| 4 | **Our Approach** | Mostly static. Engineering firm, measurable, tunable. |
| 5 | **The Market** | TAM preview. Real leads we'd target. (Placeholder for prospecting agent.) |
| 6 | **The Offer** | What the campaign looks like. What the prospect experiences. |
| 7 | **The Math** | Projected numbers (volume, rates, revenue, ROI). Illustrative. |
| 8 | **The Engagement** | Build (weeks 1-3) -> Launch (ongoing) -> Optimize (continuous). |
| 9 | **Pricing & Terms** | Clear structure. One-time + ongoing (or per-outcome). Total. |
| 10 | **Your Role** | What client does. Meetings, samples, responses, inventory. |
| 11 | **Next Steps** | Signature block + payment instructions. |

---

## Pricing Models

The assembler picks a pricing model based on transcript signals (budget sensitivity, industry norms, buyer skepticism). Defined in `tenants/{slug}/pricing/models.md`:

| Model | Structure | Best For |
|-------|-----------|----------|
| `setup_plus_performance` | Setup fee + per outcome (e.g., $3K + $200/meeting) | Performance-oriented buyers |
| `setup_plus_monthly` | Setup fee + monthly retainer (e.g., $5K/mo) | Staffing, recruiting |
| `flat_project` | One-time fixed fee (e.g., $27.5K for 90-day campaign) | Enterprise, large deals |
| `pilot_to_contract` | Low/free pilot -> larger commitment | Skeptical buyers, new verticals |
| `custom` | Anything non-standard | Edge cases |

---

## Multi-Tenant Architecture

The system supports multiple tenants (companies using the service). Each tenant has:

- `tenants/{slug}/config.json` -- Identity, org mapping, Slack channel, organizer emails
- `tenants/{slug}/services/` -- Markdown files describing each service offering
- `tenants/{slug}/pricing/` -- Pricing strategy documentation
- `tenants/{slug}/proposal-template/` -- Section structure, tone guide, static sections
- `tenants/{slug}/verticals/` -- Industry-specific context

**Tenant resolution:** When a Cal.com webhook arrives, the organizer's email is matched against `organizer_emails` in each tenant's `config.json`. This determines which tenant's context files to inject into the LLM prompts.

Currently deployed: **Outbound Solutions** (`outboundsolutions`).

---

## Database Schema

Single table: `proposal_agent_jobs` (Supabase PostgreSQL).

Tracks the full lifecycle of one proposal from call to delivery.

### Columns

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | nanoid (12 chars) |
| `org_id` | UUID | Service-Engine-X org reference |
| `tenant_slug` | TEXT | Tenant identifier |
| `status` | TEXT | Lifecycle state (see below) |
| `cal_event_id` | TEXT | Cal.com event UID |
| `meeting_title` | TEXT | Call title |
| `meeting_start` / `meeting_end` | TIMESTAMPTZ | Call timestamps |
| `organizer_email` | TEXT | Used for tenant resolution |
| `attendee_emails` | JSONB | Array of attendee emails |
| `granola_note_id` | TEXT | Granola note reference |
| `transcript_raw` | JSONB | Raw transcript (speaker, text, timestamps) |
| `summary_markdown` | TEXT | Granola's auto-summary |
| `lead_name` / `lead_email` / `lead_company` | TEXT | Extracted from transcript |
| `sections` | JSONB | Full 11-section proposal object |
| `service_engine_proposal_id` | UUID | Service-Engine-X reference |
| `proposal_public_id` | TEXT | Public slug for shareable link |
| `slack_channel_id` | TEXT | Where draft was posted |
| `slack_thread_ts` | TEXT | Thread ID for refinement replies |
| `refinement_history` | JSONB | Array of {role, content, timestamp} |
| `created_at` / `updated_at` | TIMESTAMPTZ | Timestamps |

### Job Status Lifecycle

```
pending_transcript -> fetching_transcript -> processing -> draft_ready -> in_review -> finalized
                                                                                    \-> error
```

### Indexes

- `idx_paj_status` -- Filter by status
- `idx_paj_org_id` -- Filter by org
- `idx_paj_slack_thread` -- Look up job by (channel, thread_ts)
- `idx_paj_created` -- Sort by creation date

---

## External Integrations

### Cal.com (Trigger)
- **Event:** `MEETING_ENDED` or `BOOKING_CREATED` webhook
- **Data:** Event UID, meeting times, organizer + attendees (name, email)
- **Auth:** Webhook secret (basic verification)

### Granola (Transcription)
- **Purpose:** Fetch call transcripts + auto-generated summaries
- **Endpoints:** `GET /v1/notes` (list), `GET /v1/notes/{id}?include=transcript` (detail)
- **Auth:** Bearer token
- **Pattern:** Poll after webhook, retry up to 10x at 60s intervals

### OpenAI GPT-4o (Intelligence)
- **Purpose:** All LLM-powered analysis and generation
- **Uses:** Transcript processing, proposal assembly, refinement
- **Mode:** JSON response format enforced

### Service-Engine-X (Proposal System of Record)
- **Purpose:** Store proposals, manage public links, handle email delivery
- **Endpoints:** `POST/PUT /api/internal/proposals`, `POST .../send`
- **Auth:** `X-Internal-Key` header

### Slack (Notifications + Refinement)
- **Mode:** Socket mode (real-time, no public HTTP callback needed)
- **Operations:** `chat.postMessage` (post draft), message handler (thread replies)
- **Auth:** Bot token + app token + signing secret

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Full status check (all integrations) |
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe |
| `POST` | `/webhooks/calcom` | Cal.com webhook receiver |
| `GET` | `/proposals/jobs` | List jobs (filterable by status) |
| `GET` | `/proposals/jobs/:jobId` | Get specific job |
| `POST` | `/proposals/jobs` | Create job manually (testing) |
| `POST` | `/proposals/jobs/:jobId/trigger` | Manual trigger with Granola note ID |

---

## Environment Variables

### Required (Production)

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SERVICE_ENGINE_API_URL=https://api.serviceengine.xyz
SERVICE_ENGINE_INTERNAL_KEY=your-internal-api-key
OPENAI_API_KEY=sk-...
GRANOLA_API_KEY=your-granola-api-key
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-...
CALCOM_WEBHOOK_SECRET=your-calcom-webhook-secret
```

### Optional

```bash
PORT=3100
NODE_ENV=development|production|test
LOG_LEVEL=debug|info|warn|error
SLACK_ENABLE_SOCKET_MODE=true|false
```

All production secrets are managed via **Doppler** and injected at runtime.

---

## Deployment

### Docker

```dockerfile
FROM node:22-slim
# Install Doppler CLI for secret injection
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["doppler", "run", "--", "node", "dist/index.js"]
```

### Railway

- `railway.toml` configures the deploy
- `DOPPLER_TOKEN` set in Railway project settings
- Doppler CLI fetches all secrets at container start, injects as env vars
- Deploy via `railway up` or GitHub push

### Health Checks

- `/health/live` returns `{ status: "live" }` -- used for liveness probes
- `/health/ready` returns `{ status: "ready" }` -- used for readiness probes

---

## Error Handling

- **Fail fast on startup:** Missing required env vars cause immediate process exit (Zod validation).
- **Graceful degradation at runtime:** Slack notification failure doesn't block the pipeline. Service-Engine-X failure still preserves the draft in the job table.
- **Job status tracking:** Failed jobs are marked `status: "error"`. Admin can query them via `GET /proposals/jobs?status=error`.
- **Polling retry:** Granola transcript fetch retries up to 10 times (10 minutes total). Exhausted retries = job marked as error.

---

## What's Not Implemented Yet

These are extension points referenced in the code but not yet built:

| Feature | Purpose |
|---------|---------|
| **Research Agent** | Enrich "The Opportunity" + "The Assessment" with Exa web research |
| **Prospecting Agent** | Populate "The Market" section with real TAM + lead lists |
| **Landing Page Agent** | Auto-generate a landing page for "The Offer" |
| **Job Queue** | Replace `setTimeout` polling with Bull/BullMQ |
| **API Auth** | Add authentication to `/proposals/jobs` endpoints |
| **Row-Level Security** | Supabase RLS policies |
| **Test Suite** | Unit, integration, and E2E tests |
| **Scheduled Cleanup** | Prune old/failed jobs on a cron |
