/** Shared match lifecycle application service used by standalone and hub routes. */

import type {
  CreateMatchRequest,
  HubMatchDefinition,
  JoinMatchRequest,
} from "@battleship/contracts";
import type { MatchRepository, StoredMatch } from "./repository";
import type { MatchSessionRegistry } from "./session/registry";

/** Persist matches and register their authoritative in-memory sessions once. */
export class MatchService {
  public constructor(
    private readonly repository: MatchRepository,
    private readonly registry: MatchSessionRegistry,
  ) {}

  /**
   * Create a standalone human/open or human/bot match.
   *
   * @param request - Validated browser identity, mode, and opponent choice.
   * @returns Persisted metadata for URL construction and session access.
   */
  public async createStandalone(
    request: CreateMatchRequest,
  ): Promise<StoredMatch> {
    const match = await this.repository.createMatch({
      id: crypto.randomUUID(),
      hubMatchId: null,
      hubRequest: null,
      source: "standalone",
      mode: request.mode,
      seats: [
        {
          seat: 1,
          kind: "human",
          name: "Player 1",
          identity: {
            source: "standalone",
            externalId: request.standalonePlayerId,
          },
          seatToken: crypto.randomUUID(),
        },
        request.opponent === "bot"
          ? {
              seat: 2,
              kind: "bot",
              name: "Computer",
              difficulty: "hard",
            }
          : null,
      ],
    });
    this.registry.create(match);
    return match;
  }

  /**
   * Create a complete two-seat match labelled by hub identities.
   *
   * Seat-token generation happens here so neither controller nor domain needs
   * to understand how durable identity differs from seat authorization.
   */
  public async createHub(request: HubMatchDefinition): Promise<StoredMatch> {
    const seatInput = (
      seat: 1 | 2,
      participant: HubMatchDefinition["participants"][number],
    ) =>
      participant.difficulty === "player"
        ? ({
            seat,
            kind: "human",
            name: participant.name,
            identity: { source: "hub", externalId: participant.playerId },
            seatToken: crypto.randomUUID(),
          } as const)
        : ({
            seat,
            kind: "bot",
            name: participant.name,
            difficulty: participant.difficulty,
          } as const);

    const match = await this.repository.createMatch({
      id: crypto.randomUUID(),
      hubMatchId: request.roomUuid,
      hubRequest: request,
      source: "hub",
      mode: request.mode,
      seats: [
        seatInput(1, request.participants[0]),
        seatInput(2, request.participants[1]),
      ],
    });
    this.registry.create(match);
    return match;
  }

  /** Atomically claim standalone seat two and publish the new participant. */
  public async joinStandalone(
    matchId: string,
    request: JoinMatchRequest,
  ): Promise<StoredMatch> {
    const match = await this.repository.joinMatch(
      matchId,
      {
        source: "standalone",
        externalId: request.standalonePlayerId,
      },
      crypto.randomUUID(),
    );
    this.registry.claimJoinedSeat(match);
    return match;
  }
}
