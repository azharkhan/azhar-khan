import type { Garden } from "./build";

export const GARDEN = "/garden/";

export function pursuitPath(id: string): string {
  return `${GARDEN}${id}/`;
}

export type EntryPath = { pursuit: string; slug: string; path: string };

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function entrySlug(id: string): string {
  const slug = id.split("/").at(-1)!.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return slug || "entry";
}

export function entryPaths(garden: Pick<Garden, "entries">): Map<string, EntryPath> {
  const groups = new Map<string, typeof garden.entries>();
  for (const entry of garden.entries) {
    const pursuit = entry.pursuits[0]!;
    const group = groups.get(pursuit) ?? [];
    group.push(entry);
    groups.set(pursuit, group);
  }

  const paths = new Map<string, EntryPath>();
  for (const [pursuit, entries] of groups) {
    const used = new Set<string>();
    for (const entry of [...entries].sort((a, b) => compareId(a.id, b.id))) {
      const base = entrySlug(entry.id);
      let slug = base;
      let suffix = 2;
      while (used.has(slug)) slug = `${base}-${suffix++}`;
      used.add(slug);
      paths.set(entry.id, { pursuit, slug, path: `${pursuitPath(pursuit)}${slug}/` });
    }
  }
  return paths;
}

export function entryPath(paths: ReturnType<typeof entryPaths>, id: string): string {
  const result = paths.get(id);
  if (!result) throw new Error(`unknown garden entry: ${id}`);
  return result.path;
}
