/** Probability-density targeting that consumes public board evidence only. */

import { chooseRandom, shuffled, type RandomSource } from "./random";
import {
  coordinateKey,
  type BotDifficulty,
  type Coordinate,
  type ShipPlacement,
} from "./types";
import { placementCoordinates } from "./fleet";
import type { OpponentKnowledge } from "./board";

/** Candidate cap that gives the normal agent a deliberately noisy heatmap. */
const NORMAL_CANDIDATES_PER_SHIP = 32;

function cellAt(
  knowledge: OpponentKnowledge,
  { row, column }: Coordinate,
): "unknown" | "miss" | "hit" | "impossible" | undefined {
  return knowledge.cells[row]?.[column];
}

function unresolvedHitClusters(
  knowledge: OpponentKnowledge,
): readonly (readonly Coordinate[])[] {
  const unresolved = new Map<string, Coordinate>();
  const sunkCells = new Set(
    knowledge.sunkShips.flatMap((ship) =>
      placementCoordinates(ship).map(coordinateKey),
    ),
  );

  for (let row = 0; row < knowledge.rows; row += 1) {
    for (let column = 0; column < knowledge.columns; column += 1) {
      const coordinate = { row, column };
      if (
        cellAt(knowledge, coordinate) === "hit" &&
        !sunkCells.has(coordinateKey(coordinate))
      ) {
        unresolved.set(coordinateKey(coordinate), coordinate);
      }
    }
  }

  const clusters: Coordinate[][] = [];
  while (unresolved.size > 0) {
    const first = unresolved.values().next().value;
    if (!first) {
      break;
    }

    const cluster: Coordinate[] = [];
    const queue = [first];
    unresolved.delete(coordinateKey(first));

    // Orthogonal connected hits must belong to one ship under the no-touch rule.
    while (queue.length > 0) {
      const coordinate = queue.shift();
      if (!coordinate) {
        continue;
      }
      cluster.push(coordinate);

      const neighbours = [
        { row: coordinate.row - 1, column: coordinate.column },
        { row: coordinate.row + 1, column: coordinate.column },
        { row: coordinate.row, column: coordinate.column - 1 },
        { row: coordinate.row, column: coordinate.column + 1 },
      ];
      for (const neighbour of neighbours) {
        const key = coordinateKey(neighbour);
        const hit = unresolved.get(key);
        if (hit) {
          unresolved.delete(key);
          queue.push(hit);
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function enumerateCandidates(
  knowledge: OpponentKnowledge,
  length: number,
): readonly ShipPlacement[] {
  const candidates: ShipPlacement[] = [];
  const sunkCells = new Set(
    knowledge.sunkShips.flatMap((ship) =>
      placementCoordinates(ship).map(coordinateKey),
    ),
  );
  for (const orientation of ["horizontal", "vertical"] as const) {
    for (let headRow = 0; headRow < knowledge.rows; headRow += 1) {
      for (
        let headColumn = 0;
        headColumn < knowledge.columns;
        headColumn += 1
      ) {
        const placement = { length, orientation, headRow, headColumn };
        const coordinates = placementCoordinates(placement);
        const valid = coordinates.every(
          (coordinate) =>
            coordinate.row >= 0 &&
            coordinate.row < knowledge.rows &&
            coordinate.column >= 0 &&
            coordinate.column < knowledge.columns &&
            !sunkCells.has(coordinateKey(coordinate)) &&
            !["miss", "impossible"].includes(
              cellAt(knowledge, coordinate) ?? "",
            ),
        );
        if (valid) {
          candidates.push(placement);
        }
      }
    }
  }
  return candidates;
}

/**
 * Select a highest-density legal target using only opponent-visible evidence.
 *
 * Candidate placements covering unresolved hit clusters receive priority;
 * otherwise the score represents how many remaining-ship placements may occupy
 * each unknown cell. Ties are deliberately randomized.
 */
export function chooseProbabilityTarget(
  knowledge: OpponentKnowledge,
  random: RandomSource,
  candidatesPerShip?: number,
): Coordinate {
  const clusters = unresolvedHitClusters(knowledge);
  const scores = new Map<string, { coordinate: Coordinate; score: number }>();

  for (const length of knowledge.remainingShipLengths) {
    const candidates = enumerateCandidates(knowledge, length);
    const compatibleCandidates =
      clusters.length === 0
        ? candidates
        : candidates.filter((candidate) => {
            const occupied = new Set(
              placementCoordinates(candidate).map(coordinateKey),
            );
            return clusters.some((cluster) =>
              cluster.every((coordinate) =>
                occupied.has(coordinateKey(coordinate)),
              ),
            );
          });
    const targetedCandidates = candidatesPerShip
      ? shuffled(compatibleCandidates, random).slice(0, candidatesPerShip)
      : compatibleCandidates;

    // Score only unresolved cells because known hits are evidence, not targets.
    for (const candidate of targetedCandidates) {
      for (const coordinate of placementCoordinates(candidate)) {
        if (cellAt(knowledge, coordinate) !== "unknown") {
          continue;
        }
        const key = coordinateKey(coordinate);
        const existing = scores.get(key);
        scores.set(key, {
          coordinate,
          score: (existing?.score ?? 0) + 1,
        });
      }
    }
  }

  const entries = [...scores.values()];
  const maximum = Math.max(0, ...entries.map(({ score }) => score));
  const best = entries.filter(({ score }) => score === maximum);
  const selected = chooseRandom(best, random)?.coordinate;
  if (selected) {
    return selected;
  }

  // This fallback keeps the agent operational if supplied evidence is inconsistent.
  return chooseUniformTarget(knowledge, random);
}

/** Choose uniformly from cells that are still legal under public evidence. */
function chooseUniformTarget(
  knowledge: OpponentKnowledge,
  random: RandomSource,
): Coordinate {
  const legal: Coordinate[] = [];
  for (let row = 0; row < knowledge.rows; row += 1) {
    for (let column = 0; column < knowledge.columns; column += 1) {
      if (cellAt(knowledge, { row, column }) === "unknown") {
        legal.push({ row, column });
      }
    }
  }
  const selected = chooseRandom(legal, random);
  if (!selected) {
    throw new Error("The agent has no legal target.");
  }
  return selected;
}

/** Select a legal target using the strategy declared for one bot seat. */
export function chooseBotTarget(
  knowledge: OpponentKnowledge,
  difficulty: BotDifficulty,
  random: RandomSource,
): Coordinate {
  if (difficulty === "easy") return chooseUniformTarget(knowledge, random);
  return chooseProbabilityTarget(
    knowledge,
    random,
    difficulty === "normal" ? NORMAL_CANDIDATES_PER_SHIP : undefined,
  );
}
