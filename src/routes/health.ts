import { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => ({
    status: "ok",
    service: "proposal-agent",
    timestamp: new Date().toISOString(),
  }));

  fastify.get("/health/live", async () => ({ status: "live" }));
  fastify.get("/health/ready", async () => ({ status: "ready" }));
}
