import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { ADMIN_TOKEN, registerUser, setupGateway } from "./helpers/setup.ts";

const UPSTREAM_BEARER = "upstream-secret";
const PROBE_URL = "http://localhost/api/v1/enterprise/balance/";

describe("proxy header behaviour", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;

  // Capture the last request received by the mock upstream
  let lastUpstreamReq: { auth: string | null; headers: Record<string, string> } | null = null;

  beforeAll(async () => {
    ({ app, upstream } = await setupGateway((req) => {
      const captured: Record<string, string> = {};
      req.headers.forEach((value, key) => { captured[key] = value; });
      lastUpstreamReq = {
        auth: req.headers.get("authorization"),
        headers: captured,
      };
      return Response.json({ received: true });
    }));
  });

  afterAll(() => upstream?.stop());

  it("replaces consumer JWT with UPSTREAM_BEARER_TOKEN in forwarded Authorization header", async () => {
    const { token } = await registerUser(app);

    await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(lastUpstreamReq?.auth).toBe(`Bearer ${UPSTREAM_BEARER}`);
    expect(lastUpstreamReq?.auth).not.toContain(token);
  });

  it("does not leak the consumer's original JWT to the upstream", async () => {
    const { token } = await registerUser(app);

    await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    // No header on the upstream side should contain the consumer token
    const values = Object.values(lastUpstreamReq?.headers ?? {});
    expect(values.some((v) => v.includes(token))).toBe(false);
  });

  it("strips hop-by-hop headers before forwarding", async () => {
    const { token } = await registerUser(app);

    await app.fetch(
      new Request(PROBE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Transfer-Encoding": "chunked",
          TE: "trailers",
          "Keep-Alive": "timeout=5",
        },
      }),
    );

    // The gateway must not forward client-supplied hop-by-hop headers.
    // (Note: `Connection` is intentionally not asserted here — fetch sets its
    // own `Connection: keep-alive` on the outgoing request as a transport
    // concern, independent of what the gateway passes through.)
    expect(lastUpstreamReq?.headers["transfer-encoding"]).toBeUndefined();
    expect(lastUpstreamReq?.headers["te"]).toBeUndefined();
    expect(lastUpstreamReq?.headers["keep-alive"]).toBeUndefined();
  });

  it("passes through non-hop-by-hop custom headers to the upstream", async () => {
    const { token } = await registerUser(app);

    await app.fetch(
      new Request(PROBE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Trace-Id": "trace-abc-123",
        },
      }),
    );

    expect(lastUpstreamReq?.headers["x-trace-id"]).toBe("trace-abc-123");
  });

  it("upstream receives exactly Bearer <UPSTREAM_BEARER_TOKEN> regardless of which consumer called", async () => {
    const user1 = await registerUser(app, "User One");
    const user2 = await registerUser(app, "User Two");

    await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${user1.token}` },
      }),
    );
    const auth1 = lastUpstreamReq?.auth;

    await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${user2.token}` },
      }),
    );
    const auth2 = lastUpstreamReq?.auth;

    expect(auth1).toBe(`Bearer ${UPSTREAM_BEARER}`);
    expect(auth2).toBe(`Bearer ${UPSTREAM_BEARER}`);
    expect(auth1).toBe(auth2);
  });

  it("content-type from the request body is forwarded to upstream", async () => {
    const { token } = await registerUser(app);

    // Use a POST /project/ so it has a body and content-type
    await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: "make a video" }),
      }),
    );

    expect(lastUpstreamReq?.headers["content-type"]).toContain("application/json");
  });
});

describe("proxy — X-Admin-Token is forwarded (security note)", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;
  let capturedAdminToken: string | null | undefined;

  beforeAll(async () => {
    ({ app, upstream } = await setupGateway((req) => {
      capturedAdminToken = req.headers.get("x-admin-token");
      return Response.json({ ok: true });
    }));
  });

  afterAll(() => upstream?.stop());

  it("X-Admin-Token sent on a proxy request reaches the upstream (current behaviour)", async () => {
    const { token } = await registerUser(app);

    await app.fetch(
      new Request(PROBE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Admin-Token": ADMIN_TOKEN,
        },
      }),
    );

    // Document current behaviour: X-Admin-Token IS forwarded upstream.
    // If this test starts failing it means the gateway was hardened to strip it — update accordingly.
    expect(capturedAdminToken as unknown as string).toBe(ADMIN_TOKEN);
  });
});
