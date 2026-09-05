/** Serialized live-match orchestration, role projections, and deadlines. */

import type { Logger } from "pino";
import type {
  BoardView as WireBoardView,
  CompletedProjection,
  MatchProjection,
  Participant,
  PlayerCommand,
  RulesView,
  ServerMessage,
} from "@battleship/contracts";
import {
  CLASSIC_RULESET,
  Match,
  generateRandomFleet,
  seatIndex,
  systemRandom,
  type GameRules,
  type BoardView,
  type RandomSource,
  type Seat,
  type SeatDescriptor,
} from "@battleship/game-domain";
import {
  domainDescriptor,
  type MatchRepository,
  type StoredMatch,
} from "../repository";
import {
  systemClock,
  systemScheduler,
  type Clock,
  type ScheduledHandle,
  type Scheduler,
} from "./runtime";

/** Framework-neutral socket operations required by a live session. */
export type SocketPeer = Readonly<{
  id: string;
  send: (message: ServerMessage) => void;
  close: (code: number, reason: string) => void;
}>;

type Deadline = Readonly<{
  kind:
    "placement" | "battleStart" | "shot" | "reconnect" | "bot" | "abandonment";
  seat: Seat | null;
  at: number;
  handle: ScheduledHandle;
}>;

/** Time allowed for a mobile player to background the game and return/share it. */
export const NO_PLAYERS_CONNECTED_GRACE_MS = 2 * 60 * 1_000;

type SessionOptions = Readonly<{
  repository: MatchRepository;
  logger: Logger;
  clock?: Clock;
  scheduler?: Scheduler;
  random?: RandomSource;
  onCompleted?: (match: StoredMatch) => void;
}>;

function descriptorsFromStoredMatch(
  stored: StoredMatch,
): readonly [SeatDescriptor, SeatDescriptor] {
  return [
    domainDescriptor(stored.seats[0]),
    stored.seats[1] ? domainDescriptor(stored.seats[1]) : { kind: "open" },
  ];
}

/** Clone immutable domain views into the mutable JSON array shape in TypeBox. */
function wireBoardView(view: BoardView): WireBoardView {
  return {
    cells: view.cells.map((row) => [...row]),
    ships: view.ships.map((ship) => ({ ...ship, hits: [...ship.hits] })),
    remainingShipLengths: [...view.remainingShipLengths],
  };
}

/**
 * Coordinate one in-memory match and all connected views.
 *
 * Every asynchronous trigger enters the same promise chain, preventing timer,
 * reconnect, and command handlers from interleaving aggregate mutations.
 */
export class MatchSession {
  private readonly match: Match;
  private readonly playerPeers = new Map<Seat, SocketPeer>();
  private readonly spectatorPeers = new Map<string, SocketPeer>();
  private readonly repository: MatchRepository;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly random: RandomSource;
  private readonly onCompleted: (match: StoredMatch) => void;
  private deadline: Deadline | null = null;
  private commandChain = Promise.resolve();
  private revision = 0;
  private completed = false;
  public lastActivityMs: number;

  public constructor(
    private stored: StoredMatch,
    options: SessionOptions,
  ) {
    this.repository = options.repository;
    this.logger = options.logger.child({ matchId: stored.id });
    this.clock = options.clock ?? systemClock;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.random = options.random ?? systemRandom;
    this.onCompleted = options.onCompleted ?? (() => undefined);
    this.lastActivityMs = this.clock.now();
    this.match = new Match(
      stored.id,
      stored.mode,
      descriptorsFromStoredMatch(stored),
    );

    // Bot fleets are generated and accepted before any human can observe state.
    ([1, 2] as const).forEach((seat) => {
      const descriptor = descriptorsFromStoredMatch(stored)[seatIndex(seat)];
      if (descriptor.kind === "bot") {
        const fleet = generateRandomFleet(this.random);
        if (!fleet.ok) {
          throw new Error(
            `Bot fleet generation failed: ${fleet.error.message}`,
          );
        }
        const ready = this.match.readyPlayer(seat, fleet.value.placements);
        if (!ready.ok) {
          throw new Error(`Bot readiness failed: ${ready.error.message}`);
        }
      }
    });
  }

  public get id(): string {
    return this.stored.id;
  }

  public get phase(): "placement" | "battle" | "completed" {
    return this.match.getState().phase;
  }

  /** Claim the open standalone seat after its database transaction commits. */
  public claimJoinedSeat(stored: StoredMatch): void {
    const second = stored.seats[1];
    if (second?.kind !== "human") {
      throw new Error("A joined standalone match must contain human seat two.");
    }
    const result = this.match.claimOpenSeat(2, { kind: "human" });
    if (!result.ok && result.error.code !== "invalid_phase") {
      throw new Error(result.error.message);
    }
    this.stored = stored;
    this.logger.info({ seat: 2 }, "Open match seat joined");
    this.bumpAndPublish();
    this.scheduleForCurrentState();
  }

  /** Attach a player connection after resolving its match-scoped seat token. */
  public connectPlayer(seatToken: string, peer: SocketPeer): boolean {
    const seat = this.findSeatByToken(seatToken);
    if (!seat) {
      this.logger.warn({ peerId: peer.id }, "Invalid player socket rejected");
      peer.close(1008, "This player link is not valid for the match.");
      return false;
    }

    const previous = this.playerPeers.get(seat);
    if (previous?.id && previous.id !== peer.id) {
      this.logger.info(
        { seat, previousPeerId: previous.id, peerId: peer.id },
        "Player socket replaced",
      );
      previous.close(1008, "A newer connection replaced this player socket.");
    }
    this.playerPeers.set(seat, peer);
    this.logger.info({ seat, peerId: peer.id }, "Player socket connected");
    this.lastActivityMs = this.clock.now();

    this.serialise(() => {
      if (this.deadline?.kind === "abandonment") this.cancelDeadline();
      this.bumpAndPublish();
      this.scheduleForCurrentState();
    });
    return true;
  }

  /** Attach a public read-only spectator connection for this match. */
  public connectSpectator(peer: SocketPeer): void {
    this.spectatorPeers.set(peer.id, peer);
    this.logger.debug(
      { peerId: peer.id, spectatorCount: this.spectatorPeers.size },
      "Spectator socket connected",
    );
    this.serialise(() => this.bumpAndPublish());
  }

  /** Remove exactly the socket that closed, preserving any replacement. */
  public disconnectPlayer(seatToken: string, peerId: string): void {
    const seat = this.findSeatByToken(seatToken);
    if (!seat || this.playerPeers.get(seat)?.id !== peerId) {
      return;
    }
    this.playerPeers.delete(seat);
    this.logger.info({ seat, peerId }, "Player socket disconnected");
    this.lastActivityMs = this.clock.now();

    this.serialise(() => {
      this.bumpAndPublish();
      const state = this.match.getState();
      if (!this.hasConnectedHumanPlayer()) {
        this.setDeadline("abandonment", null, NO_PLAYERS_CONNECTED_GRACE_MS);
        return;
      }
      if (state.phase === "battle" && state.turnSeat === seat) {
        this.scheduleTurn();
      }
    });
  }

  public disconnectSpectator(peerId: string): void {
    if (this.spectatorPeers.delete(peerId)) {
      this.logger.debug(
        { peerId, spectatorCount: this.spectatorPeers.size },
        "Spectator socket disconnected",
      );
      this.serialise(() => this.bumpAndPublish());
    }
  }

  /** Submit one structurally validated player command to the serial chain. */
  public dispatch(seatToken: string, command: PlayerCommand): void {
    this.serialise(async () => {
      const seat = this.findSeatByToken(seatToken);
      if (!seat) {
        return;
      }

      if (command.type === "ready") {
        const result = this.match.readyPlayer(seat, command.fleet);
        if (!result.ok) {
          this.rejectCommand(seat, command.requestId, result.error);
          return;
        }

        this.lastActivityMs = this.clock.now();
        await this.repository.touchMatch(this.id);
        this.logger.info({ seat }, "Player fleet accepted");
        this.bumpAndPublish();
        if (result.value.bothReady) {
          this.setDeadline(
            "battleStart",
            null,
            CLASSIC_RULESET.battleStartDelayMs,
          );
        } else {
          this.schedulePlacementForWaitingSeat();
        }
        return;
      }

      const result = this.match.shoot(seat, {
        row: command.row,
        column: command.column,
      });
      if (!result.ok) {
        this.rejectCommand(seat, command.requestId, result.error);
        return;
      }

      this.lastActivityMs = this.clock.now();
      await this.repository.touchMatch(this.id);
      this.logger.debug(
        { seat, row: command.row, column: command.column },
        "Player shot accepted",
      );
      await this.afterShot();
    });
  }

  /** Abort an idle session and publish the same terminal result as other endings. */
  public abortForIdleTimeout(): void {
    this.serialise(async () => {
      const reason =
        this.phase === "placement" ? "placement_expired" : "battle_expired";
      await this.completePremature(reason);
    });
  }

  /** Close sockets during server shutdown without pretending they completed. */
  public closeForShutdown(): void {
    this.logger.info("Closing session for server shutdown");
    this.cancelDeadline();
    this.closePeers(
      1012,
      "Server is restarting; this match cannot be resumed.",
    );
  }

  private findSeatByToken(seatToken: string): Seat | null {
    const index = this.stored.seats.findIndex(
      (seat) => seat?.kind === "human" && seat.seatToken === seatToken,
    );
    return index === 0 ? 1 : index === 1 ? 2 : null;
  }

  private descriptors(): readonly [SeatDescriptor, SeatDescriptor] {
    const state = this.match.getState();
    return state.phase === "placement"
      ? [state.seats[0].descriptor, state.seats[1].descriptor]
      : state.descriptors;
  }

  private rejectCommand(
    seat: Seat,
    requestId: string,
    error: Readonly<{ code: string; message: string }>,
  ): void {
    this.logger.debug(
      { seat, requestId, commandError: error.code },
      "Player command rejected",
    );
    this.playerPeers.get(seat)?.send({
      type: "commandRejected",
      requestId,
      code: error.code,
      message: error.message,
      revision: this.revision,
    });
  }

  private serialise(action: () => void | Promise<void>): void {
    // Append every command, timer, and connection transition to one chain. This
    // is the session's concurrency boundary and keeps the domain synchronous.
    const next = this.commandChain.then(action);
    this.commandChain = next.catch((cause: unknown) => {
      this.logger.error({ err: cause }, "Match session action failed");
      this.closePeers(1011, "Unexpected server error.");
    });
  }

  private setDeadline(
    kind: Deadline["kind"],
    seat: Seat | null,
    delayMs: number,
  ): void {
    // A session has exactly one meaningful timer. Replacing it first prevents a
    // stale shot/reconnect callback from racing a newer phase or connection.
    this.cancelDeadline();
    const at = this.clock.now() + delayMs;
    const handle = this.scheduler.schedule(delayMs, () => {
      this.serialise(async () => this.handleDeadline(kind, seat, at));
    });
    this.deadline = { kind, seat, at, handle };
    this.bumpAndPublish();
  }

  private cancelDeadline(): void {
    if (this.deadline) {
      this.scheduler.cancel(this.deadline.handle);
      this.deadline = null;
    }
  }

  private async handleDeadline(
    kind: Deadline["kind"],
    seat: Seat | null,
    expectedAt: number,
  ): Promise<void> {
    // Match all timer identity fields because cancellation cannot recall a
    // callback that has already entered the event queue.
    if (
      this.deadline?.kind !== kind ||
      this.deadline.seat !== seat ||
      this.deadline.at !== expectedAt
    ) {
      return;
    }
    this.deadline = null;

    if (kind === "battleStart") {
      const result = this.match.startBattle();
      if (!result.ok) throw new Error(result.error.message);
      await this.repository.markBattleStarted(this.id);
      this.logger.info("Battle started");
      this.bumpAndPublish();
      this.scheduleTurn();
      return;
    }

    if (kind === "abandonment") {
      if (!this.hasConnectedHumanPlayer()) {
        await this.completePremature("no_players_connected");
      }
      return;
    }

    if (kind === "placement" && seat) {
      const fleet = generateRandomFleet(this.random);
      if (!fleet.ok) throw new Error(fleet.error.message);
      const ready = this.match.readyPlayer(seat, fleet.value.placements);
      if (!ready.ok) throw new Error(ready.error.message);
      await this.repository.touchMatch(this.id);
      this.logger.warn({ seat }, "Placement deadline generated a fleet");
      this.bumpAndPublish();
      if (ready.value.bothReady) {
        this.setDeadline(
          "battleStart",
          null,
          CLASSIC_RULESET.battleStartDelayMs,
        );
      }
      return;
    }

    if ((kind === "shot" || kind === "reconnect") && seat) {
      const result = this.match.takeAutomaticShot(seat, this.random);
      if (!result.ok) throw new Error(result.error.message);
      await this.repository.touchMatch(this.id);
      this.logger.warn({ seat, deadlineKind: kind }, "Automatic shot taken");
      this.bumpAndPublish();
      await this.afterShot();
      return;
    }

    if (kind === "bot" && seat) {
      const result = this.match.takeBotShot(seat, this.random);
      if (!result.ok) throw new Error(result.error.message);
      await this.repository.touchMatch(this.id);
      this.logger.debug({ seat }, "Bot shot taken");
      this.bumpAndPublish();
      await this.afterShot();
    }
  }

  private scheduleForCurrentState(): void {
    const state = this.match.getState();
    if (state.phase === "placement") {
      if (this.deadline?.kind !== "battleStart") {
        this.schedulePlacementForWaitingSeat();
      }
      return;
    }
    if (state.phase === "battle") this.scheduleTurn();
  }

  private schedulePlacementForWaitingSeat(): void {
    const state = this.match.getState();
    if (
      state.phase !== "placement" ||
      !state.seats.some(({ ready }) => ready)
    ) {
      return;
    }
    const waitingIndex = state.seats.findIndex(({ ready }) => !ready);
    const waitingSeat: Seat | null =
      waitingIndex === 0 ? 1 : waitingIndex === 1 ? 2 : null;
    const descriptor = waitingSeat
      ? state.seats[seatIndex(waitingSeat)].descriptor
      : null;
    if (waitingSeat && descriptor?.kind !== "open") {
      this.setDeadline(
        "placement",
        waitingSeat,
        this.match.rules.placementTimeoutMs,
      );
    }
  }

  private async afterShot(): Promise<void> {
    const state = this.match.getState();
    if (state.phase === "completed") {
      await this.persistAndClose();
      return;
    }
    if (state.phase !== "battle") {
      throw new Error(
        "Shot processing must leave the match in battle or completed state.",
      );
    }

    const hasHumanPlayer = state.descriptors.some(
      (descriptor) => descriptor.kind === "human",
    );
    if (hasHumanPlayer && !this.hasConnectedHumanPlayer()) {
      this.setDeadline("abandonment", null, NO_PLAYERS_CONNECTED_GRACE_MS);
      return;
    }
    // Installing the next action deadline also publishes the accepted shot.
    this.scheduleTurn();
  }

  private scheduleTurn(): void {
    const state = this.match.getState();
    if (state.phase !== "battle") return;
    const descriptor = state.descriptors[seatIndex(state.turnSeat)];
    // Participant kind and connection state declaratively select the only
    // possible action timer for the current seat.
    if (descriptor.kind === "bot") {
      this.setDeadline(
        "bot",
        state.turnSeat,
        this.match.rules.botActionDelayMs,
      );
    } else if (
      descriptor.kind === "human" &&
      this.playerPeers.has(state.turnSeat)
    ) {
      this.setDeadline("shot", state.turnSeat, this.match.rules.shotTimeoutMs);
    } else if (descriptor.kind === "human") {
      this.setDeadline(
        "reconnect",
        state.turnSeat,
        this.match.rules.reconnectTimeoutMs,
      );
    }
  }

  private async completePremature(
    reason: "no_players_connected" | "placement_expired" | "battle_expired",
  ): Promise<void> {
    this.logger.warn({ reason }, "Match ending prematurely");
    this.match.abort(reason);
    await this.persistAndClose();
  }

  /** Return whether at least one human seat currently has a live socket. */
  private hasConnectedHumanPlayer(): boolean {
    return ([1, 2] as const).some((seat) => {
      const descriptor = this.descriptors()[seatIndex(seat)];
      return descriptor.kind === "human" && this.playerPeers.has(seat);
    });
  }

  private async persistAndClose(): Promise<void> {
    if (this.completed) return;
    const state = this.match.getState();
    if (state.phase !== "completed") return;
    this.completed = true;
    this.cancelDeadline();

    // Persist the result before any client receives authoritative completion.
    this.stored = await this.repository.completeMatch({
      matchId: this.id,
      winnerSeat: state.winnerSeat,
      reason: state.reason,
    });
    this.logger.info(
      { reason: state.reason, winnerSeat: state.winnerSeat },
      "Match completed and persisted",
    );
    this.bumpAndPublish();
    this.closePeers(1000, "Match completed.");
    this.onCompleted(this.stored);
  }

  private bumpAndPublish(): void {
    // Full projections are cheap for a 10×10 board and let browsers replace
    // state atomically instead of reconstructing it from an event history.
    this.revision += 1;
    for (const [seat, peer] of this.playerPeers) {
      peer.send({
        type: "projection",
        projection: this.projection("player", seat),
      });
    }
    for (const peer of this.spectatorPeers.values()) {
      peer.send({
        type: "projection",
        projection: this.projection("spectator"),
      });
    }
  }

  private projection(role: "spectator"): MatchProjection;
  private projection(role: "player", seat: Seat): MatchProjection;
  private projection(
    role: "player" | "spectator",
    seat?: Seat,
  ): MatchProjection {
    const state = this.match.getState();
    const viewer =
      role === "player" && seat
        ? { role, seat }
        : { role: "spectator" as const };
    const participants = this.participants();
    const common = {
      revision: this.revision,
      serverTimeMs: this.clock.now(),
      matchId: this.id,
      mode: this.match.mode,
      rules: this.rulesView(this.match.rules),
      participants,
      viewer,
    };

    // Construct privacy at the server boundary: branches never create fields
    // the recipient should not see, rather than asking CSS to conceal them.
    if (state.phase === "placement") {
      return {
        ...common,
        phase: "placement",
        placementDeadlineMs:
          role === "player" &&
          seat &&
          this.deadline?.kind === "placement" &&
          this.deadline.seat === seat
            ? this.deadline.at
            : null,
      };
    }

    if (state.phase === "battle") {
      return {
        ...common,
        phase: "battle",
        turnSeat: state.turnSeat,
        shotsRemaining: state.shotsRemaining,
        lastShot: state.lastShot
          ? { shooter: state.lastShot.shooter, ...state.lastShot.coordinate }
          : null,
        actionDeadlineMs:
          this.deadline &&
          ["shot", "reconnect", "bot"].includes(this.deadline.kind)
            ? this.deadline.at
            : null,
        view:
          role === "player" && seat
            ? {
                kind: "player",
                seat,
                ownBoard: wireBoardView(
                  state.boards[seatIndex(seat)].ownView(),
                ),
                opponentBoard: wireBoardView(
                  state.boards[seatIndex(seat === 1 ? 2 : 1)].publicView(),
                ),
              }
            : {
                kind: "spectator",
                boards: [
                  wireBoardView(state.boards[0].publicView()),
                  wireBoardView(state.boards[1].publicView()),
                ],
              },
      };
    }

    const completedView: CompletedProjection["view"] = state.boards
      ? role === "player" && seat
        ? {
            kind: "player" as const,
            seat,
            ownBoard: wireBoardView(state.boards[seatIndex(seat)].ownView()),
            opponentBoard: wireBoardView(
              state.boards[seatIndex(seat === 1 ? 2 : 1)].publicView(),
            ),
          }
        : {
            kind: "spectator" as const,
            boards: [
              wireBoardView(state.boards[0].finalView()),
              wireBoardView(state.boards[1].finalView()),
            ],
          }
      : null;
    return {
      ...common,
      phase: "completed",
      winnerSeat: state.winnerSeat,
      reason: state.reason,
      lastShot: state.lastShot
        ? { shooter: state.lastShot.shooter, ...state.lastShot.coordinate }
        : null,
      view: completedView,
    };
  }

  private participants(): MatchProjection["participants"] {
    const state = this.match.getState();
    const descriptors = this.descriptors();
    const readiness =
      state.phase === "placement"
        ? state.seats.map(({ ready }) => ready)
        : [true, true];
    const participant = (seat: Seat): Participant => {
      const descriptor = descriptors[seatIndex(seat)];
      const storedSeat = this.stored.seats[seatIndex(seat)];
      return {
        seat,
        name: storedSeat?.name ?? `Player ${seat}`,
        descriptor,
        ready: readiness[seatIndex(seat)] ?? false,
        connected: descriptor.kind === "bot" || this.playerPeers.has(seat),
      };
    };
    return [participant(1), participant(2)];
  }

  private rulesView(rules: GameRules): RulesView {
    return {
      rows: rules.rows,
      columns: rules.columns,
      fleetLengths: [...rules.fleetLengths],
      salvoShots: rules.salvoShots,
      placementTimeoutMs: rules.placementTimeoutMs,
      shotTimeoutMs: rules.shotTimeoutMs,
      reconnectTimeoutMs: rules.reconnectTimeoutMs,
    };
  }

  private closePeers(code: number, reason: string): void {
    for (const peer of this.playerPeers.values()) peer.close(code, reason);
    for (const peer of this.spectatorPeers.values()) peer.close(code, reason);
    this.playerPeers.clear();
    this.spectatorPeers.clear();
  }
}
