import { getOpenAI } from "../lib/openai";
import { getTenantContext, getTenantFile } from "../lib/tenant-config";
import type { TranscriptIntel } from "./transcript-processor";
import type { ProposalSections, PricingConfig, ProposalMath } from "../types";

/**
 * Generates a full proposal from transcript intelligence + tenant config.
 * This is the core agent — it produces the 11-section proposal structure.
 */

const SYSTEM_PROMPT = `You are a world-class proposal writer for a GTM engineering firm. You write proposals that close deals.

Your proposals follow a specific 11-section structure. You will be given:
1. Intelligence extracted from a sales call transcript
2. The firm's service capabilities, pricing context, and tone guidelines
3. The proposal structure template

Your job is to generate compelling, specific content for each section. Key principles:
- Write in the firm's voice (confident, direct, engineering-minded, not salesy)
- Use specific details from the call — the prospect should feel like this was handcrafted
- Frame everything around OUTCOMES, not services
- The Assessment section should make them feel the pain of their current approach
- The Opportunity section should make them feel the momentum / why now
- Be specific about numbers where possible (market size, projected outcomes, costs)
- DO NOT fabricate specific statistics or market data — use placeholders like [X] if you don't have real numbers
- Pricing section: generate a SUGGESTED structure based on context, but flag it for human review

Return your output as JSON matching the ProposalSections schema exactly. Each section value should be markdown.`;

export async function assembleProposal(opts: {
  tenantSlug: string;
  intel: TranscriptIntel;
}): Promise<{ sections: ProposalSections; pricing: PricingConfig }> {
  const openai = getOpenAI();
  const tenantContext = getTenantContext(opts.tenantSlug);

  // Load specific template files
  const proposalStructure = getTenantFile(opts.tenantSlug, "proposal-template/structure.md") || "";
  const toneGuide = getTenantFile(opts.tenantSlug, "proposal-template/tone.md") || "";

  const userPrompt = `Generate a proposal based on this sales call intelligence and tenant context.

## SALES CALL INTELLIGENCE
${JSON.stringify(opts.intel, null, 2)}

## FIRM SERVICES & CAPABILITIES
${tenantContext["services"] || "No services config found."}

## PRICING CONTEXT
${tenantContext["pricing"] || "No pricing config found."}

## PROPOSAL STRUCTURE TEMPLATE
${proposalStructure || "Use the standard 11-section structure."}

## TONE GUIDE
${toneGuide || "Confident, direct, engineering-minded. Not salesy."}

## VERTICAL CONTEXT
${tenantContext["verticals"] || "No vertical-specific context."}

Generate the full proposal as a JSON object with two top-level keys:

"sections": {
  "executive_summary": "markdown content",
  "the_opportunity": "markdown content",
  "the_assessment": "markdown content", 
  "our_approach": "markdown content",
  "the_market": "markdown — include placeholder noting the TAM preview will be populated by the prospecting agent",
  "the_offer": "markdown content — what the campaign/engagement looks like",
  "the_math": { monthly_email_volume, response_rate, close_rate, avg_revenue_per_account, warm_leads, new_accounts, first_year_revenue, cost_per_account, roi_multiple } OR null if insufficient data,
  "the_engagement": "markdown content — Build/Launch/Optimize phases",
  "pricing_and_terms": { model, setup_fee, monthly_fee, performance_fee_per_outcome, primary_outcome, total, notes },
  "your_role": "markdown content — what the client needs to do",
  "next_steps": "markdown content"
},
"pricing": {
  "model": "setup_plus_performance" | "setup_plus_monthly" | "flat_project" | "pilot_to_contract" | "custom",
  "setup_fee": number | null,
  "monthly_fee": number | null, 
  "performance_fee_per_outcome": number | null,
  "primary_outcome": string | null,
  "total": number | null,
  "notes": "string explaining your pricing reasoning — THIS IS FOR THE REP, NOT THE CLIENT"
}

IMPORTANT: For pricing, suggest what makes sense based on the call intelligence and pricing context, but include a "notes" field explaining your reasoning. The rep will adjust this in the refinement step.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
    max_tokens: 8000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  const parsed = JSON.parse(content) as { sections: ProposalSections; pricing: PricingConfig };
  return parsed;
}
