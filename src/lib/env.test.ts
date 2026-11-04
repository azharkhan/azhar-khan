import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const previous = process.env.LOAD_ENV_TEST;
afterEach(() => {
  if (previous === undefined) delete process.env.LOAD_ENV_TEST;
  else process.env.LOAD_ENV_TEST = previous;
});

describe("loadEnv", () => {
  it("reads a local .env and gives process.env precedence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "azharkhan-env-"));
    try {
      writeFileSync(join(cwd, ".env"), "LOCAL_ONLY=from-file\nLOAD_ENV_TEST=from-file\n");
      process.env.LOAD_ENV_TEST = "from-process";
      expect(loadEnv(cwd)).toMatchObject({
        LOCAL_ONLY: "from-file",
        LOAD_ENV_TEST: "from-process",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("works when there is no local .env", () => {
    const cwd = mkdtempSync(join(tmpdir(), "azharkhan-env-"));
    try {
      expect(loadEnv(cwd).LOAD_ENV_TEST).toBe(previous);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
