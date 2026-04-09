import { getOpenAI } from "../lib/openai";
import type { GranolaNote } from "../types";

/**
 * Extracted intelligence from a sales call transcript.
 */
export interface TranscriptIntel {
  lead_name: string | null;
  lead_company: string | null;
  lead_email: string | null;
  lead_role: string | null;

  // What we learned about them
  company_description: string;
  pain_points: string[];
  current_approach: string; // how they currently handle outbound / sales
  budget_signals: string[]; // anything about money, pricing, willingness to pay
  decision_timeline: string | null;
  decision_makers: string[]; // who else is involved

  // What was discussed about our services
  services_discussed: string[]; // which of our capabilities came up
  primary_outcome_discussed: string | null; // "booked meetings", "sample requests", etc.
  offer_discussed: string | null; // any specific offer structure mentioned

  // Opportunity framing
  opportunity_summary: string; // 2-3 sentences: why this is a good fit
  assessment_summary: string; // 2-3 sentences: what they're doing wrong / cost of status quo
  objections_raised: string[];
  enthusiasm_level: "high" | "medium" | "low" | "unclear";

  // Raw summary for reference
  call_summary: string;
}

const SYSTEM_PROMPT = `You are an expert sales analyst. You analyze sales call transcripts for a GTM engineering firm.

Your job is to extract structured intelligence from the transcript that will be used to generate a proposal.

The firm's capabilities are:
- Cold email (primary offering)
- Cold calling (used to enhance outcomes, not sold separately)
- Direct mail
- Inbound IVR (live transfer and scheduled callback)

The firm sells OUTCOMES, not services. The outcome depends on the prospect's business:
- For most B2B companies: booked meetings
- For CPG/spirits brands: sample requests, on-premise placements
- For staffing/recruiting: live transfers, scheduled callbacks

Extract every signal that would help craft a compelling, personalized proposal.

IMPORTANT: The transcript uses "microphone" for the firm's representative and "speaker" for the prospect/other attendees.

Return your analysis as JSON matching the requested schema exactly.`;

export async function processTranscript(note: GranolaNote): Promise<TranscriptIntel> {
  const openai = getOpenAI();

  // Format transcript for the LLM
  const transcriptText = (note.transcript || [])
    .map((entry) => {
      const label = entry.speaker.source === "microphone" ? "REP" : "PROSPECT";
      return `[${label}]: ${entry.text}`;
    })
    .join("\n");

  const userPrompt = `Analyze this sales call transcript and extract structured intelligence.

MEETING TITLE: ${note.title || "Unknown"}
ATTENDEES: ${note.attendees.map((a) => `${a.name} (${a.email})`).join(", ")}
GRANOLA SUMMARY: ${note.summary_markdown || note.summary_text || "N/A"}

TRANSCRIPT:
${transcriptText}

Return a JSON object with these fields:
- lead_name (string | null)
- lead_company (string | null)
- lead_email (string | null)
- lead_role (string | null)
- company_description (string — what the prospect's company does)
- pain_points (string[] — their problems)
- current_approach (string — how they currently do outbound/sales)
- budget_signals (string[] — anything about money or pricing)
- decision_timeline (string | null)
- decision_makers (string[] — who else is involved)
- services_discussed (string[] — which capabilities came up)
- primary_outcome_discussed (string | null)
- offer_discussed (string | null — any specific deal structure)
- opportunity_summary (string — 2-3 sentences on why this is a fit)
- assessment_summary (string — 2-3 sentences on their current inefficiencies)
- objections_raised (string[])
- enthusiasm_level ("high" | "medium" | "low" | "unclear")
- call_summary (string — concise summary of the call)`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  return JSON.parse(content) as TranscriptIntel;
}
