/** Match aggregate and phase transitions for every human and bot action. */

import { BattleBoard, type ShotOutcome } from "./board";
import { ValidatedFleet } from "./fleet";
import { chooseBotTarget } from "./agent";
import {
  shotsPerTurn,
  retainsTurn,
  type GameRules,
  CLASSIC_RULESET,
} from "./rules";
import type { RandomSource } from "./random";
import {
  otherSeat,
  seatIndex,
  type Coordinate,
  type DomainError,
  type DomainResult,
  type GameMode,
  type Seat,
  type SeatDescriptor,
  type ShipPlacement,
} from "./types";

/** Stable terminal reasons persisted and reported to external hubs. */
export type CompletionReason =
  | "fleet_destroyed"
  | "no_players_connected"
  | "server_restart"
  | "placement_expired"
  | "battle_expired";

export type PlacementSeatState = Readonly<{
  descriptor: SeatDescriptor;
  ready: boolean;
  board: BattleBoard | null;
}>;

/** State before both immutable fleets have been accepted. */
export type PlacementState = Readonly<{
  phase: "placement";
  seats: readonly [PlacementSeatState, PlacementSeatState];
}>;

/** Active battle state with exactly two accepted boards. */
export type BattleState = Readonly<{
  phase: "battle";
  descriptors: readonly [SeatDescriptor, SeatDescriptor];
  boards: readonly [BattleBoard, BattleBoard];
  turnSeat: Seat;
  shotsRemaining: number;
  lastShot: LastShot | null;
}>;

export type LastShot = Readonly<{
  shooter: Seat;
  coordinate: Coordinate;
}>;

/** Terminal state; boards are absent when battle never began. */
export type CompletedState = Readonly<{
  phase: "completed";
  descriptors: readonly [SeatDescriptor, SeatDescriptor];
  boards: readonly [BattleBoard, BattleBoard] | null;
  winnerSeat: Seat | null;
  reason: CompletionReason;
  lastShot: LastShot | null;
}>;

/** Exhaustive authoritative state; each phase contains only valid fields. */
export type MatchState = PlacementState | BattleState | CompletedState;

export type ReadyOutcome = Readonly<{
  bothReady: boolean;
}>;

export type MatchShotOutcome = ShotOutcome &
  Readonly<{
    shooter: Seat;
    retainedTurn: boolean;
    completed: boolean;
  }>;

function error(
  code: DomainError["code"],
  message: string,
): DomainResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Stateful aggregate that prevents invalid phase combinations by construction.
 *
 * The class is synchronous. A MatchSession serializes calls and manages all
 * clocks and I/O, leaving this type concerned only with game semantics.
 */
export class Match {
  private state: MatchState;

  public constructor(
    public readonly id: string,
    public readonly mode: GameMode,
    descriptors: readonly [SeatDescriptor, SeatDescriptor],
    public readonly rules: GameRules = CLASSIC_RULESET,
  ) {
    this.state = {
      phase: "placement",
      seats: [
        { descriptor: descriptors[0], ready: false, board: null },
        { descriptor: descriptors[1], ready: false, board: null },
      ],
    };
  }

  /** Return the current discriminated phase state for projection construction. */
  public getState(): MatchState {
    return this.state;
  }

  /** Claim a standalone match's open seat before that seat submits a fleet. */
  public claimOpenSeat(
    seat: Seat,
    descriptor: Extract<SeatDescriptor, { kind: "human" }>,
  ): DomainResult<PlacementSeatState> {
    if (this.state.phase !== "placement") {
      return error(
        "invalid_phase",
        "Seats can only be claimed during placement.",
      );
    }

    const index = seatIndex(seat);
    const current = this.state.seats[index];
    if (current.descriptor.kind !== "open") {
      return error(
        "invalid_phase",
        "This match seat has already been claimed.",
      );
    }

    const updated: PlacementSeatState = { ...current, descriptor };
    const seats = [...this.state.seats] as [
      PlacementSeatState,
      PlacementSeatState,
    ];
    seats[index] = updated;
    this.state = { phase: "placement", seats };
    return { ok: true, value: updated };
  }

  /** Validate and irreversibly accept one player's complete fleet. */
  public readyPlayer(
    seat: Seat,
    placements: readonly ShipPlacement[],
  ): DomainResult<ReadyOutcome> {
    if (this.state.phase !== "placement") {
      return error(
        "invalid_phase",
        "Fleet readiness is only valid during placement.",
      );
    }

    const index = seatIndex(seat);
    const current = this.state.seats[index];
    if (current.descriptor.kind === "open") {
      return error("invalid_phase", "An open seat cannot submit a fleet.");
    }
    if (current.ready) {
      return error(
        "already_ready",
        "This seat has already submitted its fleet.",
      );
    }

    const fleetResult = ValidatedFleet.create(placements, this.rules);
    if (!fleetResult.ok) {
      return fleetResult;
    }

    const updatedSeat: PlacementSeatState = {
      ...current,
      ready: true,
      board: new BattleBoard(fleetResult.value, this.rules, `seat-${seat}`),
    };
    const seats = [...this.state.seats] as [
      PlacementSeatState,
      PlacementSeatState,
    ];
    seats[index] = updatedSeat;
    this.state = { phase: "placement", seats };

    return {
      ok: true,
      value: { bothReady: seats.every(({ ready }) => ready) },
    };
  }

  /** Start battle after both accepted fleets are available. Seat one starts. */
  public startBattle(): DomainResult<BattleState> {
    if (this.state.phase !== "placement") {
      return error("invalid_phase", "Battle can only start from placement.");
    }

    const [first, second] = this.state.seats;
    if (!first.ready || !second.ready || !first.board || !second.board) {
      return error(
        "not_ready",
        "Both seats must be ready before battle starts.",
      );
    }

    this.state = {
      phase: "battle",
      descriptors: [first.descriptor, second.descriptor],
      boards: [first.board, second.board],
      turnSeat: 1,
      shotsRemaining: shotsPerTurn(this.mode),
      lastShot: null,
    };
    return { ok: true, value: this.state };
  }

  /**
   * Apply one player-selected shot and advance the configured turn policy.
   *
   * @param seat - Seat issuing the command.
   * @param coordinate - Zero-based opponent-board target.
   * @returns The resolved shot, or an expected error with state unchanged.
   */
  public shoot(
    seat: Seat,
    coordinate: Coordinate,
  ): DomainResult<MatchShotOutcome> {
    if (this.state.phase !== "battle") {
      return error("invalid_phase", "Shots are only valid during battle.");
    }
    if (this.state.turnSeat !== seat) {
      return error(
        "not_your_turn",
        "This seat cannot shoot during the opponent's turn.",
      );
    }

    const targetSeat = otherSeat(seat);
    const targetBoard = this.state.boards[seatIndex(targetSeat)];
    const shotResult = targetBoard.shoot(coordinate);
    if (!shotResult.ok) {
      return shotResult;
    }

    if (targetBoard.allShipsSunk) {
      const completed: CompletedState = {
        phase: "completed",
        descriptors: this.state.descriptors,
        boards: this.state.boards,
        winnerSeat: seat,
        reason: "fleet_destroyed",
        lastShot: { shooter: seat, coordinate },
      };
      this.state = completed;
      return {
        ok: true,
        value: {
          ...shotResult.value,
          shooter: seat,
          retainedTurn: false,
          completed: true,
        },
      };
    }

    const shotsRemaining = this.state.shotsRemaining - 1;
    const keepTurn = retainsTurn(
      this.mode,
      shotResult.value.hit,
      shotsRemaining,
    );
    this.state = {
      ...this.state,
      turnSeat: keepTurn ? seat : targetSeat,
      shotsRemaining: keepTurn
        ? Math.max(1, shotsRemaining)
        : shotsPerTurn(this.mode),
      lastShot: { shooter: seat, coordinate },
    };
    return {
      ok: true,
      value: {
        ...shotResult.value,
        shooter: seat,
        retainedTurn: keepTurn,
        completed: false,
      },
    };
  }

  /** Take a uniformly random legal shot for an absent or timed-out human. */
  public takeAutomaticShot(
    seat: Seat,
    random: RandomSource,
  ): DomainResult<MatchShotOutcome> {
    if (this.state.phase !== "battle") {
      return error(
        "invalid_phase",
        "Automatic shots require an active battle.",
      );
    }
    const coordinateResult =
      this.state.boards[seatIndex(otherSeat(seat))].randomLegalTarget(random);
    return coordinateResult.ok
      ? this.shoot(seat, coordinateResult.value)
      : coordinateResult;
  }

  /** Take a probability-density shot for a declared bot seat. */
  public takeBotShot(
    seat: Seat,
    random: RandomSource,
  ): DomainResult<MatchShotOutcome> {
    if (this.state.phase !== "battle") {
      return error("invalid_phase", "Bot shots require an active battle.");
    }
    const descriptor = this.state.descriptors[seatIndex(seat)];
    if (descriptor.kind !== "bot") {
      return error("invalid_phase", "Bot shots require a bot-controlled seat.");
    }
    const targetBoard = this.state.boards[seatIndex(otherSeat(seat))];
    const coordinate = chooseBotTarget(
      targetBoard.opponentKnowledge(),
      descriptor.difficulty,
      random,
    );
    return this.shoot(seat, coordinate);
  }

  /** Complete a nonterminal match without a winner. */
  public abort(
    reason: Exclude<CompletionReason, "fleet_destroyed">,
  ): CompletedState {
    if (this.state.phase === "completed") {
      return this.state;
    }

    if (this.state.phase === "battle") {
      this.state = {
        phase: "completed",
        descriptors: this.state.descriptors,
        boards: this.state.boards,
        winnerSeat: null,
        reason,
        lastShot: this.state.lastShot,
      };
      return this.state;
    }

    this.state = {
      phase: "completed",
      descriptors: [
        this.state.seats[0].descriptor,
        this.state.seats[1].descriptor,
      ],
      boards: null,
      winnerSeat: null,
      reason,
      lastShot: null,
    };
    return this.state;
  }
}
