import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { logInfo } from "../logging/logger.ts";
import { buildGatewayOpenApiSpec } from "../openapi/buildGatewaySpec.ts";

export function docsRoutes(): Hono {
  const r = new Hono();

  r.get("/openapi.json", (c) => {
    const env = c.get("env");
    logInfo("docs.openapi.serve", { requestId: c.get("requestId") });
    return c.json(buildGatewayOpenApiSpec(c, env));
  });

  r.get(
    "/docs",
    swaggerUI({
      url: "/api/v1/openapi.json",
      persistAuthorization: true,
      tryItOutEnabled: true,
    }),
  );

  return r;
}
