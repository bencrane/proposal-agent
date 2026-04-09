import * as granola from "../integrations/granola";
import * as serviceEngine from "../integrations/service-engine";
import * as proposalJobService from "../services/proposal-job";
import { processTranscript } from "./transcript-processor";
import { assembleProposal } from "./proposal-assembler";
import { notifyProposalReady } from "../slack/handlers/proposal-notify";
import { getTenantConfig } from "../lib/tenant-config";
import type { ProposalJob, GranolaNote } from "../types";

/**
 * Main orchestrator — coordinates the full pipeline:
 * Cal.com event → Granola transcript → LLM processing → Service-Engine-X → Slack
 *
 * NOTE: Account/Contact creation is NOT handled here.
 * That happens upstream at Cal.com booking time (separate service).
 * By the time a call ends, the account should already exist in Service-Engine-X.
 * We link to it via account_id if available, but don't create it.
 */

/**
 * Step 1: Called when Cal.com webhook fires MEETING_ENDED.
 * Creates a job and starts polling for the transcript.
 */
export async function handleMeetingEnded(opts: {
  calEventId: string;
  meetingTitle: string;
  meetingStart: string;
  meetingEnd: string;
  organizerEmail: string;
  attendeeEmails: string[];
  tenantSlug: string;
  orgId: string;
  accountId?: string; // Passed from Cal.com booking metadata if available
}): Promise<ProposalJob> {
  console.log(`🎯 Meeting ended: "${opts.meetingTitle}" — creating job`);

  const job = await proposalJobService.createJob({
    org_id: opts.orgId,
    tenant_slug: opts.tenantSlug,
    cal_event_id: opts.calEventId,
    meeting_title: opts.meetingTitle,
    meeting_start: opts.meetingStart,
    meeting_end: opts.meetingEnd,
    organizer_email: opts.organizerEmail,
    attendee_emails: opts.attendeeEmails,
  });

  console.log(`✅ Job created: ${job.id} — will poll for transcript`);

  // Start async transcript fetch (don't await — let it run in background)
  pollForTranscript(job.id).catch((err) => {
    console.error(`❌ Transcript poll failed for job ${job.id}:`, err);
  });

  return job;
}

/**
 * Step 2: Poll Granola for the transcript.
 * Granola may take a few minutes to process after the meeting ends.
 */
async function pollForTranscript(jobId: string, attempt = 0): Promise<void> {
  const MAX_ATTEMPTS = 10;
  const POLL_INTERVAL_MS = 60_000; // 1 minute between polls

  const job = await proposalJobService.getJob(jobId);
  if (!job || job.status !== "pending_transcript") return;

  console.log(`🔍 Polling Granola for job ${jobId} (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);

  await proposalJobService.updateJob(jobId, { status: "fetching_transcript" });

  try {
    const note = await granola.findNoteForMeeting({
      meetingStart: job.meeting_start!,
      meetingEnd: job.meeting_end!,
      attendeeEmails: job.attendee_emails,
    });

    if (note) {
      console.log(`✅ Found Granola note: ${note.id} — "${note.title}"`);
      await onTranscriptReady(jobId, note);
      return;
    }
  } catch (err) {
    console.warn(`⚠️  Granola poll error (attempt ${attempt + 1}):`, err);
  }

  // Not found yet — retry
  if (attempt < MAX_ATTEMPTS - 1) {
    await proposalJobService.updateJob(jobId, { status: "pending_transcript" });
    setTimeout(() => pollForTranscript(jobId, attempt + 1), POLL_INTERVAL_MS);
  } else {
    console.error(`❌ Max poll attempts reached for job ${jobId}`);
    await proposalJobService.updateJob(jobId, { status: "error" });
  }
}

/**
 * Step 3: Transcript is ready — process it and generate proposal.
 */
async function onTranscriptReady(jobId: string, note: GranolaNote): Promise<void> {
  await proposalJobService.updateJob(jobId, {
    status: "processing",
    granola_note_id: note.id,
    transcript_raw: note.transcript,
    summary_markdown: note.summary_markdown,
  });

  const job = (await proposalJobService.getJob(jobId))!;
  const tenant = getTenantConfig(job.tenant_slug);
  if (!tenant) throw new Error(`Tenant not found: ${job.tenant_slug}`);

  console.log(`🧠 Processing transcript for job ${jobId}...`);

  // --- Extract intelligence from transcript ---
  const intel = await processTranscript(note);
  console.log(`📊 Intel extracted: ${intel.lead_company} — enthusiasm: ${intel.enthusiasm_level}`);

  await proposalJobService.updateJob(jobId, {
    lead_name: intel.lead_name,
    lead_email: intel.lead_email,
    lead_company: intel.lead_company,
  });

  // --- Generate proposal ---
  console.log(`📝 Assembling proposal for ${intel.lead_company}...`);
  const { sections, pricing } = await assembleProposal({
    tenantSlug: job.tenant_slug,
    intel,
  });

  // --- Create proposal in Service-Engine-X (Draft) ---
  let serviceEngineProposalId: string | undefined;
  let proposalPublicId: string | undefined;

  try {
    const names = (intel.lead_name || "").split(" ");
    const result = await serviceEngine.createProposal({
      org_id: tenant.org_id,
      title: `Outbound Partnership Proposal — ${intel.lead_company || "New Prospect"}`,
      sections,
      pricing,
      // Link to existing account if the Cal.com booking flow already created one.
      // The account_id can come from Cal.com event metadata or be looked up by attendee email.
      account_id: job.cal_event_id ? undefined : undefined, // TODO: resolve from booking metadata
      client_email: intel.lead_email || undefined,
      client_name_f: names[0] || undefined,
      client_name_l: names.slice(1).join(" ") || undefined,
      client_company: intel.lead_company || undefined,
    });

    serviceEngineProposalId = result.id;
    proposalPublicId = result.public_id;
    console.log(`📄 Proposal created in Service-Engine-X: ${result.id} (public: ${result.public_id})`);
  } catch (err) {
    console.error(`❌ Failed to create proposal in Service-Engine-X:`, err);
    // Continue — we still have the draft in our job table and can retry
  }

  // --- Update job with generated content ---
  await proposalJobService.updateJob(jobId, {
    status: "draft_ready",
    sections,
    service_engine_proposal_id: serviceEngineProposalId || null,
    proposal_public_id: proposalPublicId || null,
  });

  // --- Notify on Slack ---
  try {
    await notifyProposalReady(jobId);
    console.log(`💬 Slack notification sent for job ${jobId}`);
  } catch (err) {
    console.warn(`⚠️  Slack notification failed:`, err);
  }

  console.log(`✅ Pipeline complete for job ${jobId}`);
}

/**
 * Manual trigger: run the pipeline for an existing job with a specific Granola note.
 * Useful for testing or when the automatic poll doesn't find the note.
 */
export async function triggerWithNote(jobId: string, noteId: string): Promise<void> {
  const note = await granola.getNote(noteId);
  await onTranscriptReady(jobId, note);
}
