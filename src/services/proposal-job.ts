import { nanoid } from "nanoid";
import { getSupabase } from "../lib/supabase";
import type { ProposalJob, JobStatus, ProposalSections, GranolaTranscriptEntry, RefinementMessage } from "../types";

const TABLE = "proposal_agent_jobs";

/**
 * Create a new proposal generation job.
 */
export async function createJob(opts: {
  org_id: string;
  tenant_slug: string;
  cal_event_id: string;
  meeting_title: string;
  meeting_start: string;
  meeting_end: string;
  organizer_email: string;
  attendee_emails: string[];
}): Promise<ProposalJob> {
  const db = getSupabase();
  const id = nanoid(12);

  const job: Partial<ProposalJob> = {
    id,
    org_id: opts.org_id,
    tenant_slug: opts.tenant_slug,
    status: "pending_transcript",
    cal_event_id: opts.cal_event_id,
    meeting_title: opts.meeting_title,
    meeting_start: opts.meeting_start,
    meeting_end: opts.meeting_end,
    organizer_email: opts.organizer_email,
    attendee_emails: opts.attendee_emails,
    refinement_history: [],
  };

  const { data, error } = await db.from(TABLE).insert(job).select().single();
  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data as ProposalJob;
}

/**
 * Get a job by ID.
 */
export async function getJob(jobId: string): Promise<ProposalJob | null> {
  const db = getSupabase();
  const { data, error } = await db.from(TABLE).select("*").eq("id", jobId).single();
  if (error) return null;
  return data as ProposalJob;
}

/**
 * Get all jobs with a specific status.
 */
export async function getJobsByStatus(status: JobStatus): Promise<ProposalJob[]> {
  const db = getSupabase();
  const { data, error } = await db.from(TABLE).select("*").eq("status", status);
  if (error) throw new Error(`Failed to fetch jobs: ${error.message}`);
  return (data ?? []) as ProposalJob[];
}

/**
 * Update job status and optional fields.
 */
export async function updateJob(
  jobId: string,
  updates: Partial<Pick<ProposalJob,
    | "status"
    | "granola_note_id"
    | "transcript_raw"
    | "summary_markdown"
    | "lead_name"
    | "lead_email"
    | "lead_company"
    | "sections"
    | "service_engine_proposal_id"
    | "proposal_public_id"
    | "slack_channel_id"
    | "slack_thread_ts"
    | "refinement_history"
  >>
): Promise<ProposalJob> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update job ${jobId}: ${error.message}`);
  return data as ProposalJob;
}

/**
 * Add a refinement message to the job history.
 */
export async function addRefinementMessage(
  jobId: string,
  message: RefinementMessage
): Promise<ProposalJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const history = [...(job.refinement_history || []), message];
  return updateJob(jobId, { refinement_history: history });
}

/**
 * Find a job by Slack thread timestamp (for refinement replies).
 */
export async function findJobBySlackThread(
  channelId: string,
  threadTs: string
): Promise<ProposalJob | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("slack_channel_id", channelId)
    .eq("slack_thread_ts", threadTs)
    .single();

  if (error) return null;
  return data as ProposalJob;
}

/**
 * Find jobs awaiting transcripts (for the poller).
 */
export async function getJobsPendingTranscript(): Promise<ProposalJob[]> {
  return getJobsByStatus("pending_transcript");
}
