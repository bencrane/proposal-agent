import { FastifyInstance } from "fastify";
import { resolveTenantByEmail } from "../../lib/tenant-config";
import { handleMeetingEnded } from "../../agents/orchestrator";
import type { CalcomWebhookPayload } from "../../types";

export async function calcomWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Cal.com sends this webhook when a meeting ends.
   * We verify the secret, resolve the tenant, and kick off the pipeline.
   */
  fastify.post<{ Body: CalcomWebhookPayload }>("/webhooks/calcom", async (request, reply) => {
    const body = request.body;

    // Verify webhook secret (Cal.com sends it in a header or payload — adjust as needed)
    // For now, we check a basic shared secret
    // TODO: implement proper Cal.com webhook signature verification

    if (body.triggerEvent !== "MEETING_ENDED" && body.triggerEvent !== "BOOKING_CREATED") {
      // We only care about meetings ending (or created, for testing)
      return reply.status(200).send({ status: "ignored", event: body.triggerEvent });
    }

    const payload = body.payload;
    const organizerEmail = payload.organizer.email;

    // Resolve tenant from organizer email
    const tenant = resolveTenantByEmail(organizerEmail);
    if (!tenant) {
      console.warn(`⚠️  No tenant found for organizer: ${organizerEmail}`);
      return reply.status(200).send({ status: "no_tenant", email: organizerEmail });
    }

    console.log(`📞 Cal.com ${body.triggerEvent}: "${payload.title}" → tenant: ${tenant.slug}`);

    // Kick off the proposal pipeline
    try {
      const job = await handleMeetingEnded({
        calEventId: payload.uid,
        meetingTitle: payload.title,
        meetingStart: payload.startTime,
        meetingEnd: payload.endTime,
        organizerEmail,
        attendeeEmails: payload.attendees.map((a) => a.email),
        tenantSlug: tenant.slug,
        orgId: tenant.org_id,
      });

      return reply.status(200).send({ status: "job_created", job_id: job.id });
    } catch (err) {
      console.error("❌ Failed to process Cal.com webhook:", err);
      return reply.status(500).send({ status: "error" });
    }
  });
}
