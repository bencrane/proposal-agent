import { getSlackApp } from "../app";
import * as proposalJobService from "../../services/proposal-job";
import { getTenantConfig } from "../../lib/tenant-config";
import type { ProposalSections, PricingConfig } from "../../types";

/**
 * Posts a proposal draft notification to the tenant's Slack channel.
 * The thread becomes the refinement interface.
 */
export async function notifyProposalReady(jobId: string): Promise<void> {
  const job = await proposalJobService.getJob(jobId);
  if (!job || !job.sections) throw new Error(`Job ${jobId} not ready`);

  const tenant = getTenantConfig(job.tenant_slug);
  if (!tenant) throw new Error(`Tenant not found: ${job.tenant_slug}`);

  const app = getSlackApp();
  const channelId = tenant.slack_channel_id;
  const sections = job.sections;
  const pricing = sections.pricing_and_terms;

  // Build the Slack message
  const proposalUrl = job.proposal_public_id
    ? `https://www.outboundsolutions.com/p/${job.proposal_public_id}`
    : null;

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📋 Proposal Draft: ${job.lead_company || "New Prospect"}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Lead:* ${job.lead_name || "Unknown"} at ${job.lead_company || "Unknown"}`,
          `*Meeting:* ${job.meeting_title || "Sales Call"}`,
          `*Status:* Draft — ready for your review`,
        ].join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Executive Summary Preview:*\n>${truncate(sections.executive_summary, 300)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: formatPricingSummary(pricing),
      },
    },
  ];

  if (proposalUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Full Proposal" },
          url: proposalUrl,
          style: "primary",
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "💬 *Reply in this thread to refine the proposal.* Examples:\n• _\"change pricing to $500 pilot then $25K for 500 samples\"_\n• _\"remove direct mail from the approach\"_\n• _\"make the assessment section more aggressive\"_\n• _\"looks good, send it\"_",
      },
    ],
  });

  // Post the message
  const result = await app.client.chat.postMessage({
    channel: channelId,
    text: `📋 Proposal draft ready for ${job.lead_company || "New Prospect"}`,
    blocks,
  });

  // Store the thread timestamp so we can listen for replies
  if (result.ts) {
    await proposalJobService.updateJob(jobId, {
      slack_channel_id: channelId,
      slack_thread_ts: result.ts,
      status: "in_review",
    });
  }
}

function formatPricingSummary(pricing: PricingConfig): string {
  const lines = ["*Suggested Pricing:*"];

  if (pricing.model) lines.push(`Model: \`${pricing.model}\``);
  if (pricing.setup_fee) lines.push(`Setup: $${pricing.setup_fee.toLocaleString()}`);
  if (pricing.monthly_fee) lines.push(`Monthly: $${pricing.monthly_fee.toLocaleString()}/mo`);
  if (pricing.performance_fee_per_outcome && pricing.primary_outcome) {
    lines.push(`Performance: $${pricing.performance_fee_per_outcome} per ${pricing.primary_outcome}`);
  }
  if (pricing.total) lines.push(`*Total: $${pricing.total.toLocaleString()}*`);
  if (pricing.notes) lines.push(`\n_Agent reasoning: ${truncate(pricing.notes, 200)}_`);

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}
