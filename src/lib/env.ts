import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { Env } from "./now";

export function loadEnv(cwd = process.cwd()): Env {
  const path = join(cwd, ".env");
  const local = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  return { ...local, ...process.env };
}
