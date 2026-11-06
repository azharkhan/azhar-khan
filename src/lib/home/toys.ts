export type Game = { name: string; minPlayers: number; maxPlayers: number; minutes: number; plays: number };
export type FilterId = "any" | "two" | "quick";

export const FILTER_IDS: readonly FilterId[] = ["any", "two", "quick"];
export const FILTER_LABELS: Record<FilterId, string> = { any: "Any", two: "2 players", quick: "Under 45 min" };
export const FILTERS: Record<FilterId, (game: Game) => boolean> = {
  any: () => true,
  two: (game) => game.minPlayers <= 2 && game.maxPlayers >= 2,
  quick: (game) => game.minutes <= 45,
};

export function pickGame(pool: readonly Game[], random: () => number = Math.random): Game | undefined {
  if (pool.length === 0) return undefined;
  const weights = pool.map((game) => 1 / (game.plays + 1));
  let r = random() * weights.reduce((total, weight) => total + weight, 0);
  for (let i = 0; i < pool.length; i++) {
    if ((r -= weights[i]!) <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function rollFace(random: () => number = Math.random): 1 | 2 | 3 | 4 | 5 | 6 {
  return (1 + Math.floor(random() * 6)) as 1 | 2 | 3 | 4 | 5 | 6;
}

export function playersText(min: number, max: number): string {
  if (min === max) return min === 1 ? "1 player" : `${min} players`;
  return `${min}–${max > 8 ? "lots of" : max} players`;
}

export function playedText(plays: number): string {
  if (plays === 0) return "I haven’t played it yet.";
  if (plays === 1) return "I’ve played it once.";
  return `I’ve played it ${plays} times.`;
}

export function gameLine(game: Game): { name: string; rest: string } {
  return {
    name: game.name,
    rest: `. ${playersText(game.minPlayers, game.maxPlayers)}, ${game.minutes} min. ${playedText(game.plays)}`,
  };
}
