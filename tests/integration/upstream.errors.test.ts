import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { registerUser, setupGateway } from "./helpers/setup.ts";

// A proxied route that has no credit cost (avoids needing a real wallet)
const PROBE_URL = "http://localhost/api/v1/enterprise/balance/";

describe("upstream unreachable — returns 502", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    // Stand the upstream up so setupGateway can wire UPSTREAM_BASE_URL to its
    // port, then shut it down so the port refuses connections. This makes the
    // gateway's fetch reject at the transport layer — the real "upstream
    // unreachable" path. (Throwing inside the mock handler does NOT work:
    // Bun.serve turns a thrown handler into a genuine HTTP 500, which the
    // gateway correctly passes through as 500, not 502.)
    ({ app, upstream } = await setupGateway(() => Response.json({ ok: true })));
    upstream.stop(true);
  });

  afterAll(() => upstream?.stop(true));

  it("returns 502 with bad_gateway error when upstream throws", async () => {
    const { token } = await registerUser(app);

    const res = await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      status: number;
      message: string;
      data: { error: string };
    };
    expect(body.status).toBe(0);
    expect(body.data.error).toBe("bad_gateway");
  });

  it("502 response is a valid envelope (status/message/data all present)", async () => {
    const { token } = await registerUser(app);

    const res = await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("message");
    expect(body).toHaveProperty("data");
  });
});

describe("upstream timeout — returns 502 with timeout message", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    // Upstream never responds on its own, so the gateway's short timeout fires.
    // It does release the connection when the client (gateway) aborts, which
    // lets afterAll's stop() complete instead of hanging on the in-flight request.
    ({ app, upstream } = await setupGateway(
      (req) =>
        new Promise<Response>((_resolve, reject) => {
          req.signal.addEventListener("abort", () => reject(new Error("client aborted")));
        }),
      { UPSTREAM_TIMEOUT_MS: "80" },
    ));
  });

  afterAll(() => upstream?.stop());

  it("returns 502 with 'Upstream timeout' when upstream hangs", async () => {
    const { token } = await registerUser(app);

    const res = await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string; data: { error: string } };
    expect(body.message).toBe("Upstream timeout");
    expect(body.data.error).toBe("bad_gateway");
  });
});

describe("upstream returns non-JSON — wraps raw text in envelope", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    ({ app, upstream } = await setupGateway(() =>
      new Response("plain text response", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ));
  });

  afterAll(() => upstream?.stop());

  it("wraps non-JSON upstream body under data.raw", async () => {
    const { token } = await registerUser(app);

    const res = await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: number;
      data: { raw: string; content_type: string; status_code: number };
    };
    expect(body.status).toBe(1);
    expect(body.data.raw).toBe("plain text response");
    expect(body.data.content_type).toBe("text/plain");
    expect(body.data.status_code).toBe(200);
  });
});

describe("upstream returns error status — gateway passes through the status code", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    ({ app, upstream } = await setupGateway(() =>
      Response.json({ error: "upstream_error" }, { status: 422 }),
    ));
  });

  afterAll(() => upstream?.stop());

  it("propagates upstream 422 status and wraps JSON under data.upstream", async () => {
    const { token } = await registerUser(app);

    const res = await app.fetch(
      new Request(PROBE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      status: number;
      data: { upstream: { error: string }; status_code: number };
    };
    expect(body.status).toBe(0);
    expect(body.data.upstream).toEqual({ error: "upstream_error" });
    expect(body.data.status_code).toBe(422);
  });
});
