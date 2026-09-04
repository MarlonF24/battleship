/** Decode and encode the game hub's UUID-keyed Battleship wire format. */

import { Value } from "@sinclair/typebox/value";
import {
  HubCreateMatchRequestSchema,
  HubParticipantInputSchema,
  UuidSchema,
  type HubCreateMatchWireResponse,
  type HubMatchDefinition,
  type HubResultWireRequest,
} from "@battleship/contracts";
import type { StoredMatch } from "./repository";
import { playerPath, spectatorPath } from "./routes/shared";

const RESERVED_FIELDS = new Set(["room_uuid", "config"]);

export type HubDecodeError = Readonly<{
  code: "invalid_request" | "participant_count" | "human_required";
  message: string;
}>;
export type HubDecodeResult =
  | Readonly<{ ok: true; value: HubMatchDefinition }>
  | Readonly<{ ok: false; error: HubDecodeError }>;

/** Join an application route to a validated public service origin. */
function publicUrl(origin: string, path: string): string {
  return new URL(path, origin).href;
}

/**
 * Normalize dynamic UUID properties into the fixed tuple used internally.
 *
 * Participant insertion order is preserved because it defines which player
 * receives seat one and therefore takes the first turn.
 */
export function decodeHubMatchRequest(input: unknown): HubDecodeResult {
  if (!Value.Check(HubCreateMatchRequestSchema, input)) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: "The request does not match the documented hub schema.",
      },
    };
  }

  const participantEntries = Object.entries(input).filter(
    ([key]) => !RESERVED_FIELDS.has(key),
  );
  if (
    participantEntries.some(
      ([key, value]) =>
        !Value.Check(UuidSchema, key) ||
        !Value.Check(HubParticipantInputSchema, value),
    )
  ) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: "Every participant key must be a UUID.",
      },
    };
  }
  const participants = participantEntries.flatMap(([key, value]) => {
    if (!Value.Check(HubParticipantInputSchema, value)) return [];
    return [
      {
        playerId: key,
        name: value.name,
        difficulty: value.difficulty,
      },
    ];
  });
  const firstParticipant = participants[0];
  const secondParticipant = participants[1];
  if (!firstParticipant || !secondParticipant || participants.length !== 2) {
    return {
      ok: false,
      error: {
        code: "participant_count",
        message: "Battleship requires exactly two UUID-keyed participants.",
      },
    };
  }
  if (participants.every(({ difficulty }) => difficulty !== "player")) {
    return {
      ok: false,
      error: {
        code: "human_required",
        message: "A Battleship hub match requires at least one human player.",
      },
    };
  }

  return {
    ok: true,
    value: {
      roomUuid: input.room_uuid,
      mode: input.config.mode ?? "singleShot",
      participants: [firstParticipant, secondParticipant],
    },
  };
}

/** Compare normalized creation input for room-level idempotency. */
export function sameHubMatchDefinition(
  left: HubMatchDefinition | null,
  right: HubMatchDefinition,
): boolean {
  return (
    left?.roomUuid === right.roomUuid &&
    left.mode === right.mode &&
    left.participants.every((participant, index) => {
      const other = right.participants[index];
      return (
        other?.playerId === participant.playerId &&
        other.name === participant.name &&
        other.difficulty === participant.difficulty
      );
    })
  );
}

/** Build absolute human controls and the spectator extension for the hub. */
export function encodeHubMatchResponse(
  match: StoredMatch,
  publicBaseUrl: string,
): HubCreateMatchWireResponse & Readonly<Record<string, unknown>> {
  const definition = match.hubRequest;
  const secondSeat = match.seats[1];
  if (!definition || !secondSeat) {
    throw new Error("A hub response requires a complete hub match.");
  }

  const response: HubCreateMatchWireResponse & Record<string, unknown> = {
    room_uuid: definition.roomUuid,
    config: {
      spectator_link: publicUrl(publicBaseUrl, spectatorPath(match.id)),
    },
  };
  definition.participants.forEach((participant, index) => {
    const seat = match.seats[index];
    if (!seat) throw new Error("A hub participant must resolve to one seat.");
    response[participant.playerId] = {
      controller_link:
        seat.kind === "human"
          ? publicUrl(publicBaseUrl, playerPath(match.id, seat.seatToken))
          : "",
    };
  });
  return response;
}

/** Encode the terminal ordered outcomes using the hub's participant UUIDs. */
export function encodeHubResult(
  match: StoredMatch,
): HubResultWireRequest & Readonly<Record<string, unknown>> {
  const definition = match.hubRequest;
  const secondSeat = match.seats[1];
  if (!definition || !secondSeat) {
    throw new Error("A hub result requires a complete hub match.");
  }

  const result: HubResultWireRequest & Record<string, unknown> = {
    room_uuid: definition.roomUuid,
    config: {},
  };
  definition.participants.forEach((participant, index) => {
    const outcome = match.seats[index]?.outcome;
    if (!outcome) throw new Error("A completed hub seat requires an outcome.");
    result[participant.playerId] = { outcome };
  });
  return result;
}
