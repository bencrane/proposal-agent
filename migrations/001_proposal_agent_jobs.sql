-- Proposal Agent Jobs table
-- Lives in the same Supabase instance as Service-Engine-X
-- Tracks the lifecycle of AI-generated proposals

CREATE TABLE IF NOT EXISTS proposal_agent_jobs (
  id              TEXT PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organizations(id),
  tenant_slug     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_transcript'
                  CHECK (status IN (
                    'pending_transcript', 'fetching_transcript', 'processing',
                    'draft_ready', 'in_review', 'finalized', 'error'
                  )),

  -- Cal.com event data
  cal_event_id    TEXT,
  meeting_title   TEXT,
  meeting_start   TIMESTAMPTZ,
  meeting_end     TIMESTAMPTZ,
  organizer_email TEXT,
  attendee_emails JSONB DEFAULT '[]',

  -- Granola data
  granola_note_id   TEXT,
  transcript_raw    JSONB,
  summary_markdown  TEXT,

  -- Lead info (extracted by transcript processor)
  lead_name     TEXT,
  lead_email    TEXT,
  lead_company  TEXT,

  -- Generated proposal content (the 11 sections)
  sections      JSONB,

  -- Link to Service-Engine-X proposal
  service_engine_proposal_id UUID,
  proposal_public_id         TEXT,

  -- Slack thread for refinement
  slack_channel_id TEXT,
  slack_thread_ts  TEXT,

  -- Chat refinement history
  refinement_history JSONB DEFAULT '[]',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_paj_status ON proposal_agent_jobs(status);
CREATE INDEX IF NOT EXISTS idx_paj_org_id ON proposal_agent_jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_paj_slack_thread ON proposal_agent_jobs(slack_channel_id, slack_thread_ts);
CREATE INDEX IF NOT EXISTS idx_paj_created ON proposal_agent_jobs(created_at DESC);
