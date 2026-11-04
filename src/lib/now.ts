export type Env = Readonly<Record<string, string | undefined>>;

export function buildNow(env: Env = process.env): Date {
  const value = env.BUILD_NOW;
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`BUILD_NOW is not a date: ${value}`);
  return date;
}
