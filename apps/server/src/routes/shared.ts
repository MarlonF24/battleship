/** Shared route dependencies, schemas, and link construction. */

import { Type } from "@sinclair/typebox";
import { UuidSchema } from "@battleship/contracts";
import type { Logger } from "pino";
import type { AppConfig } from "../config";
import type { MatchService } from "../match-service";
import type { MatchRepository } from "../repository";
import type { MatchSessionRegistry } from "../session/registry";

const strict = { additionalProperties: false } as const;

export const MatchParamsSchema = Type.Object({ matchId: UuidSchema }, strict);
export const PlayerQuerySchema = Type.Object({ seatToken: UuidSchema }, strict);
export const HealthSchema = Type.Object({ status: Type.Literal("ok") }, strict);

/** Dependencies shared by transport plugins but absent from domain code. */
export type RouteDependencies = Readonly<{
  config: AppConfig;
  repository: MatchRepository;
  registry: MatchSessionRegistry;
  matchService: MatchService;
  logger: Logger;
}>;

/** Build the private browser route carrying authority for one human seat. */
export function playerPath(matchId: string, seatToken: string): string {
  return `/matches/${matchId}/player/${seatToken}`;
}

/** Build the public read-only route for a live match. */
export function spectatorPath(matchId: string): string {
  return `/spectate/${matchId}`;
}
