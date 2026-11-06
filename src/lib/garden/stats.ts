export function formatDuration(value: number): string {
  const centiseconds = Math.round(value * 100);
  const minutes = Math.floor(centiseconds / 6000);
  const remainder = centiseconds % 6000;
  const wholeSeconds = Math.floor(remainder / 100);
  const fraction = remainder % 100;
  const fractionText = fraction === 0 ? "" : `.${String(fraction).padStart(2, "0").replace(/0+$/, "")}`;
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}${fractionText}`;
}

export function formatStatValue(value: number, unit?: string): string {
  if (unit === "s" && value >= 60) return formatDuration(value);
  return `${value}${unit ?? ""}`;
}

export function formatStatChange(change: number, unit?: string): string {
  const sign = change < 0 ? "−" : change > 0 ? "+" : "±";
  const value = unit === "s" ? formatDuration(Math.abs(change)) : String(Math.abs(change));
  return `${sign}${value}`;
}
