/** Elysia application composition for validated HTTP and WebSocket plugins. */

import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import type { Logger } from "pino";
import type { AppConfig } from "./config";
import { MatchService } from "./match-service";
import type { MatchRepository } from "./repository";
import { createHubRoutes } from "./routes/hub";
import { createLiveRoutes } from "./routes/live";
import { createOperationsRoutes } from "./routes/operations";
import { createStandaloneRoutes } from "./routes/standalone";
import type { MatchSessionRegistry } from "./session/registry";

type AppDependencies = Readonly<{
  config: AppConfig;
  repository: MatchRepository;
  registry: MatchSessionRegistry;
  logger: Logger;
}>;

/**
 * Compose the complete transport boundary without opening a network port.
 *
 * @param dependencies - Validated configuration, persistence, and live sessions.
 * @returns An application usable by production startup, Eden, and integration tests.
 */
export function createApp({
  config,
  repository,
  registry,
  logger,
}: AppDependencies) {
  const dependencies = {
    config,
    repository,
    registry,
    logger,
    matchService: new MatchService(repository, registry),
  };

  return new Elysia({
    websocket: {
      idleTimeout: 30,
      maxPayloadLength: 64 * 1_024,
    },
  })
    .use(
      cors({
        origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
      }),
    )
    .use(
      openapi({
        path: "/openapi",
        documentation: {
          info: {
            title: "Battleship API",
            version: "1.0.0",
            description:
              "Standalone lifecycle, persistent game-hub match creation, and live WebSocket contracts.",
          },
        },
      }),
    )
    .onError(({ code, error, status }) => {
      if (code === "VALIDATION") {
        return status(400, {
          code: "invalid_request",
          message: "The request does not match the documented schema.",
        });
      }
      logger.error({ code, err: error }, "Unhandled request error");
      return status(500, {
        code: "internal_error",
        message: "The server could not complete this request.",
      });
    })
    .use(createOperationsRoutes(dependencies))
    .use(createStandaloneRoutes(dependencies))
    .use(createHubRoutes(dependencies))
    .use(createLiveRoutes(dependencies));
}

export type App = ReturnType<typeof createApp>;
