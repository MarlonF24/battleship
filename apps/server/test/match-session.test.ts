/** Critical session orchestration, timer, and projection privacy tests. */

import { describe, expect, test } from "bun:test";
import {
  CLASSIC_RULESET,
  placementCoordinates,
  type GameMode,
} from "@battleship/game-domain";
import { MatchSession } from "../src/session/match-session";
import { MemoryMatchRepository } from "../src/testing/memory-repository";
import {
  CapturingPeer,
  ManualRuntime,
  latestProjection,
  settle,
  silentLogger,
  validFleet,
} from "./helpers";

const firstPlayer = "11111111-1111-4111-8111-111111111111";
const secondPlayer = "22222222-2222-4222-8222-222222222222";
const firstSeatToken = "33333333-3333-4333-8333-333333333333";
const secondSeatToken = "44444444-4444-4444-8444-444444444444";
const matchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class DelayedCompletionRepository extends MemoryMatchRepository {
  public completionStarted = false;
  private releaseGate: () => void = () => undefined;
  private readonly completionGate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  public override async completeMatch(
    input: Parameters<MemoryMatchRepository["completeMatch"]>[0],
  ) {
    this.completionStarted = true;
    await this.completionGate;
    return super.completeMatch(input);
  }

  public releaseCompletion(): void {
    this.releaseGate();
  }
}

async function createHumanSession(
  runtime: ManualRuntime,
  repository = new MemoryMatchRepository(),
  mode: GameMode = "singleShot",
) {
  const stored = await repository.createMatch({
    id: matchId,
    hubMatchId: null,
    hubRequest: null,
    source: "standalone",
    mode,
    seats: [
      {
        seat: 1,
        kind: "human",
        name: "Player 1",
        identity: { source: "standalone", externalId: firstPlayer },
        seatToken: firstSeatToken,
      },
      {
        seat: 2,
        kind: "human",
        name: "Player 2",
        identity: { source: "standalone", externalId: secondPlayer },
        seatToken: secondSeatToken,
      },
    ],
  });
  return {
    repository,
    session: new MatchSession(stored, {
      repository,
      logger: silentLogger,
      clock: runtime,
      scheduler: runtime,
      random: { next: () => 0.25 },
    }),
  };
}

describe("match session", () => {
  test("publishes complete role-safe projections and rejects wrong-turn shots", async () => {
    const runtime = new ManualRuntime();
    const { session } = await createHumanSession(runtime);
    const first = new CapturingPeer("first");
    const second = new CapturingPeer("second");
    const spectator = new CapturingPeer("spectator");
    const otherSpectator = new CapturingPeer("other-spectator");
    session.connectPlayer(firstSeatToken, first);
    session.connectPlayer(secondSeatToken, second);
    session.connectSpectator(spectator);
    session.connectSpectator(otherSpectator);
    await settle();

    session.dispatch(firstSeatToken, {
      type: "ready",
      requestId: crypto.randomUUID(),
      fleet: [...validFleet],
    });
    session.dispatch(secondSeatToken, {
      type: "ready",
      requestId: crypto.randomUUID(),
      fleet: [...validFleet],
    });
    await settle();
    runtime.advanceBy(1_500);
    await settle();

    const firstProjection = latestProjection(first);
    const spectatorProjection = latestProjection(spectator);
    expect(firstProjection.phase).toBe("battle");
    expect(spectatorProjection.phase).toBe("battle");
    if (
      firstProjection.phase !== "battle" ||
      firstProjection.view.kind !== "player"
    ) {
      throw new Error("Expected a player battle view.");
    }
    if (
      spectatorProjection.phase !== "battle" ||
      spectatorProjection.view.kind !== "spectator"
    ) {
      throw new Error("Expected a spectator battle view.");
    }
    expect(firstProjection.view.ownBoard.ships).toHaveLength(10);
    expect(firstProjection.view.opponentBoard.ships).toHaveLength(0);
    expect(spectatorProjection.view.boards[0].ships).toHaveLength(0);
    expect(spectatorProjection.view.boards[1].ships).toHaveLength(0);
    expect(latestProjection(otherSpectator).phase).toBe("battle");
    expect(JSON.stringify(spectator.messages)).not.toContain(firstSeatToken);
    expect(JSON.stringify(first.messages)).not.toContain(firstSeatToken);

    const revision = firstProjection.revision;
    const requestId = crypto.randomUUID();
    session.dispatch(secondSeatToken, {
      type: "shoot",
      requestId,
      row: 0,
      column: 0,
    });
    await settle();
    expect(latestProjection(first).revision).toBe(revision);
    expect(second.messages).toContainEqual(
      expect.objectContaining({
        type: "commandRejected",
        requestId,
        code: "not_your_turn",
      }),
    );
  });

  test("randomly places an absent human fleet when the ready timer expires", async () => {
    const runtime = new ManualRuntime();
    const { session } = await createHumanSession(runtime);
    const first = new CapturingPeer("first");
    session.connectPlayer(firstSeatToken, first);
    await settle();
    session.dispatch(firstSeatToken, {
      type: "ready",
      requestId: crypto.randomUUID(),
      fleet: [...validFleet],
    });
    await settle();

    runtime.advanceBy(CLASSIC_RULESET.placementTimeoutMs);
    await settle();
    expect(session.phase).toBe("placement");
    runtime.advanceBy(1_500);
    await settle();
    expect(session.phase).toBe("battle");
    expect(latestProjection(first).phase).toBe("battle");
  });

  test("a replacement connection closes the old socket and retains the new one", async () => {
    const runtime = new ManualRuntime();
    const { session } = await createHumanSession(runtime);
    const oldPeer = new CapturingPeer("old");
    const newPeer = new CapturingPeer("new");
    session.connectPlayer(firstSeatToken, oldPeer);
    session.connectPlayer(firstSeatToken, newPeer);
    await settle();
    expect(oldPeer.closures).toContainEqual(
      expect.objectContaining({ code: 1008 }),
    );
    session.disconnectPlayer(firstSeatToken, oldPeer.id);
    await settle();
    expect(latestProjection(newPeer).participants[0].connected).toBe(true);
  });

  test("persists a terminal result before publishing it exactly once", async () => {
    const runtime = new ManualRuntime();
    const repository = new DelayedCompletionRepository();
    const { session } = await createHumanSession(runtime, repository, "streak");
    const first = new CapturingPeer("first");
    const second = new CapturingPeer("second");
    session.connectPlayer(firstSeatToken, first);
    session.connectPlayer(secondSeatToken, second);
    await settle();

    session.dispatch(firstSeatToken, {
      type: "ready",
      requestId: crypto.randomUUID(),
      fleet: [...validFleet],
    });
    session.dispatch(secondSeatToken, {
      type: "ready",
      requestId: crypto.randomUUID(),
      fleet: [...validFleet],
    });
    await settle();
    runtime.advanceBy(CLASSIC_RULESET.battleStartDelayMs);
    await settle();

    for (const { row, column } of validFleet.flatMap((placement) =>
      placementCoordinates(placement),
    )) {
      session.dispatch(firstSeatToken, {
        type: "shoot",
        requestId: crypto.randomUUID(),
        row,
        column,
      });
    }
    await settle();

    expect(repository.completionStarted).toBe(true);
    expect(
      first.messages.filter(
        (message) =>
          message.type === "projection" &&
          message.projection.phase === "completed",
      ),
    ).toHaveLength(0);

    repository.releaseCompletion();
    await settle();

    expect((await repository.findMatch(matchId))?.phase).toBe("completed");
    expect(
      first.messages.filter(
        (message) =>
          message.type === "projection" &&
          message.projection.phase === "completed",
      ),
    ).toHaveLength(1);
    expect(first.closures).toContainEqual(
      expect.objectContaining({ code: 1000 }),
    );
  });

  test("an unknown seat token cannot attach to a player seat", async () => {
    const runtime = new ManualRuntime();
    const { session } = await createHumanSession(runtime);
    const peer = new CapturingPeer("unknown-seat-token");

    expect(
      session.connectPlayer("99999999-9999-4999-8999-999999999999", peer),
    ).toBe(false);
    expect(peer.messages).toEqual([]);
    expect(peer.closures).toContainEqual(
      expect.objectContaining({ code: 1008 }),
    );
  });
});
