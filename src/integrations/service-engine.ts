import { getEnv } from "../config/env";
import type { ProposalSections, PricingConfig, SEXProposalItem } from "../types";

/**
 * Client for the Service-Engine-X Internal API.
 * All calls use X-Internal-Key authentication.
 *
 * Required internal endpoints (see SERVICE-ENGINE-CONTRACT.md):
 *   POST /api/internal/proposals              — create draft
 *   PUT  /api/internal/proposals/:id          — update draft (sections, items, metadata)
 *   POST /api/internal/proposals/:id/send     — move draft → sent
 *   GET  /api/internal/orgs/:org/proposals/:id — read proposal
 */

async function sexFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const env = getEnv();
  const url = `${env.SERVICE_ENGINE_API_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": env.SERVICE_ENGINE_INTERNAL_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Service-Engine-X ${method} ${path} → ${res.status}: ${text}`);
  }

  // Handle 204 No Content (some updates may return empty)
  if (res.status === 204) return {} as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Proposals — Create
// ---------------------------------------------------------------------------

interface CreateProposalOpts {
  org_id: string;
  title: string;
  sections: ProposalSections;
  pricing: PricingConfig;
  account_id?: string; // Link to existing account (created at booking, not here)
  client_email?: string;
  client_name_f?: string;
  client_name_l?: string;
  client_company?: string;
}

interface CreateProposalResult {
  id: string;
  public_id: string;
}

/**
 * Creates a proposal in DRAFT state (status=0).
 * Does NOT send. Sending is a separate explicit action after refinement.
 */
export async function createProposal(opts: CreateProposalOpts): Promise<CreateProposalResult> {
  const items = buildLineItems(opts.pricing);

  return sexFetch<CreateProposalResult>("POST", "/api/internal/proposals", {
    org_id: opts.org_id,
    title: opts.title,
    status: 0, // Draft — do NOT auto-send
    account_id: opts.account_id,
    client_email: opts.client_email,
    client_name_f: opts.client_name_f,
    client_name_l: opts.client_name_l,
    client_company: opts.client_company,
    items,
    // Proposal content — the 11 sections + pricing config
    content: {
      sections: opts.sections,
      pricing_config: opts.pricing,
      generated_by: "proposal-agent",
      generated_at: new Date().toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// Proposals — Update
// ---------------------------------------------------------------------------

interface UpdateProposalOpts {
  sections?: ProposalSections;
  pricing?: PricingConfig;
  title?: string;
  items?: SEXProposalItem[];
}

/**
 * Updates an existing draft proposal.
 * Used by the refinement flow after Slack thread edits.
 */
export async function updateProposal(
  proposalId: string,
  opts: UpdateProposalOpts
): Promise<void> {
  const payload: Record<string, unknown> = {};

  if (opts.title) {
    payload.title = opts.title;
  }

  if (opts.sections || opts.pricing) {
    payload.content = {
      sections: opts.sections,
      pricing_config: opts.pricing,
      generated_by: "proposal-agent",
      updated_at: new Date().toISOString(),
    };
  }

  if (opts.pricing) {
    payload.items = buildLineItems(opts.pricing);
  }

  await sexFetch("PUT", `/api/internal/proposals/${proposalId}`, payload);
}

// ---------------------------------------------------------------------------
// Proposals — Send
// ---------------------------------------------------------------------------

/**
 * Moves a proposal from Draft (0) → Sent (1).
 * Called when the user says "send it" in the Slack refinement thread.
 */
export async function sendProposal(proposalId: string): Promise<void> {
  await sexFetch("POST", `/api/internal/proposals/${proposalId}/send`, {});
}

// ---------------------------------------------------------------------------
// Proposals — Read
// ---------------------------------------------------------------------------

export async function getProposal(
  orgId: string,
  proposalId: string
): Promise<Record<string, unknown>> {
  return sexFetch<Record<string, unknown>>(
    "GET",
    `/api/internal/orgs/${orgId}/proposals/${proposalId}`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLineItems(pricing: PricingConfig): SEXProposalItem[] {
  const items: SEXProposalItem[] = [];

  if (pricing.setup_fee) {
    items.push({
      name: "Setup & Infrastructure",
      description:
        "One-time: dedicated sending infrastructure, data sourcing, campaign strategy, creative assets",
      quantity: 1,
      unit_price: pricing.setup_fee,
      total: pricing.setup_fee,
    });
  }

  if (pricing.monthly_fee) {
    items.push({
      name: "Monthly Engagement",
      description:
        "Ongoing: campaign execution, optimization, reply management, lead handoff",
      quantity: 1,
      unit_price: pricing.monthly_fee,
      total: pricing.monthly_fee,
    });
  }

  if (pricing.performance_fee_per_outcome && pricing.primary_outcome) {
    items.push({
      name: `Performance — per ${pricing.primary_outcome}`,
      description: `Billed per ${pricing.primary_outcome} generated`,
      quantity: 1,
      unit_price: pricing.performance_fee_per_outcome,
      total: pricing.performance_fee_per_outcome,
    });
  }

  return items;
}
