import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { buildGatewayOpenApiSpec } from "../openapi/buildGatewaySpec.ts";

export function docsRoutes(): Hono {
  const r = new Hono();

  r.get("/openapi.json", (c) => {
    const env = c.get("env");
    return c.json(buildGatewayOpenApiSpec(c, env));
  });

  r.get(
    "/docs",
    swaggerUI({
      url: "/openapi.json",
      persistAuthorization: true,
      tryItOutEnabled: true,
    }),
  );

  return r;
}
