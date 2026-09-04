/** Frontend state-boundary and responsive transition tests. */

import { afterEach, describe, expect, test } from "bun:test";
import type { MatchProjection } from "@battleship/contracts";
import {
  CLASSIC_RULESET,
  ValidatedFleet,
  type ShipPlacement,
} from "@battleship/game-domain";
import { MatchSessionStore } from "../src/stores/match-session-store";
import { PlacementDragSession } from "../src/stores/placement-drag-session";
import { PlacementDraftStore } from "../src/stores/placement-draft-store";
import {
  BOARD_SWITCH_DELAY_MS,
  ResponsiveBattleStore,
} from "../src/stores/responsive-battle-store";

const stores: MatchSessionStore[] = [];

afterEach(() => {
  for (const store of stores) store.dispose();
  stores.length = 0;
});

function placementProjection(revision: number): MatchProjection {
  return {
    revision,
    serverTimeMs: Date.now(),
    matchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    mode: "singleShot",
    rules: {
      rows: 10,
      columns: 10,
      fleetLengths: [5, 4, 4, 3, 3, 3, 2, 2, 2, 2],
      salvoShots: 3,
      placementTimeoutMs: 40_000,
      shotTimeoutMs: 10_000,
      reconnectTimeoutMs: 8_000,
    },
    participants: [
      {
        seat: 1,
        name: "Player 1",
        descriptor: { kind: "human" },
        ready: false,
        connected: true,
      },
      {
        seat: 2,
        name: "Player 2",
        descriptor: { kind: "open" },
        ready: false,
        connected: false,
      },
    ],
    viewer: { role: "player", seat: 1 },
    phase: "placement",
    placementDeadlineMs: null,
  };
}

describe("placement draft store", () => {
  test("starts with a sorted horizontal garage and an empty board", () => {
    const draft = new PlacementDraftStore(CLASSIC_RULESET);
    expect(draft.allPlaced).toBe(false);
    expect(draft.placements).toEqual([]);
    expect(draft.garageShips.map(({ length }) => length)).toEqual([
      5, 4, 4, 3, 3, 3, 2, 2, 2, 2,
    ]);
    expect(
      draft.garageShips.every(
        ({ orientation }) => orientation === "horizontal",
      ),
    ).toBe(true);
  });

  test("both random actions produce a fleet accepted by the domain validator", () => {
    const draft = new PlacementDraftStore(CLASSIC_RULESET);
    draft.randomiseRemaining();
    expect(draft.allPlaced).toBe(true);
    expect(ValidatedFleet.create(draft.placements).ok).toBe(true);
    draft.randomiseAll();
    expect(ValidatedFleet.create(draft.placements).ok).toBe(true);
  });

  test("locking is irreversible for editing actions", () => {
    const draft = new PlacementDraftStore();
    draft.randomiseAll();
    const placements = draft.placements;
    draft.lock();
    draft.reset();
    draft.randomiseAll();
    expect(draft.placements).toEqual(placements);
  });

  test("drag rotation and cancellation leave the source placement unchanged", () => {
    const draft = new PlacementDraftStore();
    const ship = draft.ships[0];
    if (!ship) throw new Error("Expected a draft ship.");
    const original = ship.placement;
    const drag = new PlacementDragSession(draft);

    expect(drag.beginKeyboard(ship.id, 30)).toBe(true);
    drag.suggestAt(5, 5, { x: 0.25, y: 0.25 });
    expect(drag.suggestion).toMatchObject({
      orientation: "horizontal",
      headRow: 5,
      headColumn: 3,
    });
    drag.rotate();
    expect(drag.suggestion).toMatchObject({
      orientation: "vertical",
      headRow: 3,
      headColumn: 5,
    });
    drag.cancel();
    expect(draft.ships[0]?.placement).toEqual(original);
  });

  test("a legal drop commits once while an invalid drop cannot mutate", () => {
    const draft = new PlacementDraftStore();
    const [first, second] = draft.ships;
    if (!first || !second) throw new Error("Expected two draft ships.");
    const firstPlacement: ShipPlacement = {
      length: first.length,
      orientation: "horizontal",
      headRow: 0,
      headColumn: 0,
    };
    expect(draft.commitPlacement(first.id, firstPlacement)).toBe(true);
    const drag = new PlacementDragSession(draft);

    expect(drag.beginKeyboard(second.id, 30)).toBe(true);
    drag.suggestAt(0, 0);
    expect(drag.suggestionLegal).toBe(false);
    expect(drag.commit()).toBe(false);
    expect(draft.placements).toEqual([firstPlacement]);
  });

  test("returning a ship restores its horizontal garage state", () => {
    const draft = new PlacementDraftStore();
    const ship = draft.ships.find(({ length }) => length === 3);
    if (!ship) throw new Error("Expected a length-three ship.");
    expect(
      draft.commitPlacement(ship.id, {
        length: 3,
        orientation: "vertical",
        headRow: 0,
        headColumn: 0,
      }),
    ).toBe(true);
    expect(draft.returnToGarage(ship.id)).toBe(true);
    expect(draft.ships.find(({ id }) => id === ship.id)).toMatchObject({
      orientation: "horizontal",
      placement: null,
    });
  });
});

describe("responsive battle store", () => {
  test("holds a newly shot board before returning to the active target", async () => {
    const responsive = new ResponsiveBattleStore();
    responsive.observeBattle(2, null);
    expect(responsive.displayedSeat).toBe(2);

    responsive.observeBattle(2, null);
    expect(responsive.displayedSeat).toBe(2);
    responsive.observeBattle(1, { shooter: 1, row: 0, column: 0 });
    expect(responsive.displayedSeat).toBe(2);
    await Bun.sleep(BOARD_SWITCH_DELAY_MS + 25);
    expect(responsive.displayedSeat).toBe(1);
    responsive.dispose();
  });

  test("completion permits explicit final-board inspection", () => {
    const responsive = new ResponsiveBattleStore();
    responsive.observeBattle(2, null);
    responsive.observeCompletion(2);
    responsive.selectFinalBoard(1);
    expect(responsive.displayedSeat).toBe(1);
    responsive.dispose();
  });
});

describe("match session store", () => {
  test("accepts only strictly newer complete projections", () => {
    const store = new MatchSessionStore({
      role: "player",
      matchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      seatToken: "11111111-1111-4111-8111-111111111111",
    });
    stores.push(store);
    store.acceptServerMessage({
      type: "projection",
      projection: placementProjection(4),
    });
    store.acceptServerMessage({
      type: "projection",
      projection: placementProjection(3),
    });
    expect(store.projection?.revision).toBe(4);
  });

  test("a command rejection clears only its originating pending request", () => {
    const store = new MatchSessionStore({
      role: "spectator",
      matchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    stores.push(store);
    store.pendingRequestIds.add("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    store.acceptServerMessage({
      type: "commandRejected",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      code: "not_your_turn",
      message: "Wait for your turn.",
      revision: 1,
    });
    expect(store.pendingRequestIds.size).toBe(0);
    expect(store.rejection).toBe("Wait for your turn.");
  });
});
