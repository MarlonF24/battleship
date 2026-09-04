/** Production process startup, recovery, SPA serving, and graceful shutdown. */

import { resolve } from "node:path";
import { createApp } from "./app";
import { getConfig, type ServerConfig } from "./config";
import { createPostgresRepository } from "./db/repository";
import { createLogger } from "./logger";
import { HubResultReporter } from "./result-reporter";
import type { StoredMatch } from "./repository";
import { createSpaRoutes } from "./routes/spa";
import { MatchSessionRegistry } from "./session/registry";

const SHUTDOWN_DRAIN_MS = 5_000;

const bootstrapLogger = createLogger("info");
let config: ServerConfig;
try {
  config = getConfig();
} catch (error) {
  bootstrapLogger.fatal({ err: error }, "Server configuration is invalid");
  process.exit(1);
}
const logger = createLogger(config.logLevel);
const repository = createPostgresRepository(config.databaseUrl);
const resultReporter = new HubResultReporter(config.hub, logger);

logger.info(
  {
    environment: config.nodeEnv,
    port: config.serverPort,
    databaseHost: config.dbHost,
    databasePort: config.dbPort,
    databaseName: config.dbName,
    databaseSsl: config.dbSsl,
    corsOriginCount: config.corsOrigins.length,
    hubEnabled: config.hub.enabled,
    hubBaseUrl: config.hub.enabled ? config.hub.hubBaseUrl : undefined,
    publicBaseUrl: config.hub.enabled ? config.hub.publicBaseUrl : undefined,
  },
  "Server configuration loaded",
);

// Any live rows predate this process and cannot have recoverable board state.
let aborted: readonly StoredMatch[];
try {
  aborted = await repository.abortNonterminalMatches();
  logger.info("Database connection and startup recovery succeeded");
} catch (error) {
  logger.fatal(
    {
      err: error,
      databaseHost: config.dbHost,
      databasePort: config.dbPort,
      databaseName: config.dbName,
      databaseSsl: config.dbSsl,
    },
    "Database startup failed",
  );
  await repository.close().catch(() => undefined);
  process.exit(1);
}
if (aborted.length > 0) {
  logger.warn(
    { count: aborted.length },
    "Marked nonterminal matches premature after server restart",
  );
}

const registry = new MatchSessionRegistry({
  repository,
  logger,
  onMatchCompleted: (match) => void resultReporter.report(match),
});
const baseApp = createApp({ config, repository, registry, logger });

// The runtime image contains the Vite output; development uses Vite directly.
const app =
  config.nodeEnv === "production"
    ? baseApp.use(
        await createSpaRoutes(resolve(import.meta.dir, "../../web/dist")),
      )
    : baseApp;

app.listen({ hostname: "0.0.0.0", port: config.serverPort });
registry.startCleanup();
for (const match of aborted) void resultReporter.report(match);
logger.info(
  { hostname: "0.0.0.0", port: config.serverPort },
  "Battleship server listening",
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  registry.shutdown();
  await app.stop(true);

  // Bound database shutdown so orchestration cannot hang indefinitely.
  await Promise.race([
    repository.close(),
    new Promise<void>((resolveDrain) => {
      setTimeout(resolveDrain, SHUTDOWN_DRAIN_MS);
    }),
  ]);
  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
