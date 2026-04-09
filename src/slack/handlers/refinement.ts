import * as proposalJobService from "../../services/proposal-job";
import * as serviceEngine from "../../integrations/service-engine";
import { processRefinement } from "../../agents/refinement";
import type { ProposalSections } from "../../types";

interface RefinementOpts {
  channelId: string;
  threadTs: string;
  userMessage: string;
  say: (opts: { text: string; thread_ts?: string }) => Promise<unknown>;
}

/**
 * Handles a message in a proposal refinement Slack thread.
 */
export async function handleRefinementMessage(opts: RefinementOpts): Promise<void> {
  const { channelId, threadTs, userMessage, say } = opts;

  // Find the job this thread belongs to
  const job = await proposalJobService.findJobBySlackThread(channelId, threadTs);
  if (!job) return; // Not a proposal thread — ignore

  if (!job.sections) {
    await say({ text: "⚠️ No proposal draft found for this job.", thread_ts: threadTs });
    return;
  }

  // Add user message to history
  await proposalJobService.addRefinementMessage(job.id, {
    role: "user",
    content: userMessage,
    timestamp: new Date().toISOString(),
  });

  await say({ text: "🔄 Working on your changes...", thread_ts: threadTs });

  try {
    const result = await processRefinement({
      job,
      userMessage,
      tenantSlug: job.tenant_slug,
    });

    // --- Finalize flow ---
    if (result.action === "finalize") {
      await proposalJobService.updateJob(job.id, { status: "finalized" });

      const proposalUrl = job.proposal_public_id
        ? `https://www.outboundsolutions.com/p/${job.proposal_public_id}`
        : null;

      await say({
        text: [
          "✅ *Proposal finalized!*",
          proposalUrl ? `\n🔗 ${proposalUrl}` : "",
          "\nReply _\"send it\"_ to email the prospect, or share the link directly.",
        ].join(""),
        thread_ts: threadTs,
      });

      await proposalJobService.addRefinementMessage(job.id, {
        role: "assistant",
        content: "Proposal finalized.",
        timestamp: new Date().toISOString(),
      });

      return;
    }

    // --- Update flow ---
    const updatedSections: ProposalSections = {
      ...job.sections,
      ...(result.updated_sections || {}),
    };

    if (result.updated_pricing) {
      updatedSections.pricing_and_terms = result.updated_pricing;
    }

    // Save to our job table
    await proposalJobService.updateJob(job.id, { sections: updatedSections });

    // Sync to Service-Engine-X
    if (job.service_engine_proposal_id) {
      try {
        await serviceEngine.updateProposal(job.service_engine_proposal_id, {
          sections: updatedSections,
          pricing: result.updated_pricing || job.sections.pricing_and_terms,
        });
      } catch (err) {
        console.warn("⚠️  Failed to sync update to Service-Engine-X:", err);
      }
    }

    const proposalUrl = job.proposal_public_id
      ? `https://www.outboundsolutions.com/p/${job.proposal_public_id}`
      : null;

    await say({
      text: [
        `✏️ *Updated:* ${result.explanation}`,
        proposalUrl ? `\n🔗 ${proposalUrl}` : "",
        "\n_Reply with more changes or say \"looks good\" to finalize._",
      ].join(""),
      thread_ts: threadTs,
    });

    await proposalJobService.addRefinementMessage(job.id, {
      role: "assistant",
      content: result.explanation,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`❌ Refinement error for job ${job.id}:`, err);
    await say({
      text: `❌ Something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`,
      thread_ts: threadTs,
    });
  }
}
