import { describe, expect, it } from "bun:test";
import {
  buildUpstreamHeaders,
  filterResponseHeaders,
  joinUpstreamUrl,
} from "../../../src/proxy/upstream.ts";

describe("joinUpstreamUrl", () => {
  it("joins base and path", () => {
    expect(joinUpstreamUrl("https://api.example.com/api/v1", "/enterprise/balance/")).toBe(
      "https://api.example.com/api/v1/enterprise/balance/",
    );
    expect(joinUpstreamUrl("https://api.example.com/api/v1/", "enterprise/balance")).toBe(
      "https://api.example.com/api/v1/enterprise/balance",
    );
  });
});

describe("buildUpstreamHeaders", () => {
  it("strips Authorization and sets upstream bearer", () => {
    const h = new Headers();
    h.set("Authorization", "Bearer consumer");
    h.set("Content-Type", "application/json");
    h.set("Connection", "keep-alive");
    const out = buildUpstreamHeaders(h, "upstream-token");
    expect(out.get("authorization")).toBe("Bearer upstream-token");
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("connection")).toBeNull();
  });

  it("strips all hop-by-hop headers", () => {
    const hopByHop = [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailers",
      "transfer-encoding",
      "upgrade",
      "host",
    ];
    const h = new Headers({ Authorization: "Bearer x", "Content-Type": "text/plain" });
    for (const name of hopByHop) h.set(name, "value");
    const out = buildUpstreamHeaders(h, "tok");
    for (const name of hopByHop) {
      expect(out.get(name)).toBeNull();
    }
  });

  it("preserves arbitrary passthrough headers", () => {
    const h = new Headers({ Authorization: "Bearer x", "X-Request-Id": "abc123" });
    const out = buildUpstreamHeaders(h, "tok");
    expect(out.get("x-request-id")).toBe("abc123");
  });
});

describe("filterResponseHeaders", () => {
  it("removes hop-by-hop headers from upstream response", () => {
    const hopByHop = ["connection", "transfer-encoding", "keep-alive", "upgrade", "trailers", "te"];
    const res = new Response(null, {
      headers: Object.fromEntries([
        ["content-type", "application/json"],
        ["x-custom", "hello"],
        ...hopByHop.map((h) => [h, "value"]),
      ]),
    });
    const filtered = filterResponseHeaders(res);
    for (const h of hopByHop) {
      expect(filtered.get(h)).toBeNull();
    }
  });

  it("preserves non-hop-by-hop response headers", () => {
    const res = new Response(null, {
      headers: { "content-type": "application/json", "x-custom-header": "kept" },
    });
    const filtered = filterResponseHeaders(res);
    expect(filtered.get("content-type")).toBe("application/json");
    expect(filtered.get("x-custom-header")).toBe("kept");
  });

  it("returns empty Headers when response has only hop-by-hop headers", () => {
    const res = new Response(null, { headers: { connection: "close", "transfer-encoding": "chunked" } });
    const filtered = filterResponseHeaders(res);
    expect(filtered.get("connection")).toBeNull();
    expect(filtered.get("transfer-encoding")).toBeNull();
  });
});
