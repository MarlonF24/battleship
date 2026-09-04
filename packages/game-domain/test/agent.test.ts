/** Probability-density agent legality and public-knowledge tests. */

import { describe, expect, test } from "bun:test";
import {
  BattleBoard,
  chooseBotTarget,
  chooseProbabilityTarget,
  generateRandomFleet,
} from "../src";
import { seededRandom } from "./helpers";

describe("probability-density agent", () => {
  test("selects an unknown legal coordinate using public evidence only", () => {
    const fleet = generateRandomFleet(seededRandom(20));
    if (!fleet.ok) throw new Error("Test fleet must be generated.");
    const board = new BattleBoard(fleet.value);

    board.shoot({ row: 0, column: 0 });
    board.shoot({ row: 9, column: 9 });
    const knowledge = board.opponentKnowledge();
    const target = chooseProbabilityTarget(knowledge, seededRandom(21));

    expect(knowledge.cells[target.row]?.[target.column]).toBe("unknown");
  });

  test("the same public evidence and seed produces the same decision", () => {
    const firstFleet = generateRandomFleet(seededRandom(30));
    const secondFleet = generateRandomFleet(seededRandom(31));
    if (!firstFleet.ok || !secondFleet.ok) {
      throw new Error("Test fleets must be generated.");
    }

    const first = new BattleBoard(firstFleet.value).opponentKnowledge();
    const second = new BattleBoard(secondFleet.value).opponentKnowledge();
    expect(chooseProbabilityTarget(first, seededRandom(32))).toEqual(
      chooseProbabilityTarget(second, seededRandom(32)),
    );
  });

  test("every difficulty selects only an unknown public target", () => {
    const fleet = generateRandomFleet(seededRandom(40));
    if (!fleet.ok) throw new Error("Test fleet must be generated.");
    const knowledge = new BattleBoard(fleet.value).opponentKnowledge();

    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const target = chooseBotTarget(knowledge, difficulty, seededRandom(41));
      expect(knowledge.cells[target.row]?.[target.column]).toBe("unknown");
    }
  });
});
