/** Focused verification of the hub's one-shot result contract. */

import { expect, test } from "bun:test";
import { HubResultReporter } from "../src/result-reporter";
import { MemoryMatchRepository } from "../src/testing/memory-repository";
import { silentLogger } from "./helpers";

test("reports both UUID-keyed outcomes exactly once without authorization", async () => {
  const repository = new MemoryMatchRepository();
  const roomUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const humanId = "11111111-1111-4111-8111-111111111111";
  const botId = "22222222-2222-4222-8222-222222222222";
  const definition = {
    roomUuid,
    mode: "singleShot" as const,
    participants: [
      { playerId: humanId, name: "Alice", difficulty: "player" as const },
      { playerId: botId, name: "Bot", difficulty: "hard" as const },
    ] as const,
  };
  const match = await repository.createMatch({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    hubMatchId: roomUuid,
    hubRequest: definition,
    source: "hub",
    mode: definition.mode,
    seats: [
      {
        seat: 1,
        kind: "human",
        name: "Alice",
        identity: { source: "hub", externalId: humanId },
        seatToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
      { seat: 2, kind: "bot", name: "Bot", difficulty: "hard" },
    ],
  });
  const completed = await repository.completeMatch({
    matchId: match.id,
    winnerSeat: 1,
    reason: "fleet_destroyed",
  });
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const reporter = new HubResultReporter(
    {
      enabled: true,
      hubBaseUrl: "https://hub.example",
      publicBaseUrl: "https://battleship.example",
    },
    silentLogger,
    (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      requests.push({ url, init });
      return Promise.resolve(new Response(null, { status: 503 }));
    },
  );

  await reporter.report(completed);

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("https://hub.example/api/result/battleship");
  expect(requests[0]?.init?.headers).toEqual({
    "content-type": "application/json",
  });
  const body = requests[0]?.init?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON body.");
  expect(JSON.parse(body)).toEqual({
    room_uuid: roomUuid,
    [humanId]: { outcome: "win" },
    [botId]: { outcome: "loss" },
    config: {},
  });
});
