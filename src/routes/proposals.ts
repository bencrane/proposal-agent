import { FastifyInstance } from "fastify";
import * as proposalJobService from "../services/proposal-job";
import { triggerWithNote } from "../agents/orchestrator";

export async function proposalRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * List all proposal jobs (for debugging / admin).
   */
  fastify.get("/proposals/jobs", async (request, reply) => {
    // TODO: add auth
    const { status } = request.query as { status?: string };
    if (status) {
      const jobs = await proposalJobService.getJobsByStatus(status as any);
      return jobs;
    }
    // Return recent jobs
    const jobs = await proposalJobService.getJobsByStatus("in_review");
    return jobs;
  });

  /**
   * Get a specific job.
   */
  fastify.get<{ Params: { jobId: string } }>("/proposals/jobs/:jobId", async (request, reply) => {
    const job = await proposalJobService.getJob(request.params.jobId);
    if (!job) return reply.status(404).send({ error: "Job not found" });
    return job;
  });

  /**
   * Manual trigger: provide a Granola note ID to kick off the pipeline for an existing job.
   * Useful for testing.
   */
  fastify.post<{ Params: { jobId: string }; Body: { granola_note_id: string } }>(
    "/proposals/jobs/:jobId/trigger",
    async (request, reply) => {
      const { jobId } = request.params;
      const { granola_note_id } = request.body;

      const job = await proposalJobService.getJob(jobId);
      if (!job) return reply.status(404).send({ error: "Job not found" });

      // Run async — don't block the response
      triggerWithNote(jobId, granola_note_id).catch((err) => {
        console.error(`❌ Manual trigger failed for job ${jobId}:`, err);
      });

      return { status: "triggered", job_id: jobId };
    }
  );

  /**
   * Quick-create: manually create a job and optionally trigger it.
   * Useful for testing without Cal.com.
   */
  fastify.post<{
    Body: {
      tenant_slug: string;
      org_id: string;
      meeting_title: string;
      attendee_emails: string[];
      granola_note_id?: string;
    };
  }>("/proposals/jobs", async (request, reply) => {
    const { tenant_slug, org_id, meeting_title, attendee_emails, granola_note_id } = request.body;

    const job = await proposalJobService.createJob({
      org_id,
      tenant_slug,
      cal_event_id: `manual-${Date.now()}`,
      meeting_title,
      meeting_start: new Date().toISOString(),
      meeting_end: new Date().toISOString(),
      organizer_email: "manual@trigger.local",
      attendee_emails,
    });

    if (granola_note_id) {
      triggerWithNote(job.id, granola_note_id).catch((err) => {
        console.error(`❌ Manual trigger failed for job ${job.id}:`, err);
      });
    }

    return { status: "created", job_id: job.id };
  });
}
