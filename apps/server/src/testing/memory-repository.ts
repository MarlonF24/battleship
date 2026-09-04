/** Deterministic repository adapter for server tests without PostgreSQL. */

import {
  RepositoryError,
  terminalOutcomes,
  type CreateStoredSeatInput,
  type MatchRepository,
  type PlayerIdentity,
  type StoredMatch,
  type StoredPlayer,
  type StoredSeat,
} from "../repository";

function identityKey(identity: PlayerIdentity): string {
  return `${identity.source}:${identity.externalId}`;
}

/** In-memory implementation with the same identity and admission semantics. */
export class MemoryMatchRepository implements MatchRepository {
  private readonly matches = new Map<string, StoredMatch>();
  private readonly players = new Map<string, StoredPlayer>();

  public get playerCount(): number {
    return this.players.size;
  }

  public checkReady(): Promise<void> {
    return Promise.resolve();
  }

  public createMatch(
    input: Parameters<MatchRepository["createMatch"]>[0],
  ): Promise<StoredMatch> {
    if (this.matches.has(input.id)) {
      throw new Error("Match UUID already exists.");
    }
    const now = new Date();
    const match: StoredMatch = {
      id: input.id,
      hubMatchId: input.hubMatchId,
      hubRequest: input.hubRequest,
      source: input.source,
      mode: input.mode,
      seats: [
        this.resolveSeat(input.seats[0]),
        input.seats[1] ? this.resolveSeat(input.seats[1]) : null,
      ],
      phase: "placement",
      winnerSeat: null,
      terminalReason: null,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      completedAt: null,
    };
    this.matches.set(input.id, match);
    return Promise.resolve(match);
  }

  public findMatch(matchId: string): Promise<StoredMatch | null> {
    return Promise.resolve(this.matches.get(matchId) ?? null);
  }

  public findHubMatch(hubMatchId: string): Promise<StoredMatch | null> {
    return Promise.resolve(
      [...this.matches.values()].find(
        (match) => match.hubMatchId === hubMatchId,
      ) ?? null,
    );
  }

  public joinMatch(
    matchId: string,
    identity: PlayerIdentity,
    seatToken: string,
  ): Promise<StoredMatch> {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new RepositoryError("match_not_found", "Match not found.");
    }
    if (match.phase !== "placement") {
      throw new RepositoryError("match_closed", "This match is closed.");
    }

    const existing = match.seats.find(
      (seat) =>
        seat?.kind === "human" &&
        identityKey(seat.player.identity) === identityKey(identity),
    );
    if (existing?.seat === 2) return Promise.resolve(match);
    if (existing?.seat === 1) {
      throw new RepositoryError(
        "already_participating",
        "You already control seat one in this match.",
      );
    }
    if (match.seats[1]) {
      throw new RepositoryError("match_full", "This match is full.");
    }

    const second = this.resolveSeat({
      seat: 2,
      kind: "human",
      name: "Player 2",
      identity,
      seatToken,
    });
    const joined: StoredMatch = { ...match, seats: [match.seats[0], second] };
    this.matches.set(matchId, joined);
    return Promise.resolve(joined);
  }

  public markBattleStarted(matchId: string): Promise<void> {
    const match = this.requireMatch(matchId);
    const now = new Date();
    this.matches.set(matchId, {
      ...match,
      phase: "battle",
      startedAt: now,
      updatedAt: now,
    });
    return Promise.resolve();
  }

  public touchMatch(matchId: string): Promise<void> {
    const match = this.requireMatch(matchId);
    this.matches.set(matchId, { ...match, updatedAt: new Date() });
    return Promise.resolve();
  }

  public completeMatch(
    input: Parameters<MatchRepository["completeMatch"]>[0],
  ): Promise<StoredMatch> {
    const match = this.requireMatch(input.matchId);
    if (match.phase === "completed") return Promise.resolve(match);
    const completedAt = new Date();
    const outcomes = terminalOutcomes(input.winnerSeat);
    const second = match.seats[1];
    const completed: StoredMatch = {
      ...match,
      phase: "completed",
      seats: [
        { ...match.seats[0], outcome: outcomes[0] },
        second ? { ...second, outcome: outcomes[1] } : null,
      ],
      winnerSeat: input.winnerSeat,
      terminalReason: input.reason,
      updatedAt: completedAt,
      completedAt,
    };
    this.matches.set(input.matchId, completed);

    return Promise.resolve(completed);
  }

  public async abortNonterminalMatches(): Promise<readonly StoredMatch[]> {
    const aborted: StoredMatch[] = [];
    for (const match of this.matches.values()) {
      if (match.phase !== "completed") {
        aborted.push(
          await this.completeMatch({
            matchId: match.id,
            winnerSeat: null,
            reason: "server_restart",
          }),
        );
      }
    }
    return aborted;
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  private resolveSeat(input: CreateStoredSeatInput): StoredSeat {
    if (input.kind === "bot") {
      return {
        seat: input.seat,
        kind: "bot",
        name: input.name,
        difficulty: input.difficulty,
        outcome: null,
      };
    }
    const key = identityKey(input.identity);
    let player = this.players.get(key);
    if (!player) {
      player = {
        id: crypto.randomUUID(),
        identity: input.identity,
      };
      this.players.set(key, player);
    }
    return {
      seat: input.seat,
      kind: "human",
      name: input.name,
      player,
      seatToken: input.seatToken,
      outcome: null,
    };
  }

  private requireMatch(matchId: string): StoredMatch {
    const match = this.matches.get(matchId);
    if (!match) throw new Error("Match not found.");
    return match;
  }
}
