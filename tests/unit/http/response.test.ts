import { describe, expect, it } from "bun:test";
import { envelope, statusForHttpCode } from "../../../src/http/response.ts";

describe("statusForHttpCode", () => {
  it("maps 2xx to success status", () => {
    expect(statusForHttpCode(200)).toBe(1);
    expect(statusForHttpCode(201)).toBe(1);
    expect(statusForHttpCode(299)).toBe(1);
  });

  it("maps 4xx and 5xx to failure status", () => {
    expect(statusForHttpCode(400)).toBe(0);
    expect(statusForHttpCode(401)).toBe(0);
    expect(statusForHttpCode(402)).toBe(0);
    expect(statusForHttpCode(500)).toBe(0);
  });

  it("maps other codes to zero", () => {
    expect(statusForHttpCode(100)).toBe(0);
    expect(statusForHttpCode(301)).toBe(0);
    expect(statusForHttpCode(599)).toBe(0);
  });
});

describe("envelope", () => {
  it("wraps payload with derived status", () => {
    expect(envelope(201, "Created", { id: "1" })).toEqual({
      status: 1,
      message: "Created",
      data: { id: "1" },
    });
  });

  it("uses failure status for error HTTP codes", () => {
    expect(envelope(403, "Nope", { error: "forbidden" })).toEqual({
      status: 0,
      message: "Nope",
      data: { error: "forbidden" },
    });
  });
});
