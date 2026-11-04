import { describe, expect, it } from "vitest";
import { FILTERS, gameLine, pickGame, playedText, playersText, rollFace, type Game } from "./toys";

const games: Game[] = [
  { name: "Two", minPlayers: 2, maxPlayers: 2, minutes: 30, plays: 0 },
  { name: "Range", minPlayers: 2, maxPlayers: 4, minutes: 45, plays: 1 },
  { name: "One to four", minPlayers: 1, maxPlayers: 4, minutes: 46, plays: 9 },
  { name: "Three to five", minPlayers: 3, maxPlayers: 5, minutes: 60, plays: 3 },
];

describe("die filters", () => {
  it("keeps games that include two players", () => {
    expect(games.filter(FILTERS.two).map((game) => game.name)).toEqual(["Two", "Range", "One to four"]);
  });

  it("includes exactly 45 minutes in quick and keeps all for any", () => {
    expect(games.filter(FILTERS.quick).map((game) => game.minutes)).toEqual([30, 45]);
    expect(games.filter(FILTERS.any)).toEqual(games);
  });
});

describe("die selection", () => {
  it("handles empty pools and the range boundaries", () => {
    expect(pickGame([])).toBeUndefined();
    expect(pickGame(games, () => 0)).toBe(games[0]);
    expect(pickGame(games, () => 0.999999)).toBe(games.at(-1));
  });

  it("biases selection toward unplayed games", () => {
    const pool = [games[0]!, games[2]!];
    let unplayed = 0;
    for (let i = 0; i < 1100; i++) {
      if (pickGame(pool, () => i / 1100) === pool[0]) unplayed++;
    }
    expect(unplayed).toBeGreaterThanOrEqual(999);
    expect(unplayed).toBeLessThanOrEqual(1001);
    expect(pickGame(pool, () => 0.95)).toBe(pool[1]);
  });

  it("rolls faces from one through six", () => {
    expect(rollFace(() => 0)).toBe(1);
    expect(rollFace(() => 0.9999)).toBe(6);
  });
});

describe("die copy", () => {
  it("formats player counts", () => {
    expect(playersText(2, 4)).toBe("2–4 players");
    expect(playersText(2, 2)).toBe("2 players");
    expect(playersText(1, 1)).toBe("1 player");
    expect(playersText(1, 100)).toBe("1–lots of players");
  });

  it("formats played counts", () => {
    expect(playedText(0)).toBe("You’ve played it 0 times.");
    expect(playedText(1)).toBe("You’ve played it once.");
    expect(playedText(14)).toBe("You’ve played it 14 times.");
  });

  it("formats a game line", () => {
    expect(gameLine({ name: "Brass: Birmingham", minPlayers: 2, maxPlayers: 4, minutes: 120, plays: 0 })).toEqual({
      name: "Brass: Birmingham",
      rest: ". 2–4 players, 120 min. You’ve played it 0 times.",
    });
  });
});
