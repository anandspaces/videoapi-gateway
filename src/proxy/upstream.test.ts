import { describe, expect, it } from "bun:test";
import { buildUpstreamHeaders, joinUpstreamUrl } from "./upstream.ts";

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
});
