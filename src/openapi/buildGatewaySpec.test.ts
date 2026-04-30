import { describe, expect, it } from "bun:test";
import type { Context } from "hono";
import type { Env } from "../env.ts";
import { buildGatewayOpenApiSpec } from "./buildGatewaySpec.ts";

function fakeContext(url: string): Context {
  return {
    req: {
      url,
      header: (_n: string) => undefined as string | undefined,
    },
  } as unknown as Context;
}

describe("buildGatewayOpenApiSpec", () => {
  it("uses GATEWAY_PUBLIC_URL for servers and includes auth paths", () => {
    const env = {
      GATEWAY_PUBLIC_URL: "https://gateway.example.com",
    } as Env;

    const spec = buildGatewayOpenApiSpec(fakeContext("http://ignored/openapi.json"), env);
    expect(spec.servers).toEqual([
      {
        url: "https://gateway.example.com/api/v1",
        description: "Gateway (proxied upstream)",
      },
    ]);
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/api/v1/auth/register"]).toBeDefined();
    expect(paths["/api/v1/auth/login"]).toBeDefined();
    expect(paths["/api/v1/auth/token"]).toBeDefined();
    expect(paths["/enterprise/balance/"]).toBeDefined();
    expect(paths["/project/"]).toBeDefined();
    expect(paths["/project/{project_id}/progress/"]).toBeDefined();
    expect(paths["/text-to-video/voices/clone/"]).toBeDefined();

    const registerPath = paths["/api/v1/auth/register"] as { post?: { security?: unknown[] } };
    const loginPath = paths["/api/v1/auth/login"] as { post?: { security?: unknown[] } };
    expect(registerPath.post?.security).toEqual([]);
    expect(loginPath.post?.security).toEqual([]);
    const registerResponseSchema = (registerPath.post as { responses?: Record<string, unknown> }).responses?.[
      "201"
    ] as { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
    expect(registerResponseSchema.content?.["application/json"]?.schema?.properties).toHaveProperty(
      "status",
    );
    expect(registerResponseSchema.content?.["application/json"]?.schema?.properties).toHaveProperty(
      "message",
    );
    expect(registerResponseSchema.content?.["application/json"]?.schema?.properties).toHaveProperty(
      "data",
    );
  });

  it("infers origin from Host when GATEWAY_PUBLIC_URL unset", () => {
    const env = {} as Env;
    const c = {
      req: {
        url: "http://localhost:3010/openapi.json",
        header: (name: string) =>
          name === "host" ? "api.test:3010" : (undefined as string | undefined),
      },
    } as unknown as Context;

    const spec = buildGatewayOpenApiSpec(c, env);
    const servers = spec.servers as { url: string }[];
    expect(servers[0]?.url).toBe("http://api.test:3010/api/v1");
  });
});
