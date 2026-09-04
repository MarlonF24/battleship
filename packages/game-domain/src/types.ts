/** Shared value types used by the framework-independent Battleship domain. */

/** Supported declarative turn policies. */
export const GAME_MODES = ["singleShot", "salvo", "streak"] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** Hub-selectable strengths for computer-controlled seats. */
export const BOT_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

/** Orientations valid for every straight ship placement. */
export const ORIENTATIONS = ["horizontal", "vertical"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export type Seat = 1 | 2;

/** Zero-based board coordinate. */
export type Coordinate = Readonly<{
  row: number;
  column: number;
}>;

/** Head coordinate, length, and direction of one straight ship. */
export type ShipPlacement = Readonly<{
  length: number;
  orientation: Orientation;
  headRow: number;
  headColumn: number;
}>;

export type HumanSeatDescriptor = Readonly<{
  kind: "human";
}>;

export type BotSeatDescriptor = Readonly<{
  kind: "bot";
  difficulty: BotDifficulty;
}>;

export type OpenSeatDescriptor = Readonly<{
  kind: "open";
}>;

/** Participant kind needed by game rules, intentionally excluding identity. */
export type SeatDescriptor =
  HumanSeatDescriptor | BotSeatDescriptor | OpenSeatDescriptor;

/** Stable semantic failures produced by expected invalid commands. */
export type DomainErrorCode =
  | "already_ready"
  | "already_shot"
  | "fleet_adjacency"
  | "fleet_bounds"
  | "fleet_composition"
  | "fleet_overlap"
  | "invalid_coordinate"
  | "invalid_phase"
  | "invalid_placement"
  | "no_legal_target"
  | "not_ready"
  | "not_your_turn";

export type DomainError = Readonly<{
  code: DomainErrorCode;
  message: string;
}>;

/** Expected command result that keeps invalid user actions out of exceptions. */
export type DomainResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: DomainError }>;

/** Return the other fixed match seat. */
export function otherSeat(seat: Seat): Seat {
  return seat === 1 ? 2 : 1;
}

/** Convert a seat number into its zero-based tuple index. */
export function seatIndex(seat: Seat): 0 | 1 {
  return seat === 1 ? 0 : 1;
}

/** Build the stable key used for coordinate maps and sets. */
export function coordinateKey({ row, column }: Coordinate): string {
  return `${row}:${column}`;
}
