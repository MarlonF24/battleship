/**
 * Runtime-validated HTTP and WebSocket contracts shared by server and browser.
 *
 * TypeBox schemas are the wire-format source of truth: Elysia validates
 * untrusted payloads while `Static` derives exactly matching TypeScript types.
 * Persistence rows and domain objects intentionally remain separate models.
 */

import { FormatRegistry, Type, type Static } from "@sinclair/typebox";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// TypeBox leaves string formats application-defined; registering them here
// gives Elysia, server tests, and browser message validation identical checks.
FormatRegistry.Set("uuid", (value) => UUID_PATTERN.test(value));
FormatRegistry.Set("date-time", (value) => {
  const timestamp = Date.parse(value);
  return value.includes("T") && Number.isFinite(timestamp);
});
const strict = { additionalProperties: false } as const;
const RelativeUrlSchema = Type.String({ pattern: "^/[^\\s]*$" });
const AbsoluteHttpUrlSchema = Type.String({ pattern: "^https?://\\S+$" });

/** Canonical UUID representation reused by every public contract. */
export const UuidSchema = Type.String({ format: "uuid" });
export const GameModeSchema = Type.Union([
  Type.Literal("singleShot"),
  Type.Literal("salvo"),
  Type.Literal("streak"),
]);
export const OrientationSchema = Type.Union([
  Type.Literal("horizontal"),
  Type.Literal("vertical"),
]);
export const SeatSchema = Type.Union([Type.Literal(1), Type.Literal(2)]);

export const ShipPlacementSchema = Type.Object(
  {
    length: Type.Integer({ minimum: 1 }),
    orientation: OrientationSchema,
    headRow: Type.Integer({ minimum: 0 }),
    headColumn: Type.Integer({ minimum: 0 }),
  },
  strict,
);

export const HumanSeatSchema = Type.Object(
  { kind: Type.Literal("human") },
  strict,
);
export const BotDifficultySchema = Type.Union([
  Type.Literal("easy"),
  Type.Literal("normal"),
  Type.Literal("hard"),
]);
export type BotDifficulty = Static<typeof BotDifficultySchema>;
export const BotSeatSchema = Type.Object(
  { kind: Type.Literal("bot"), difficulty: BotDifficultySchema },
  strict,
);
export const SeatDescriptorSchema = Type.Union([
  HumanSeatSchema,
  BotSeatSchema,
]);
export const ParticipantDescriptorSchema = Type.Union([
  SeatDescriptorSchema,
  Type.Object({ kind: Type.Literal("open") }, strict),
]);

/** Standalone match creation input. */
export const CreateMatchRequestSchema = Type.Object(
  {
    standalonePlayerId: UuidSchema,
    mode: GameModeSchema,
    opponent: Type.Union([Type.Literal("human"), Type.Literal("bot")]),
  },
  strict,
);
export type CreateMatchRequest = Static<typeof CreateMatchRequestSchema>;

/** Browser identity used to claim the second human seat. */
export const JoinMatchRequestSchema = Type.Object(
  { standalonePlayerId: UuidSchema },
  strict,
);
export type JoinMatchRequest = Static<typeof JoinMatchRequestSchema>;

const MatchAccessBase = {
  matchId: UuidSchema,
  playerUrl: RelativeUrlSchema,
  spectatorUrl: RelativeUrlSchema,
};
/** Seat-token links returned for either human or bot matches. */
export const CreateMatchResponseSchema = Type.Union([
  Type.Object(
    {
      ...MatchAccessBase,
      kind: Type.Literal("humanMatch"),
      joinUrl: RelativeUrlSchema,
    },
    strict,
  ),
  Type.Object({ ...MatchAccessBase, kind: Type.Literal("botMatch") }, strict),
]);
export type CreateMatchResponse = Static<typeof CreateMatchResponseSchema>;

export const JoinMatchResponseSchema = Type.Object(MatchAccessBase, strict);
export type JoinMatchResponse = Static<typeof JoinMatchResponseSchema>;

export const ApiErrorSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
  },
  strict,
);
export type ApiError = Static<typeof ApiErrorSchema>;

/** Participant description supplied under a UUID key by the game hub. */
export const HubParticipantInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80, pattern: "\\S" }),
    difficulty: Type.Union([Type.Literal("player"), BotDifficultySchema]),
  },
  strict,
);
export type HubParticipantInput = Static<typeof HubParticipantInputSchema>;

/** Optional game-specific choices carried in the hub's reserved config field. */
export const HubMatchConfigSchema = Type.Object(
  { mode: Type.Optional(GameModeSchema) },
  strict,
);

/** UUID-keyed match creation body used by the shared game-hub protocol. */
export const HubCreateMatchRequestSchema = Type.Object(
  {
    room_uuid: UuidSchema,
    config: HubMatchConfigSchema,
  },
  {
    additionalProperties: HubParticipantInputSchema,
  },
);
export type HubCreateMatchWireRequest = Static<
  typeof HubCreateMatchRequestSchema
>;

/** Fully typed application input decoded from the protocol's dynamic keys. */
export type HubParticipant = Readonly<{
  playerId: string;
  name: string;
  difficulty: "player" | BotDifficulty;
}>;
export type HubMatchDefinition = Readonly<{
  roomUuid: string;
  mode: Static<typeof GameModeSchema>;
  participants: readonly [HubParticipant, HubParticipant];
}>;

export const HubControllerLinkSchema = Type.Object(
  { controller_link: Type.Union([AbsoluteHttpUrlSchema, Type.Literal("")]) },
  strict,
);

/** UUID-keyed controller links plus the protocol extension for spectators. */
export const HubCreateMatchResponseSchema = Type.Object(
  {
    room_uuid: UuidSchema,
    config: Type.Object({ spectator_link: AbsoluteHttpUrlSchema }, strict),
  },
  {
    additionalProperties: HubControllerLinkSchema,
  },
);
export type HubCreateMatchWireResponse = Static<
  typeof HubCreateMatchResponseSchema
>;
export const CompletionReasonSchema = Type.Union([
  Type.Literal("fleet_destroyed"),
  Type.Literal("no_players_connected"),
  Type.Literal("server_restart"),
  Type.Literal("placement_expired"),
  Type.Literal("battle_expired"),
]);
export const OutcomeSchema = Type.Union([
  Type.Literal("win"),
  Type.Literal("loss"),
  Type.Literal("premature"),
]);
export type Outcome = Static<typeof OutcomeSchema>;

export const HubResultEntrySchema = Type.Object(
  { outcome: OutcomeSchema },
  strict,
);

/** Terminal result body sent once to the hub after match persistence. */
export const HubResultRequestSchema = Type.Object(
  {
    room_uuid: UuidSchema,
    config: Type.Object({}, strict),
  },
  {
    additionalProperties: HubResultEntrySchema,
  },
);
export type HubResultWireRequest = Static<typeof HubResultRequestSchema>;

/** Complete command union accepted from an authorized player socket. */
export const PlayerCommandSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("ready"),
      requestId: UuidSchema,
      fleet: Type.Array(ShipPlacementSchema),
    },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal("shoot"),
      requestId: UuidSchema,
      row: Type.Integer({ minimum: 0 }),
      column: Type.Integer({ minimum: 0 }),
    },
    strict,
  ),
]);
export type PlayerCommand = Static<typeof PlayerCommandSchema>;

export const CellStateSchema = Type.Union([
  Type.Literal("unknown"),
  Type.Literal("miss"),
  Type.Literal("hit"),
  Type.Literal("impossible"),
]);
// Keep the complete wire object in one strict schema. Intersecting two strict
// objects makes each half reject the other half's fields during runtime checks.
export const ShipViewSchema = Type.Object(
  {
    ...ShipPlacementSchema.properties,
    id: Type.String(),
    hits: Type.Array(Type.Boolean()),
    sunk: Type.Boolean(),
  },
  strict,
);
export const BoardViewSchema = Type.Object(
  {
    cells: Type.Array(Type.Array(CellStateSchema)),
    ships: Type.Array(ShipViewSchema),
    remainingShipLengths: Type.Array(Type.Integer()),
  },
  strict,
);
export type BoardView = Static<typeof BoardViewSchema>;

export const RulesViewSchema = Type.Object(
  {
    rows: Type.Integer(),
    columns: Type.Integer(),
    fleetLengths: Type.Array(Type.Integer()),
    salvoShots: Type.Integer(),
    placementTimeoutMs: Type.Integer(),
    shotTimeoutMs: Type.Integer(),
    reconnectTimeoutMs: Type.Integer(),
  },
  strict,
);
export type RulesView = Static<typeof RulesViewSchema>;

export const ParticipantSchema = Type.Object(
  {
    seat: SeatSchema,
    name: Type.String(),
    descriptor: ParticipantDescriptorSchema,
    ready: Type.Boolean(),
    connected: Type.Boolean(),
  },
  strict,
);
export type Participant = Static<typeof ParticipantSchema>;

const ViewerSchema = Type.Union([
  Type.Object({ role: Type.Literal("player"), seat: SeatSchema }, strict),
  Type.Object({ role: Type.Literal("spectator") }, strict),
]);

export const LastShotSchema = Type.Object(
  {
    shooter: SeatSchema,
    row: Type.Integer({ minimum: 0 }),
    column: Type.Integer({ minimum: 0 }),
  },
  strict,
);
export type LastShot = Static<typeof LastShotSchema>;

const PlayerBattleViewSchema = Type.Object(
  {
    kind: Type.Literal("player"),
    seat: SeatSchema,
    ownBoard: BoardViewSchema,
    opponentBoard: BoardViewSchema,
  },
  strict,
);
const SpectatorBattleViewSchema = Type.Object(
  {
    kind: Type.Literal("spectator"),
    boards: Type.Tuple([BoardViewSchema, BoardViewSchema]),
  },
  strict,
);

const ProjectionBase = {
  revision: Type.Integer({ minimum: 0 }),
  serverTimeMs: Type.Integer({ minimum: 0 }),
  matchId: UuidSchema,
  mode: GameModeSchema,
  rules: RulesViewSchema,
  participants: Type.Tuple([ParticipantSchema, ParticipantSchema]),
  viewer: ViewerSchema,
};

/** Placement projection that deliberately omits accepted opponent fleets. */
export const PlacementProjectionSchema = Type.Object(
  {
    ...ProjectionBase,
    phase: Type.Literal("placement"),
    placementDeadlineMs: Type.Union([Type.Integer(), Type.Null()]),
  },
  strict,
);
/** Role-filtered live battle projection. */
export const BattleProjectionSchema = Type.Object(
  {
    ...ProjectionBase,
    phase: Type.Literal("battle"),
    turnSeat: SeatSchema,
    shotsRemaining: Type.Integer({ minimum: 1 }),
    actionDeadlineMs: Type.Union([Type.Integer(), Type.Null()]),
    lastShot: Type.Union([LastShotSchema, Type.Null()]),
    view: Type.Union([PlayerBattleViewSchema, SpectatorBattleViewSchema]),
  },
  strict,
);
/** Terminal projection retained by already-connected browsers. */
export const CompletedProjectionSchema = Type.Object(
  {
    ...ProjectionBase,
    phase: Type.Literal("completed"),
    winnerSeat: Type.Union([SeatSchema, Type.Null()]),
    reason: CompletionReasonSchema,
    lastShot: Type.Union([LastShotSchema, Type.Null()]),
    view: Type.Union([
      PlayerBattleViewSchema,
      SpectatorBattleViewSchema,
      Type.Null(),
    ]),
  },
  strict,
);
export const ProjectionSchema = Type.Union([
  PlacementProjectionSchema,
  BattleProjectionSchema,
  CompletedProjectionSchema,
]);
export type MatchProjection = Static<typeof ProjectionSchema>;
export type PlacementProjection = Static<typeof PlacementProjectionSchema>;
export type BattleProjection = Static<typeof BattleProjectionSchema>;
export type CompletedProjection = Static<typeof CompletedProjectionSchema>;

/** Server socket envelope for replacement state or expected command errors. */
export const ServerMessageSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("projection"), projection: ProjectionSchema },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal("commandRejected"),
      requestId: UuidSchema,
      code: Type.String(),
      message: Type.String(),
      revision: Type.Integer({ minimum: 0 }),
    },
    strict,
  ),
]);
export type ServerMessage = Static<typeof ServerMessageSchema>;
