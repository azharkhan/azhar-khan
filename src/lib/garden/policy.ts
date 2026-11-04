import type { Env } from "../now";

export type FeedsSetting = "auto" | "fixtures" | "off";
export type FeedMode = "live" | "fixture" | "off";
export type PolicyContext = { env: Env; dev: boolean };
export type Gate = { env: readonly string[]; realFixture?: boolean };

export function feedsSetting(env: Env): FeedsSetting {
  const value = env.FEEDS || "auto";
  if (value === "auto" || value === "fixtures" || value === "off") return value;
  throw new Error(`Invalid FEEDS setting: ${value}`);
}

export function missingVars(gate: Gate, env: Env): string[] {
  return gate.env.filter((name) => !env[name]);
}

export function fallbackMode(gate: Gate, ctx: PolicyContext): "fixture" | "off" {
  return ctx.dev || gate.realFixture ? "fixture" : "off";
}

export function feedMode(gate: Gate, ctx: PolicyContext): FeedMode {
  const setting = feedsSetting(ctx.env);
  if (setting === "off") return "off";
  if (setting === "fixtures") return "fixture";
  if (missingVars(gate, ctx.env).length === 0) return "live";
  return ctx.dev ? "fixture" : fallbackMode(gate, ctx);
}

export function includeSamples(ctx: PolicyContext): boolean {
  return ctx.dev || feedsSetting(ctx.env) === "fixtures";
}
