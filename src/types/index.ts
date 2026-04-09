// ---------------------------------------------------------------------------
// Tenant Config
// ---------------------------------------------------------------------------
export interface TenantConfig {
  slug: string;
  name: string;
  org_id: string; // Service-Engine-X org UUID
  organizer_emails: string[]; // emails that map to this tenant
  slack_channel_id: string;
  default_pricing_model: string; // e.g. "setup_plus_performance"
}

// ---------------------------------------------------------------------------
// Proposal Generation Job (stored in Supabase: proposal_agent_jobs)
// ---------------------------------------------------------------------------
export type JobStatus =
  | "pending_transcript"
  | "fetching_transcript"
  | "processing"
  | "draft_ready"
  | "in_review"
  | "finalized"
  | "error";

export interface ProposalJob {
  id: string;
  org_id: string;
  tenant_slug: string;
  status: JobStatus;

  // From Cal.com webhook
  cal_event_id: string | null;
  meeting_title: string | null;
  meeting_start: string | null;
  meeting_end: string | null;
  organizer_email: string | null;
  attendee_emails: string[];

  // From Granola
  granola_note_id: string | null;
  transcript_raw: GranolaTranscriptEntry[] | null;
  summary_markdown: string | null;

  // Lead info (extracted from transcript + cal event)
  lead_name: string | null;
  lead_email: string | null;
  lead_company: string | null;

  // Generated proposal
  sections: ProposalSections | null;
  service_engine_proposal_id: string | null;
  proposal_public_id: string | null;

  // Slack
  slack_channel_id: string | null;
  slack_thread_ts: string | null;

  // Refinement
  refinement_history: RefinementMessage[];

  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Granola API Types
// ---------------------------------------------------------------------------
export interface GranolaNote {
  id: string;
  title: string | null;
  owner: { name: string; email: string };
  created_at: string;
  updated_at: string;
  calendar_event: {
    event_title: string;
    invitees: { email: string }[];
    organiser: string;
    calendar_event_id: string;
    scheduled_start_time: string;
    scheduled_end_time: string;
  };
  attendees: { name: string; email: string }[];
  summary_text: string;
  summary_markdown: string | null;
  transcript: GranolaTranscriptEntry[] | null;
}

export interface GranolaTranscriptEntry {
  speaker: { source: "microphone" | "speaker" };
  text: string;
  start_time: string;
  end_time: string;
}

export interface GranolaListResponse {
  notes: GranolaNote[];
  hasMore: boolean;
  cursor: string | null;
}

// ---------------------------------------------------------------------------
// Proposal Sections (the 11-section structure)
// ---------------------------------------------------------------------------
export interface ProposalSections {
  executive_summary: string; // markdown
  the_opportunity: string;
  the_assessment: string;
  our_approach: string;
  the_market: string; // placeholder until prospecting agent
  the_offer: string;
  the_math: ProposalMath | null;
  the_engagement: string;
  pricing_and_terms: PricingConfig;
  your_role: string;
  next_steps: string;
}

export interface ProposalMath {
  monthly_email_volume: number | null;
  response_rate: number | null;
  close_rate: number | null;
  avg_revenue_per_account: number | null;
  warm_leads: number | null;
  new_accounts: number | null;
  first_year_revenue: number | null;
  cost_per_account: number | null;
  roi_multiple: number | null;
}

export interface PricingConfig {
  model: "setup_plus_monthly" | "setup_plus_performance" | "flat_project" | "pilot_to_contract" | "custom";
  setup_fee: number | null;
  monthly_fee: number | null;
  performance_fee_per_outcome: number | null;
  primary_outcome: string | null; // "booked meeting", "sample requested", "live transfer"
  total: number | null;
  notes: string | null; // free text for custom terms
}

// ---------------------------------------------------------------------------
// Cal.com Webhook Payload (MEETING_ENDED)
// ---------------------------------------------------------------------------
export interface CalcomWebhookPayload {
  triggerEvent: string;
  createdAt: string;
  payload: {
    uid: string;
    title: string;
    startTime: string;
    endTime: string;
    organizer: {
      email: string;
      name: string;
      timeZone: string;
    };
    attendees: {
      email: string;
      name: string;
      timeZone: string;
    }[];
    metadata?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Refinement Chat
// ---------------------------------------------------------------------------
export interface RefinementMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Service-Engine-X API Types
// See SERVICE-ENGINE-CONTRACT.md for the full endpoint spec.
// ---------------------------------------------------------------------------

export interface SEXProposalItem {
  name: string;
  description?: string;
  quantity: number;
  unit_price: number;
  total: number;
}
