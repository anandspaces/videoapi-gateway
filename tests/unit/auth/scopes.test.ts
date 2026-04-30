import { describe, expect, it } from "bun:test";
import {
  pathUnderApiV1,
  requiredScopeForPath,
  scopesAllow,
} from "../../../src/auth/scopes.ts";

describe("pathUnderApiV1", () => {
  it("extracts suffix paths", () => {
    expect(pathUnderApiV1("/api/v1/enterprise/balance/")).toBe("/enterprise/balance/");
    expect(pathUnderApiV1("/api/v1")).toBe("/");
    expect(pathUnderApiV1("/api/v1/")).toBe("/");
  });

  it("returns null outside prefix", () => {
    expect(pathUnderApiV1("/health")).toBeNull();
  });
});

describe("requiredScopeForPath", () => {
  it("maps enterprise routes", () => {
    expect(requiredScopeForPath("/enterprise/balance/")).toBe("enterprise:balance");
    expect(requiredScopeForPath("/enterprise/users/create/")).toBe("enterprise:users:write");
    expect(requiredScopeForPath("/enterprise/users/")).toBe("enterprise:users:read");
  });

  it("maps api-2 project routes", () => {
    expect(requiredScopeForPath("/project/")).toBe("project:create");
    expect(requiredScopeForPath("/project/550e8400-e29b-41d4-a716-446655440000/")).toBe(
      "project:detail",
    );
    expect(requiredScopeForPath("/project/550e8400-e29b-41d4-a716-446655440000/progress/")).toBe(
      "project:progress:read",
    );
  });

  it("maps text-to-video routes", () => {
    expect(requiredScopeForPath("/text-to-video/voices/")).toBe("ttv:voices");
    expect(requiredScopeForPath("/text-to-video/voices/clone/")).toBe("ttv:voices:clone");
    expect(requiredScopeForPath("/text-to-video/voiceover/")).toBe("ttv:voiceover");
  });

  it("denies unknown paths", () => {
    expect(requiredScopeForPath("/unknown/")).toBeNull();
  });
});

describe("scopesAllow", () => {
  it("respects wildcard and explicit", () => {
    expect(scopesAllow("enterprise:balance", ["*"])).toBe(true);
    expect(scopesAllow("enterprise:balance", ["enterprise:balance"])).toBe(true);
    expect(scopesAllow("enterprise:balance", ["enterprise:usage"])).toBe(false);
    expect(scopesAllow(null, ["*"])).toBe(false);
  });
});
