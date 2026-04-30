import { describe, expect, it } from "bun:test";
import { hashApiKey, randomApiKey, randomId } from "../../../src/crypto/hash.ts";

describe("hashApiKey", () => {
  it("is deterministic for same secret and pepper", async () => {
    const a = await hashApiKey("secret", "pepper");
    const b = await hashApiKey("secret", "pepper");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when pepper changes", async () => {
    const a = await hashApiKey("secret", "pepper1");
    const b = await hashApiKey("secret", "pepper2");
    expect(a).not.toBe(b);
  });
});

describe("randomApiKey", () => {
  it("returns gw_live prefix and 12-char public prefix", () => {
    const { plaintext, prefix } = randomApiKey();
    expect(plaintext).toMatch(/^gw_live_[A-Za-z0-9_-]+$/);
    expect(prefix).toBe(plaintext.slice(0, 12));
    expect(prefix.length).toBe(12);
  });

  it("generates distinct keys", () => {
    const a = randomApiKey().plaintext;
    const b = randomApiKey().plaintext;
    expect(a).not.toBe(b);
  });
});

describe("randomId", () => {
  it("returns a UUID", () => {
    const id = randomId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
