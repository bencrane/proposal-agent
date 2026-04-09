# Proposal Agent

AI-powered proposal generation agent that listens for completed sales calls, processes transcripts, and generates personalized proposals.

## Architecture

```
Cal.com (MEETING_ENDED webhook)
    → Proposal Agent (this service)
        → Polls Granola for transcript
        → LLM extracts intelligence from call
        → LLM generates 11-section proposal
        → Writes to Service-Engine-X (system of record)
        → Notifies on Slack
        → Handles refinement via Slack thread
    → outboundsolutions.com/p/{id} (frontend renders from Service-Engine-X API)
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` and fill in your values. In production, these come from Doppler via `DOPPLER_TOKEN` on Railway.

### 3. Run the migration
Execute `migrations/001_proposal_agent_jobs.sql` against your Supabase instance.

### 4. Configure your tenant
Edit `tenants/outboundsolutions/config.json`:
- Set `org_id` to your Service-Engine-X organization UUID
- Set `organizer_emails` to the email(s) you use on Cal.com
- Set `slack_channel_id` to the Slack channel for proposal notifications

### 5. Run locally
```bash
npm run dev
```

### 6. Deploy to Railway
```bash
railway up
```

## Tenant Config Structure

```
tenants/outboundsolutions/
├── config.json              # Tenant identity + org mapping
├── services/
│   ├── cold-email.md        # Primary capability
│   ├── cold-calling.md      # Supporting capability
│   ├── direct-mail.md       # Supplementary
│   └── inbound-ivr.md       # IVR capability
├── pricing/
│   └── models.md            # Pricing models + buyer-type signals
├── proposal-template/
│   ├── structure.md          # 11-section structure
│   ├── tone.md               # Voice & formatting guide
│   ├── our-approach.md       # Static section content
│   ├── engagement.md         # Build/Launch/Optimize phases
│   └── your-role.md          # Client responsibilities
└── verticals/
    ├── default.md             # Generic B2B context
    └── spirits-cpg.md         # Spirits/CPG vertical
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/calcom` | Cal.com webhook receiver |
| GET | `/proposals/jobs` | List proposal jobs |
| GET | `/proposals/jobs/:id` | Get a specific job |
| POST | `/proposals/jobs` | Manually create a job (testing) |
| POST | `/proposals/jobs/:id/trigger` | Manually trigger with a Granola note ID |
| GET | `/health` | Health check |

## Slack Refinement

When a proposal draft is ready, the agent posts to your configured Slack channel. Reply in the thread to refine:

- "change pricing to $500 pilot then $25K for 500 samples"
- "remove direct mail from the approach"
- "make the assessment section more aggressive"
- "looks good, send it" → finalizes the proposal

## Adding a New Tenant

1. Create `tenants/{slug}/config.json` with org details
2. Add service `.md` files relevant to that tenant
3. Add pricing and proposal template files
4. Restart the service (configs load on boot)

## Future Sub-Agents (Extension Points)

- **Research Agent** (Exa) → enriches The Opportunity + The Assessment sections
- **Prospecting Agent** (Prospeo / internal DB) → populates The Market section with real TAM preview
- **Landing Page Agent** → auto-generates landing page content for The Offer section
