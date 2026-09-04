/** Typed server configuration loaded from the canonical environment variables. */

import {
  Settings,
  createSyncSettings,
  defineConfigSync,
  fromEnvironmentSync,
  type SyncSettingsResolver,
} from "tydantic-settings";

const HTTP_URL_PATTERN = "^https?://\\S+$";

const databaseProperties = {
  dbUser: Settings.String({ minLength: 1 }),
  dbPassword: Settings.String({ minLength: 1 }),
  dbName: Settings.String({ minLength: 1 }),
  dbHost: Settings.String({ minLength: 1 }),
  dbPort: Settings.Number({ minimum: 1, maximum: 65_535 }),
  dbSsl: Settings.Boolean(),
};

function databaseUrl(config: {
  dbUser: string;
  dbPassword: string;
  dbName: string;
  dbHost: string;
  dbPort: number;
  dbSsl: boolean;
}): string {
  const ssl = config.dbSsl ? "?sslmode=require" : "";
  return `postgresql://${encodeURIComponent(config.dbUser)}:${encodeURIComponent(config.dbPassword)}@${config.dbHost}:${config.dbPort}/${encodeURIComponent(config.dbName)}${ssl}`;
}

const DatabaseSettings = Settings(databaseProperties, { databaseUrl });

type ComputedInput = {
  corsAllowedOrigins: string;
  hubEnabled: boolean;
  hubBaseUrl: string;
  publicBaseUrl: string;
};

/** Hub settings whose disabled variant cannot carry partial credentials. */
export type HubConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      hubBaseUrl: string;
      publicBaseUrl: string;
    }>;

const AppSettings = Settings(
  {
    ...databaseProperties,
    serverPort: Settings.Number({ default: 8000, minimum: 1, maximum: 65_535 }),
    corsAllowedOrigins: Settings.String({ default: "" }),
    logLevel: Settings.Union([
      Settings.Literal("fatal"),
      Settings.Literal("error"),
      Settings.Literal("warn"),
      Settings.Literal("info"),
      Settings.Literal("debug"),
      Settings.Literal("trace"),
      Settings.Literal("silent"),
    ]),
    nodeEnv: Settings.Union([
      Settings.Literal("development"),
      Settings.Literal("test"),
      Settings.Literal("production"),
    ]),
    hubEnabled: Settings.Boolean(),
    hubBaseUrl: Settings.Union([
      Settings.Literal(""),
      Settings.String({ pattern: HTTP_URL_PATTERN }),
    ]),
    publicBaseUrl: Settings.Union([
      Settings.Literal(""),
      Settings.String({ pattern: HTTP_URL_PATTERN }),
    ]),
  },
  {
    databaseUrl,
    // Convert the human-friendly comma-separated variable once so route code
    // receives validated origins rather than parsing configuration repeatedly.
    corsOrigins: (config: ComputedInput): readonly string[] => {
      const origins = config.corsAllowedOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
      if (
        origins.some((origin) => {
          try {
            const url = new URL(origin);
            return (
              !["http:", "https:"].includes(url.protocol) ||
              !url.host ||
              url.pathname !== "/" ||
              Boolean(url.search || url.hash)
            );
          } catch {
            return true;
          }
        })
      ) {
        throw new Error(
          "CORS_ALLOWED_ORIGINS must contain comma-separated URL origins.",
        );
      }
      return Object.freeze(origins);
    },
    // The discriminated result makes partial hub URL configuration
    // unrepresentable after startup.
    hub: (config: ComputedInput): HubConfig => {
      const hasHubUrl = Boolean(config.hubBaseUrl);
      const hasPublicUrl = Boolean(config.publicBaseUrl);
      if (hasHubUrl !== hasPublicUrl || config.hubEnabled !== hasHubUrl) {
        throw new Error(
          "Hub configuration requires both base URLs when enabled and neither when disabled.",
        );
      }
      if (!config.hubEnabled) return { enabled: false };

      // Origins deliberately exclude paths so protocol routes and browser
      // links resolve identically in every deployment.
      const hubBaseUrl = new URL(config.hubBaseUrl);
      const publicBaseUrl = new URL(config.publicBaseUrl);
      if (
        [hubBaseUrl, publicBaseUrl].some(
          (url) =>
            !["http:", "https:"].includes(url.protocol) ||
            url.pathname !== "/" ||
            Boolean(url.search || url.hash),
        )
      ) {
        throw new Error(
          "HUB_BASE_URL and PUBLIC_BASE_URL must be HTTP(S) origins without paths, queries, or fragments.",
        );
      }
      return {
        enabled: true,
        hubBaseUrl: hubBaseUrl.origin,
        publicBaseUrl: publicBaseUrl.origin,
      };
    },
  },
);

const { getConfig: getServerConfig } = defineConfigSync(AppSettings, {
  nestingSeparator: "__",
  resolvers: [fromEnvironmentSync()],
});

export type ServerConfig = ReturnType<typeof getServerConfig>;
export type DatabaseConfig = Readonly<{ databaseUrl: string }>;
export type AppConfig = Readonly<Pick<ServerConfig, "corsOrigins" | "hub">>;

function validateComputedConfig(config: ServerConfig): ServerConfig {
  // Tydantic computed fields are lazy getters, so touch them during startup.
  void config.databaseUrl;
  void config.corsOrigins;
  void config.hub;
  return config;
}

/**
 * Load the validated process configuration from the environment.
 *
 * Computed fields are forced before returning so malformed values fail during
 * startup rather than on their first later use.
 */
export function getConfig(): ServerConfig {
  return validateComputedConfig(getServerConfig());
}

function fromRecord(
  environment: Readonly<Record<string, string | undefined>>,
): SyncSettingsResolver {
  return () =>
    Object.fromEntries(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
}

/**
 * Load full settings from an explicit record for isolated tooling and tests.
 *
 * @param environment - Canonical environment keys to decode.
 * @returns Fully parsed settings, including computed database and hub values.
 */
export function loadConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  return validateComputedConfig(
    createSyncSettings(AppSettings, [fromRecord(environment)], {
      nestingSeparator: "__",
    }),
  );
}

/** Load only database settings so Drizzle does not require server variables. */
export function loadDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DatabaseConfig {
  return createSyncSettings(DatabaseSettings, [fromRecord(environment)], {
    nestingSeparator: "__",
  });
}
