import { getOpenAI } from "../lib/openai";
import { getTenantContext } from "../lib/tenant-config";
import type { ProposalJob, ProposalSections, PricingConfig, RefinementMessage } from "../types";

/**
 * The refinement agent handles natural language commands to modify a proposal.
 * It takes the current proposal state + a user message and returns updated sections.
 */

const SYSTEM_PROMPT = `You are a proposal refinement assistant. You help a GTM engineering firm founder refine proposal drafts through conversation.

You have access to the current proposal content (all 11 sections + pricing). When the user asks for changes, you:
1. Make the requested changes to the appropriate sections
2. Explain what you changed
3. Return the updated sections

Common requests:
- Changing pricing model (e.g., "switch to pay-for-perf", "make it a pilot then $25K for 500 outcomes")
- Removing/adding services (e.g., "remove direct mail", "add cold calling mention")
- Adjusting tone (e.g., "make the assessment more aggressive", "tone down the math")
- Updating specific numbers (e.g., "change setup fee to $3,000")
- Rewriting sections (e.g., "rewrite the opportunity section to focus on their expansion plans")

IMPORTANT RULES:
- Only modify sections that the user's request actually impacts
- Preserve the voice and quality of unchanged sections
- When modifying pricing, update BOTH the pricing config AND the pricing_and_terms section text
- When the user says "send it" or "looks good" or "finalize", return { "action": "finalize" } instead of sections
- Be concise in your explanations

Return JSON with:
{
  "action": "update" | "finalize",
  "explanation": "what you changed",
  "updated_sections": { ...only the sections that changed... },
  "updated_pricing": { ...if pricing changed... } | null
}`;

export interface RefinementResult {
  action: "update" | "finalize";
  explanation: string;
  updated_sections: Partial<ProposalSections> | null;
  updated_pricing: PricingConfig | null;
}

export async function processRefinement(opts: {
  job: ProposalJob;
  userMessage: string;
  tenantSlug: string;
}): Promise<RefinementResult> {
  const openai = getOpenAI();
  const tenantContext = getTenantContext(opts.tenantSlug);

  // Build conversation history for context
  const history: Array<{ role: "user" | "assistant"; content: string }> = (
    opts.job.refinement_history || []
  ).map((msg: RefinementMessage) => ({
    role: msg.role,
    content: msg.content,
  }));

  const userPrompt = `CURRENT PROPOSAL STATE:
${JSON.stringify(opts.job.sections, null, 2)}

CURRENT PRICING:
${JSON.stringify(opts.job.sections?.pricing_and_terms, null, 2)}

LEAD: ${opts.job.lead_company || "Unknown"} (${opts.job.lead_name || "Unknown"})

PRICING CONTEXT (firm reference):
${tenantContext["pricing"] || "N/A"}

USER REQUEST: ${opts.userMessage}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-10), // Keep last 10 messages for context window
    { role: "user", content: userPrompt },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 6000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  return JSON.parse(content) as RefinementResult;
}
