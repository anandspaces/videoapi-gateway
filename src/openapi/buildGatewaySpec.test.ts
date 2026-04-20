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
    expect(paths["/auth/register"]).toBeDefined();
    expect(paths["/auth/login"]).toBeDefined();
    expect(paths["/auth/token"]).toBeDefined();
    expect(paths["/enterprise/balance/"]).toBeDefined();
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
