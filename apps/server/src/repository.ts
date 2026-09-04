/** Persistence contracts for durable identities, match metadata, and results. */

import type { HubMatchDefinition } from "@battleship/contracts";
import type {
  BotDifficulty,
  CompletionReason,
  GameMode,
  Seat,
  SeatDescriptor,
} from "@battleship/game-domain";

export type MatchSource = "standalone" | "hub";
export type MatchPhase = "placement" | "battle" | "completed";
export type MatchOutcome = "win" | "loss" | "premature";
export type PlayerIdentitySource = "standalone" | "hub";

/** Durable identity used for match-history attribution, never seat access. */
export type PlayerIdentity = Readonly<{
  source: PlayerIdentitySource;
  externalId: string;
}>;

export type StoredPlayer = Readonly<{
  id: string;
  identity: PlayerIdentity;
}>;

export type StoredHumanSeat = Readonly<{
  seat: Seat;
  kind: "human";
  name: string;
  player: StoredPlayer;
  seatToken: string;
  outcome: MatchOutcome | null;
}>;

export type StoredBotSeat = Readonly<{
  seat: Seat;
  kind: "bot";
  name: string;
  difficulty: BotDifficulty;
  outcome: MatchOutcome | null;
}>;

export type StoredSeat = StoredHumanSeat | StoredBotSeat;

/** Expected persistence conflict surfaced through the lifecycle HTTP API. */
export class RepositoryError extends Error {
  public constructor(
    public readonly code:
      | "already_participating"
      | "match_not_found"
      | "match_closed"
      | "match_full",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

/** Complete durable metadata needed to create an in-memory session. */
export type StoredMatch = Readonly<{
  id: string;
  hubMatchId: string | null;
  hubRequest: HubMatchDefinition | null;
  source: MatchSource;
  mode: GameMode;
  phase: MatchPhase;
  seats: readonly [StoredSeat, StoredSeat | null];
  winnerSeat: Seat | null;
  terminalReason: CompletionReason | null;
  createdAt: Date;
  startedAt: Date | null;
  updatedAt: Date;
  completedAt: Date | null;
}>;

export type CreateStoredSeatInput =
  | Readonly<{
      seat: Seat;
      kind: "human";
      name: string;
      identity: PlayerIdentity;
      seatToken: string;
    }>
  | Readonly<{
      seat: Seat;
      kind: "bot";
      name: string;
      difficulty: BotDifficulty;
    }>;

export type CreateStoredMatchInput = Readonly<{
  id: string;
  hubMatchId: string | null;
  hubRequest: HubMatchDefinition | null;
  source: MatchSource;
  mode: GameMode;
  seats: readonly [CreateStoredSeatInput, CreateStoredSeatInput | null];
}>;

export type CompleteStoredMatchInput = Readonly<{
  matchId: string;
  winnerSeat: Seat | null;
  reason: CompletionReason;
}>;

/** Convert persistence metadata into the framework-free participant shape. */
export function domainDescriptor(seat: StoredSeat): SeatDescriptor {
  return seat.kind === "bot"
    ? { kind: "bot", difficulty: seat.difficulty }
    : { kind: "human" };
}

/** Durable operations required by session and lifecycle orchestration. */
export type MatchRepository = Readonly<{
  checkReady: () => Promise<void>;
  createMatch: (input: CreateStoredMatchInput) => Promise<StoredMatch>;
  findMatch: (matchId: string) => Promise<StoredMatch | null>;
  findHubMatch: (hubMatchId: string) => Promise<StoredMatch | null>;
  joinMatch: (
    matchId: string,
    identity: PlayerIdentity,
    seatToken: string,
  ) => Promise<StoredMatch>;
  markBattleStarted: (matchId: string) => Promise<void>;
  touchMatch: (matchId: string) => Promise<void>;
  completeMatch: (input: CompleteStoredMatchInput) => Promise<StoredMatch>;
  abortNonterminalMatches: () => Promise<readonly StoredMatch[]>;
  close: () => Promise<void>;
}>;

/** Derive ordered per-seat outcomes from the terminal winner. */
export function terminalOutcomes(
  winnerSeat: Seat | null,
): readonly [MatchOutcome, MatchOutcome] {
  if (winnerSeat === null) return ["premature", "premature"];
  return winnerSeat === 1 ? ["win", "loss"] : ["loss", "win"];
}
