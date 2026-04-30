import { describe, expect, it } from "bun:test";
import { signAccessJwt, verifyAccessJwt } from "../../../src/auth/jwt.ts";

const secret =
  "12345678901234567890123456789012 satisfies minimum length for JWT_SECRET in gateway";

describe("signAccessJwt / verifyAccessJwt", () => {
  it("round-trips a valid token", async () => {
    const { token, jti } = await signAccessJwt({
      consumerId: "c1",
      scopes: ["*"],
      secret,
      expiresInHours: 1,
    });
    const payload = await verifyAccessJwt(token, secret);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("c1");
    expect(payload?.scope).toEqual(["*"]);
    expect(payload?.jti).toBe(jti);
  });

  it("rejects malformed token", async () => {
    expect(await verifyAccessJwt("not-a-jwt", secret)).toBeNull();
    expect(await verifyAccessJwt("a.b", secret)).toBeNull();
  });

  it("rejects expired token", async () => {
    const { token } = await signAccessJwt({
      consumerId: "c1",
      scopes: [],
      secret,
      expiresInHours: -1,
    });
    expect(await verifyAccessJwt(token, secret)).toBeNull();
  });

  it("rejects wrong secret", async () => {
    const { token } = await signAccessJwt({
      consumerId: "c1",
      scopes: [],
      secret,
      expiresInHours: 1,
    });
    expect(await verifyAccessJwt(token, `${secret}x`)).toBeNull();
  });
});
