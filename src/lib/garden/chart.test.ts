import { describe, expect, it } from "vitest";
import { chartModel } from "./chart";
import type { StatSeries } from "./query";

function series(values: number[], dates = ["2026-10-20", "2026-10-25", "2026-10-30"]): StatSeries {
  return {
    pursuit: "cubing",
    label: "ao5",
    unit: "s",
    points: values.map((value, index) => ({
      at: new Date(dates[index]!),
      value,
      entryId: `sample/${index + 1}`,
    })),
  };
}

describe("chartModel", () => {
  it("maps ao5 values across time and value space", () => {
    const model = chartModel(series([24.1, 22.8, 21.9]));
    expect(model.points[0]!.x).toBe(12);
    expect(model.points[2]!.x).toBe(548);
    expect(model.points[0]!.x).toBeLessThan(model.points[1]!.x);
    expect(model.points[1]!.x).toBeLessThan(model.points[2]!.x);
    expect(model.points[0]!.y).toBeLessThan(model.points[1]!.y);
    expect(model.points[1]!.y).toBeLessThan(model.points[2]!.y);
    expect(model.path.startsWith("M ")).toBe(true);
    expect(model.path.match(/[ML] [\d.]+ [\d.]+/g)).toHaveLength(3);
    expect(model.min).toBe(21.9);
    expect(model.max).toBe(24.1);
  });

  it("centres an equal-value series in a flat line", () => {
    const model = chartModel(series([5, 5, 5]));
    expect(new Set(model.points.map((point) => point.y))).toEqual(new Set([80]));
    expect(model.points.every((point) => point.y >= 12 && point.y <= 148)).toBe(true);
  });

  it("spaces equal dates evenly and never emits NaN", () => {
    const sameDay = ["2026-10-20", "2026-10-20", "2026-10-20"];
    const model = chartModel(series([24.1, 22.8, 21.9], sameDay));
    expect(new Set(model.points.map((point) => point.x)).size).toBe(3);
    expect(model.path).not.toContain("NaN");
    expect(model.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });
});
