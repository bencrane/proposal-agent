import { FastifyInstance } from "fastify";
import { getReadiness } from "../config/env";

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => {
    const { ready, missing } = getReadiness();
    return {
      status: "ok",
      service: "proposal-agent",
      integrations: { ready, missing },
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get("/health/live", async () => ({ status: "live" }));
  fastify.get("/health/ready", async () => ({ status: "ready" }));
}
