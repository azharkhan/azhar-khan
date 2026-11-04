import type { StatSeries } from "./query";

export type ChartModel = {
  width: number;
  height: number;
  path: string;
  points: { x: number; y: number; value: number; at: Date; entryId: string }[];
  min: number;
  max: number;
  first: Date;
  last: Date;
};

export function chartModel(series: StatSeries, size = { width: 560, height: 160, pad: 12 }): ChartModel {
  if (series.points.length === 0) throw new Error("chart needs at least one point");

  const values = series.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = series.points[0]!.at;
  const last = series.points.at(-1)!.at;
  const firstTime = first.getTime();
  const lastTime = last.getTime();
  const range = max - min;
  const domainMin = min - range * 0.1;
  const domainMax = max + range * 0.1;
  const innerWidth = size.width - size.pad * 2;
  const innerHeight = size.height - size.pad * 2;
  const points = series.points.map((point, index) => {
    const time = point.at.getTime();
    const xRatio = firstTime === lastTime
      ? series.points.length === 1 ? 0.5 : index / (series.points.length - 1)
      : (time - firstTime) / (lastTime - firstTime);
    const yRatio = range === 0 ? 0.5 : (domainMax - point.value) / (domainMax - domainMin);
    return {
      x: size.pad + xRatio * innerWidth,
      y: size.pad + yRatio * innerHeight,
      value: point.value,
      at: point.at,
      entryId: point.entryId,
    };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

  return { width: size.width, height: size.height, path, points, min, max, first, last };
}
