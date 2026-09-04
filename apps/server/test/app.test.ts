/** Focused integration coverage for lifecycle routes, seat tokens, and hub access. */

import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  CreateMatchResponseSchema,
  HubCreateMatchResponseSchema,
  JoinMatchResponseSchema,
  type CreateMatchResponse,
  type HubCreateMatchWireResponse,
  type JoinMatchResponse,
} from "@battleship/contracts";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { decodeHubMatchRequest } from "../src/hub-protocol";
import { MatchSessionRegistry } from "../src/session/registry";
import { MemoryMatchRepository } from "../src/testing/memory-repository";
import { silentLogger } from "./helpers";

const config: AppConfig = Object.freeze({
  corsOrigins: [],
  hub: {
    enabled: true as const,
    hubBaseUrl: "https://hub.example",
    publicBaseUrl: "https://battleship.example",
  },
});

function testApp(appConfig: AppConfig = config) {
  const repository = new MemoryMatchRepository();
  const registry = new MatchSessionRegistry({
    repository,
    logger: silentLogger,
  });
  return {
    repository,
    app: createApp({
      config: appConfig,
      repository,
      registry,
      logger: silentLogger,
    }),
  };
}

async function createLinks(response: Response): Promise<CreateMatchResponse> {
  const body: unknown = await response.json();
  if (!Value.Check(CreateMatchResponseSchema, body)) {
    throw new Error("Expected a valid create-match response.");
  }
  return body;
}

async function joinLinks(response: Response): Promise<JoinMatchResponse> {
  const body: unknown = await response.json();
  if (!Value.Check(JoinMatchResponseSchema, body)) {
    throw new Error("Expected a valid join-match response.");
  }
  return body;
}

async function hubLinks(
  response: Response,
): Promise<HubCreateMatchWireResponse & Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!Value.Check(HubCreateMatchResponseSchema, body)) {
    throw new Error("Expected a valid hub match response.");
  }
  return body;
}

describe("lifecycle HTTP API", () => {
  test("creates a standalone match and claims seat two idempotently", async () => {
    const { app, repository } = testApp();
    const firstPlayer = "11111111-1111-4111-8111-111111111111";
    const secondPlayer = "22222222-2222-4222-8222-222222222222";
    const created = await app.handle(
      new Request("http://localhost/api/v1/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          standalonePlayerId: firstPlayer,
          mode: "singleShot",
          opponent: "human",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const links = await createLinks(created);
    expect(links.kind).toBe("humanMatch");
    if (links.kind !== "humanMatch") {
      throw new Error("Expected a human match.");
    }
    expect(links.joinUrl).toContain("/join/");
    expect(links.playerUrl).toContain("/player/");
    expect(links.spectatorUrl).toBe(`/spectate/${links.matchId}`);

    const joined = await app.handle(
      new Request(`http://localhost/api/v1/matches/${links.matchId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ standalonePlayerId: secondPlayer }),
      }),
    );
    expect(joined.status).toBe(200);
    const joinedAgain = await app.handle(
      new Request(`http://localhost/api/v1/matches/${links.matchId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ standalonePlayerId: secondPlayer }),
      }),
    );
    expect(joinedAgain.status).toBe(200);
    expect((await joinLinks(joinedAgain)).playerUrl).toBe(
      (await joinLinks(joined)).playerUrl,
    );

    // Reusing the browser UUID in another match resolves the same player row.
    const repeatedPlayer = await app.handle(
      new Request("http://localhost/api/v1/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          standalonePlayerId: firstPlayer,
          mode: "salvo",
          opponent: "bot",
        }),
      }),
    );
    expect(repeatedPlayer.status).toBe(201);
    expect(repository.playerCount).toBe(2);
  });

  test("prevents seat one from claiming its own open seat", async () => {
    const { app } = testApp();
    const player = "11111111-1111-4111-8111-111111111111";
    const created = await app.handle(
      new Request("http://localhost/api/v1/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          standalonePlayerId: player,
          mode: "singleShot",
          opponent: "human",
        }),
      }),
    );
    const links = await createLinks(created);
    const response = await app.handle(
      new Request(`http://localhost/api/v1/matches/${links.matchId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ standalonePlayerId: player }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({ code: "already_participating" }),
    );
  });

  test("creates UUID-keyed hub matches idempotently with absolute links", async () => {
    const { app, repository } = testApp();
    const hubPlayer = "11111111-1111-4111-8111-111111111111";
    const hubBot = "22222222-2222-4222-8222-222222222222";
    const request = {
      room_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      [hubPlayer]: { name: "Alice", difficulty: "player" },
      [hubBot]: { name: "Admiral Bot", difficulty: "normal" },
      config: {},
    };

    const { app: disabledApp } = testApp({
      corsOrigins: [],
      hub: { enabled: false },
    });
    const disabled = await disabledApp.handle(
      new Request("http://localhost/api/v1/hub/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
    expect(disabled.status).toBe(503);

    const send = () =>
      app.handle(
        new Request("http://localhost/api/v1/hub/matches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
    const created = await send();
    const repeated = await send();
    expect(created.status).toBe(200);
    expect(repeated.status).toBe(200);
    const createdLinks = await hubLinks(created);
    const repeatedLinks = await hubLinks(repeated);
    expect(repeatedLinks).toEqual(createdLinks);
    expect(createdLinks.room_uuid).toBe(request.room_uuid);
    expect(createdLinks.config.spectator_link).toStartWith(
      "https://battleship.example/spectate/",
    );
    expect(createdLinks[hubPlayer]).toEqual({
      controller_link: expect.stringContaining(
        "https://battleship.example/matches/",
      ),
    });
    expect(createdLinks[hubBot]).toEqual({ controller_link: "" });
    const stored = await repository.findHubMatch(request.room_uuid);
    expect(stored?.mode).toBe("singleShot");
    expect(stored?.seats[0]).toMatchObject({ name: "Alice", kind: "human" });
    expect(stored?.seats[1]).toMatchObject({
      name: "Admiral Bot",
      kind: "bot",
      difficulty: "normal",
    });

    const conflict = await app.handle(
      new Request("http://localhost/api/v1/hub/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...request,
          config: { mode: "streak" },
        }),
      }),
    );
    expect(conflict.status).toBe(409);

    // Equal UUID text remains distinct across hub and standalone namespaces.
    const standalone = await app.handle(
      new Request("http://localhost/api/v1/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          standalonePlayerId: hubPlayer,
          mode: "singleShot",
          opponent: "bot",
        }),
      }),
    );
    expect(standalone.status).toBe(201);
    expect(repository.playerCount).toBe(2);
  });

  test("rejects invalid hub participant topology at the transport boundary", () => {
    const participant = { name: "Bot", difficulty: "easy" };
    expect(
      decodeHubMatchRequest({
        room_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "not-a-uuid": participant,
        "22222222-2222-4222-8222-222222222222": participant,
        config: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(
      decodeHubMatchRequest({
        room_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "11111111-1111-4111-8111-111111111111": participant,
        config: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "participant_count" } });
    expect(
      decodeHubMatchRequest({
        room_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "11111111-1111-4111-8111-111111111111": participant,
        "22222222-2222-4222-8222-222222222222": participant,
        config: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "human_required" } });
  });

  test("documents the public hub creation route without obsolete security", async () => {
    const { app } = testApp();
    const response = await app.handle(
      new Request("http://localhost/openapi/json"),
    );
    const document = (await response.json()) as {
      components?: { securitySchemes?: Record<string, unknown> };
      paths?: Record<
        string,
        { get?: { security?: unknown }; post?: { security?: unknown } }
      >;
    };

    expect(document.components?.securitySchemes?.hubBearer).toBeUndefined();
    expect(
      document.paths?.["/api/v1/hub/matches"]?.post?.security,
    ).toBeUndefined();
    expect(document.paths?.["/api/v1/matches"]?.post?.security).toBeUndefined();
  });
});
