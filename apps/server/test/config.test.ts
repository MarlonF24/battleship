/** Focused startup configuration validation tests. */

import { describe, expect, test } from "bun:test";
import { loadConfig, loadDatabaseConfig } from "../src/config";

const validEnvironment = Object.freeze({
  DB_USER: "battleship",
  DB_PASSWORD: "secret:/?#[]@",
  DB_NAME: "battleship",
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_SSL: "false",
  CORS_ALLOWED_ORIGINS: "",
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  HUB_ENABLED: "false",
  HUB_BASE_URL: "",
  PUBLIC_BASE_URL: "",
});

describe("strict server configuration", () => {
  test("decodes the canonical disabled-hub shape once", () => {
    const config = loadConfig(validEnvironment);
    const drizzleConfig = loadDatabaseConfig(validEnvironment);

    expect(config.databaseUrl).toBe(
      "postgresql://battleship:secret%3A%2F%3F%23%5B%5D%40@localhost:5432/battleship",
    );
    expect(drizzleConfig.databaseUrl).toBe(config.databaseUrl);
    expect(
      loadDatabaseConfig({
        ...validEnvironment,
        DB_SSL: "true",
      }).databaseUrl.endsWith("?sslmode=require"),
    ).toBe(true);
    expect(config.serverPort).toBe(8000);
    expect(config.corsOrigins).toEqual([]);
    expect(config.hub).toEqual({ enabled: false });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("does not use removed aliases as fallbacks", () => {
    const missingDatabaseHost = Object.fromEntries(
      Object.entries(validEnvironment).filter(([name]) => name !== "DB_HOST"),
    );

    expect(() =>
      loadConfig({
        ...missingDatabaseHost,
        DATABASE_URL: "postgresql://ignored",
        CORS_ALLOW_ORIGINS: "http://ignored.example",
      }),
    ).toThrow();
  });

  test.each([
    ["invalid database port", { DB_PORT: "0" }],
    ["invalid CORS URL", { CORS_ALLOWED_ORIGINS: "not-a-url" }],
    ["unknown log level", { LOG_LEVEL: "verbose" }],
    ["unknown environment", { NODE_ENV: "staging" }],
  ])("rejects %s", (_description, override) => {
    expect(() => loadConfig({ ...validEnvironment, ...override })).toThrow();
  });

  test("requires an all-or-nothing enabled hub configuration", () => {
    expect(() =>
      loadConfig({ ...validEnvironment, HUB_BASE_URL: "https://hub.example" }),
    ).toThrow();
    expect(() =>
      loadConfig({
        ...validEnvironment,
        HUB_ENABLED: "true",
        HUB_BASE_URL: "https://hub.example",
      }),
    ).toThrow();

    const config = loadConfig({
      ...validEnvironment,
      HUB_ENABLED: "true",
      HUB_BASE_URL: "https://hub.example",
      PUBLIC_BASE_URL: "https://battleship.example",
    });
    expect(config.hub).toEqual({
      enabled: true,
      hubBaseUrl: "https://hub.example",
      publicBaseUrl: "https://battleship.example",
    });
  });
});
