export const ZONE = "America/Toronto";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayMonth(date: Date, timeZone = ZONE): string {
  const parts = new Intl.DateTimeFormat("en", { day: "numeric", month: "numeric", timeZone }).formatToParts(date);
  const day = Number(parts.find((part) => part.type === "day")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  return `${day} ${MONTHS[month - 1]}`;
}

export function yearOf(date: Date, timeZone = ZONE): number {
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).formatToParts(date)
    .find((part) => part.type === "year")!.value;
  return Number(year);
}

export function longDate(date: Date, timeZone = ZONE): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone });
}

export function shortDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
