import { describe, expect, it } from "bun:test";
import { normalizeGatewayPathname } from "../../../src/auth/apiPath.ts";

describe("normalizeGatewayPathname", () => {
  it("leaves full paths unchanged", () => {
    expect(normalizeGatewayPathname("/api/v1/enterprise/balance/")).toBe(
      "/api/v1/enterprise/balance/",
    );
  });

  it("prefixes mounted-relative paths", () => {
    expect(normalizeGatewayPathname("/enterprise/balance/")).toBe("/api/v1/enterprise/balance/");
  });
});
