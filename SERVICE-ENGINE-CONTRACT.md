# Service-Engine-X: Internal API Additions for Proposal Agent

**Requesting Service:** `proposal-agent`  
**Auth:** `X-Internal-Key` (existing pattern)  
**Priority:** Required before proposal-agent goes live

---

## Summary

The proposal-agent needs 3 internal endpoints on Service-Engine-X to create, update, and send proposals via machine-to-machine calls. These follow the existing internal API pattern (`/api/internal/...` with `X-Internal-Key` auth).

Additionally, the `proposals` table needs a `content JSONB` column to store structured proposal section data (the 11-section proposal body). Currently, proposal content is hardcoded in the frontend — this column is what makes the frontend "dumb" (renders from data instead of hardcode).

---

## 1. Schema Change: Add `content` column to `proposals`

```sql
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS content JSONB DEFAULT NULL;

COMMENT ON COLUMN proposals.content IS 
  'Structured proposal content. Shape: { sections: ProposalSections, pricing_config: PricingConfig, generated_by: string, generated_at: string }';
```

### Content Shape

```jsonc
{
  "sections": {
    "executive_summary": "markdown string",
    "the_opportunity": "markdown string",
    "the_assessment": "markdown string",
    "our_approach": "markdown string",
    "the_market": "markdown string",
    "the_offer": "markdown string",
    "the_math": {
      "monthly_email_volume": 30000,
      "response_rate": 0.02,
      "close_rate": 0.15,
      "avg_revenue_per_account": 2000,
      "warm_leads": 600,
      "new_accounts": 90,
      "first_year_revenue": 180000,
      "cost_per_account": 306,
      "roi_multiple": 6.5
    },
    "the_engagement": "markdown string",
    "pricing_and_terms": {
      "model": "setup_plus_performance",
      "setup_fee": 5000,
      "monthly_fee": null,
      "performance_fee_per_outcome": 150,
      "primary_outcome": "booked meeting",
      "total": null,
      "notes": "internal reasoning — not shown to client"
    },
    "your_role": "markdown string",
    "next_steps": "markdown string"
  },
  "pricing_config": { /* same as pricing_and_terms above */ },
  "generated_by": "proposal-agent",
  "generated_at": "2026-04-09T21:00:00Z"
}
```

---

## 2. Endpoint: Create Proposal as Draft

**Existing endpoint being modified:**

```
POST /api/internal/proposals
```

**Current behavior:** Creates AND sends the proposal.  
**Required behavior:** Creates as Draft (status=0). Does NOT send.

### Request Body

```jsonc
{
  "org_id": "uuid",                    // required
  "title": "string",                   // required
  "status": 0,                         // 0 = Draft (respect this, do not override to Sent)
  "account_id": "uuid | null",         // optional — link to existing account
  "client_email": "string | null",     // optional (legacy field)
  "client_name_f": "string | null",    // optional (legacy field)
  "client_name_l": "string | null",    // optional (legacy field)
  "client_company": "string | null",   // optional (legacy field)
  "content": { /* JSONB — see shape above */ },
  "items": [                           // optional — proposal line items
    {
      "name": "Setup & Infrastructure",
      "description": "One-time: dedicated sending infrastructure...",
      "quantity": 1,
      "unit_price": 5000,
      "total": 5000
    }
  ]
}
```

### Response

```jsonc
{
  "id": "uuid",           // proposal UUID
  "public_id": "string"   // short public ID for URL (e.g., "9d5bb180")
}
```

**Notes:**
- If `status: 0` is passed, do NOT auto-send or trigger email.
- `public_id` is needed so proposal-agent can construct the frontend URL (`/p/{public_id}`).
- If `public_id` is not currently generated on create, it should be.

---

## 3. Endpoint: Update Proposal (NEW)

```
PUT /api/internal/proposals/:proposal_id
```

**Auth:** `X-Internal-Key`

### Request Body (all fields optional — partial update)

```jsonc
{
  "title": "string",
  "content": { /* JSONB — full replacement of content field */ },
  "items": [ /* full replacement of proposal_items */ ]
}
```

### Response

```jsonc
{
  "id": "uuid",
  "public_id": "string",
  "status": 0,
  "updated_at": "2026-04-09T21:30:00Z"
}
```

### Behavior

- Only updates fields that are present in the request body.
- If `content` is provided, fully replaces the `content` JSONB column.
- If `items` is provided, deletes existing `proposal_items` and inserts new ones.
- Does NOT change proposal status.
- Should validate that the proposal exists and belongs to a valid org.

---

## 4. Endpoint: Send Proposal (NEW internal route)

```
POST /api/internal/proposals/:proposal_id/send
```

**Auth:** `X-Internal-Key`

### Request Body

```jsonc
{}  // empty — or optionally { "recipient_email": "override@example.com" }
```

### Response

```jsonc
{
  "id": "uuid",
  "status": 1,
  "sent_at": "2026-04-09T22:00:00Z"
}
```

### Behavior

- Moves proposal from Draft (0) → Sent (1).
- Triggers the same email flow as the existing `POST /api/proposals/:id/send` (Resend).
- Uses the `client_email` on the proposal as recipient (or `recipient_email` override).
- Should reject if proposal is not in Draft status.

---

## 5. Public Proposal Endpoint Update

The existing public endpoint needs to return the `content` field:

```
GET /api/public/proposals/:id
```

Ensure the response includes:
```jsonc
{
  // ...existing fields...
  "content": { /* the JSONB content field */ }
}
```

This is what the frontend at `outboundsolutions.com/p/{id}` will read to render the proposal instead of hardcoded content.

---

## Implementation Checklist

- [ ] Add `content JSONB` column to `proposals` table
- [ ] Modify `POST /api/internal/proposals` to respect `status: 0` (don't auto-send)
- [ ] Modify `POST /api/internal/proposals` to accept and store `content` JSONB
- [ ] Modify `POST /api/internal/proposals` to return `public_id` in response
- [ ] Add `PUT /api/internal/proposals/:id` endpoint
- [ ] Add `POST /api/internal/proposals/:id/send` endpoint
- [ ] Update `GET /api/public/proposals/:id` to include `content` in response
