import { describe, expect, it } from "bun:test";
import { requireDatabaseUrlFromEnv } from "../../../src/db/databaseUrl.ts";

/** Repo root (`gateway/`): this file lives at `gateway/tests/unit/db/`. */
const gatewayRoot = `${import.meta.dir}/../../..`;

describe("requireDatabaseUrlFromEnv", () => {
  it("returns trimmed DATABASE_URL when set", () => {
    const saved = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "  postgresql://u:p@localhost:5432/db  ";
      expect(requireDatabaseUrlFromEnv()).toBe("postgresql://u:p@localhost:5432/db");
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });

  /**
   * Error path runs in a child process so we never unset DATABASE_URL in the main test runner
   * (avoids races with integration tests when Bun runs files concurrently).
   */
  it("throws when DATABASE_URL is empty in a subprocess", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `import { requireDatabaseUrlFromEnv } from "./src/db/databaseUrl.ts";
        try {
          requireDatabaseUrlFromEnv();
          process.exit(2);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("DATABASE_URL")) process.exit(3);
          process.exit(0);
        }`,
      ],
      {
        cwd: gatewayRoot,
        stdout: "ignore",
        stderr: "pipe",
        env: { ...process.env, DATABASE_URL: "" },
      },
    );
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(err).toBe("");
  });
});
