import type { Adapter } from "../garden/feeds";
import { bgg } from "./bgg";
import { crosspoint } from "./crosspoint";
import { lastfm } from "./lastfm";
import { letterboxd } from "./letterboxd";
import { retroachievements } from "./retroachievements";

export const adapters: Adapter[] = [
  letterboxd,
  bgg,
  crosspoint,
  retroachievements,
  lastfm,
];
