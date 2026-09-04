/** Process-local registry and idle cleanup for authoritative match sessions. */

import type { Logger } from "pino";
import type { RandomSource } from "@battleship/game-domain";
import type { MatchRepository, StoredMatch } from "../repository";
import { MatchSession } from "./match-session";
import {
  systemClock,
  systemScheduler,
  type Clock,
  type ScheduledHandle,
  type Scheduler,
} from "./runtime";

/** Maximum inactivity retained for a placement session. */
export const PLACEMENT_IDLE_TIMEOUT_MS = 10 * 60 * 1_000;
/** Maximum inactivity retained for an active battle session. */
export const BATTLE_IDLE_TIMEOUT_MS = 35 * 60 * 1_000;
const CLEANUP_INTERVAL_MS = 60 * 1_000;

type RegistryOptions = Readonly<{
  repository: MatchRepository;
  logger: Logger;
  clock?: Clock;
  scheduler?: Scheduler;
  random?: RandomSource;
  onMatchCompleted?: (match: StoredMatch) => void;
}>;

/**
 * Own all live sessions in the single server process.
 *
 * Completed sessions are removed immediately. Database rows are never used to
 * reconstruct live boards, which keeps the non-resumable lifecycle explicit.
 */
export class MatchSessionRegistry {
  private readonly sessions = new Map<string, MatchSession>();
  private readonly repository: MatchRepository;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly random: RandomSource | undefined;
  private readonly onMatchCompleted: (match: StoredMatch) => void;
  private cleanupHandle: ScheduledHandle | null = null;

  public constructor(options: RegistryOptions) {
    this.repository = options.repository;
    this.logger = options.logger;
    this.clock = options.clock ?? systemClock;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.random = options.random;
    this.onMatchCompleted = options.onMatchCompleted ?? (() => undefined);
  }

  /** Create the one authoritative session for a newly persisted match. */
  public create(match: StoredMatch): MatchSession {
    if (match.phase !== "placement") {
      throw new Error(
        "Only newly created placement matches can enter the registry.",
      );
    }
    if (this.sessions.has(match.id)) {
      throw new Error(`Match ${match.id} already has a live session.`);
    }

    const session = new MatchSession(match, {
      repository: this.repository,
      logger: this.logger,
      clock: this.clock,
      scheduler: this.scheduler,
      ...(this.random ? { random: this.random } : {}),
      onCompleted: (completedMatch) => {
        this.sessions.delete(completedMatch.id);
        this.onMatchCompleted(completedMatch);
      },
    });
    this.sessions.set(match.id, session);
    this.logger.debug(
      { matchId: match.id, source: match.source, mode: match.mode },
      "Live match session registered",
    );
    return session;
  }

  /** Return a live session; completed or post-restart matches are unavailable. */
  public get(matchId: string): MatchSession | null {
    return this.sessions.get(matchId) ?? null;
  }

  /** Apply a committed standalone seat claim to its in-memory aggregate. */
  public claimJoinedSeat(match: StoredMatch): MatchSession {
    const session = this.sessions.get(match.id);
    if (!session) {
      throw new Error("This match no longer has a live session.");
    }
    session.claimJoinedSeat(match);
    return session;
  }

  /** Start recurring last-activity cleanup after startup recovery completes. */
  public startCleanup(): void {
    if (!this.cleanupHandle) this.scheduleCleanup();
  }

  /** Abort sessions whose placement or battle activity exceeded its nominal TTL. */
  public cleanupNow(): void {
    const now = this.clock.now();
    for (const session of this.sessions.values()) {
      const timeout =
        session.phase === "placement"
          ? PLACEMENT_IDLE_TIMEOUT_MS
          : BATTLE_IDLE_TIMEOUT_MS;
      if (now - session.lastActivityMs >= timeout) {
        this.logger.warn(
          { matchId: session.id, phase: session.phase, idleTimeoutMs: timeout },
          "Aborting idle match session",
        );
        session.abortForIdleTimeout();
      }
    }
  }

  /** Stop cleanup and close every socket during graceful process shutdown. */
  public shutdown(): void {
    this.logger.info(
      { liveSessionCount: this.sessions.size },
      "Closing live match sessions",
    );
    if (this.cleanupHandle) {
      this.scheduler.cancel(this.cleanupHandle);
      this.cleanupHandle = null;
    }
    for (const session of this.sessions.values()) session.closeForShutdown();
    this.sessions.clear();
  }

  private scheduleCleanup(): void {
    this.cleanupHandle = this.scheduler.schedule(CLEANUP_INTERVAL_MS, () => {
      this.cleanupHandle = null;
      this.cleanupNow();
      this.scheduleCleanup();
    });
  }
}
