CREATE TYPE "public"."bot_difficulty" AS ENUM('easy', 'normal', 'hard');--> statement-breakpoint
CREATE TYPE "public"."completion_reason" AS ENUM('fleet_destroyed', 'no_players_connected', 'server_restart', 'placement_expired', 'battle_expired');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('singleShot', 'salvo', 'streak');--> statement-breakpoint
CREATE TYPE "public"."match_phase" AS ENUM('placement', 'battle', 'completed');--> statement-breakpoint
CREATE TYPE "public"."match_source" AS ENUM('standalone', 'hub');--> statement-breakpoint
CREATE TYPE "public"."match_outcome" AS ENUM('win', 'loss', 'premature');--> statement-breakpoint
CREATE TYPE "public"."player_identity_source" AS ENUM('standalone', 'hub');--> statement-breakpoint
CREATE TYPE "public"."seat_kind" AS ENUM('human', 'bot');--> statement-breakpoint
CREATE TABLE "match_seats" (
	"match_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"kind" "seat_kind" NOT NULL,
	"player_id" uuid,
	"seat_token" uuid,
	"bot_difficulty" "bot_difficulty",
	"outcome" "match_outcome",
	CONSTRAINT "match_seats_match_id_seat_pk" PRIMARY KEY("match_id","seat"),
	CONSTRAINT "match_seats_number_check" CHECK ("match_seats"."seat" in (1, 2)),
	CONSTRAINT "match_seats_kind_access_check" CHECK (("match_seats"."kind" = 'human' and "match_seats"."player_id" is not null and "match_seats"."seat_token" is not null and "match_seats"."bot_difficulty" is null) or ("match_seats"."kind" = 'bot' and "match_seats"."player_id" is null and "match_seats"."seat_token" is null and "match_seats"."bot_difficulty" is not null))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hub_match_id" uuid,
	"hub_request" jsonb,
	"source" "match_source" NOT NULL,
	"mode" "match_mode" NOT NULL,
	"phase" "match_phase" DEFAULT 'placement' NOT NULL,
	"winner_seat" integer,
	"terminal_reason" "completion_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "matches_winner_seat_check" CHECK ("matches"."winner_seat" is null or "matches"."winner_seat" in (1, 2)),
	CONSTRAINT "matches_source_hub_metadata_check" CHECK (("matches"."source" = 'hub' and "matches"."hub_match_id" is not null and "matches"."hub_request" is not null) or ("matches"."source" = 'standalone' and "matches"."hub_match_id" is null and "matches"."hub_request" is null))
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_source" "player_identity_source" NOT NULL,
	"external_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_seats" ADD CONSTRAINT "match_seats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_seats" ADD CONSTRAINT "match_seats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_seats_human_unique" ON "match_seats" USING btree ("match_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_seats_seat_token_unique" ON "match_seats" USING btree ("seat_token");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_hub_match_id_unique" ON "matches" USING btree ("hub_match_id");--> statement-breakpoint
CREATE INDEX "matches_nonterminal_activity_idx" ON "matches" USING btree ("phase","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "players_identity_unique" ON "players" USING btree ("identity_source","external_id");