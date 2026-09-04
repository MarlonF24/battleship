/** Game-hub match creation using the shared UUID-keyed wire protocol. */

import { Elysia } from "elysia";
import {
  ApiErrorSchema,
  HubCreateMatchRequestSchema,
  HubCreateMatchResponseSchema,
} from "@battleship/contracts";
import {
  decodeHubMatchRequest,
  encodeHubMatchResponse,
  sameHubMatchDefinition,
} from "../hub-protocol";
import type { StoredMatch } from "../repository";
import type { RouteDependencies } from "./shared";

/** Build the single hub-owned lifecycle endpoint. */
export function createHubRoutes({
  config,
  repository,
  matchService,
  logger,
}: Pick<
  RouteDependencies,
  "config" | "repository" | "matchService" | "logger"
>) {
  return new Elysia({
    name: "hub-routes",
    prefix: "/api/v1/hub",
    detail: { tags: ["Game hub"] },
  }).post(
    "/matches",
    async ({ body, status }) => {
      if (!config.hub.enabled) {
        logger.warn(
          "Hub match creation received while integration is disabled",
        );
        return status(503, {
          code: "hub_unavailable",
          message: "Game-hub integration is not configured.",
        });
      }

      const decoded = decodeHubMatchRequest(body);
      if (!decoded.ok) {
        const responseStatus =
          decoded.error.code === "invalid_request" ? 400 : 422;
        return status(responseStatus, decoded.error);
      }
      const request = decoded.value;
      const existing = await repository.findHubMatch(request.roomUuid);
      if (existing) {
        if (!sameHubMatchDefinition(existing.hubRequest, request)) {
          return status(409, {
            code: "hub_match_conflict",
            message:
              "This room UUID was already used with different match input.",
          });
        }
        logger.debug(
          { roomUuid: request.roomUuid, matchId: existing.id },
          "Hub match creation replayed",
        );
        return encodeHubMatchResponse(existing, config.hub.publicBaseUrl);
      }

      let match: StoredMatch;
      try {
        match = await matchService.createHub(request);
      } catch (cause) {
        // A concurrent replay may win the unique room UUID insert.
        const racedMatch = await repository.findHubMatch(request.roomUuid);
        if (!racedMatch) throw cause;
        if (!sameHubMatchDefinition(racedMatch.hubRequest, request)) {
          return status(409, {
            code: "hub_match_conflict",
            message:
              "This room UUID was already used with different match input.",
          });
        }
        match = racedMatch;
      }

      logger.info(
        { roomUuid: request.roomUuid, matchId: match.id, mode: match.mode },
        "Hub match created",
      );
      return encodeHubMatchResponse(match, config.hub.publicBaseUrl);
    },
    {
      body: HubCreateMatchRequestSchema,
      response: {
        200: HubCreateMatchResponseSchema,
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        422: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  );
}
