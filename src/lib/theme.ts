export type Theme = "light" | "dark";
export type Override = Theme | null;

export const STORAGE_KEY = "theme";

export function parseOverride(value: string | null | undefined): Override {
  return value === "light" || value === "dark" ? value : null;
}

export function resolveTheme(override: Override, system: Theme): Theme {
  return override ?? system;
}

export function nextOverride(override: Override, system: Theme): Override {
  const target: Theme = resolveTheme(override, system) === "dark" ? "light" : "dark";
  return target === system ? null : target;
}

export function lightsTitle(override: Override, system: Theme): string {
  const label = resolveTheme(override, system) === "dark" ? "Lights up" : "Lights down";
  return nextOverride(override, system) === null ? `${label} (back to your system setting)` : label;
}
