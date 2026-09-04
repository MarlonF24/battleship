/** Structured application logger construction. */

import pino, { type Logger } from "pino";

/** Create the single JSON logger shared by server services. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: "battleship-server" },
    redact: [
      "authorization",
      "seatToken",
      "*.seatToken",
      "databaseUrl",
      "dbPassword",
      "req.headers.authorization",
    ],
  });
}
