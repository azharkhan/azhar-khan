import type { Adapter } from "../garden/feeds";
import { bgg } from "./bgg";
import { hardcover } from "./hardcover";
import { listenbrainz } from "./listenbrainz";
import { letterboxd } from "./letterboxd";
import { retroachievements } from "./retroachievements";

export const adapters: Adapter[] = [
  letterboxd,
  bgg,
  hardcover,
  retroachievements,
  listenbrainz,
];
