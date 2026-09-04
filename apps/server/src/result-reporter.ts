/** One-shot delivery of completed hub matches to the shared hub protocol. */

import type { Logger } from "pino";
import type { HubConfig } from "./config";
import { encodeHubResult } from "./hub-protocol";
import type { StoredMatch } from "./repository";

const HUB_RESULT_PATH = "/api/result/battleship";
const RESULT_REQUEST_TIMEOUT_MS = 10_000;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Send each hub result once without delaying terminal browser state. */
export class HubResultReporter {
  public constructor(
    private readonly hub: HubConfig,
    private readonly logger: Logger,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  /** Report one completed hub match and log its final delivery outcome. */
  public async report(match: StoredMatch): Promise<void> {
    if (!this.hub.enabled || match.source !== "hub") return;

    try {
      const response = await this.fetcher(
        new URL(HUB_RESULT_PATH, this.hub.hubBaseUrl),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(encodeHubResult(match)),
          signal: AbortSignal.timeout(RESULT_REQUEST_TIMEOUT_MS),
        },
      );
      if (response.status === 200) {
        this.logger.info(
          { matchId: match.id, roomUuid: match.hubMatchId },
          "Hub result delivered",
        );
        return;
      }
      this.logger.error(
        {
          matchId: match.id,
          roomUuid: match.hubMatchId,
          status: response.status,
        },
        "Hub rejected match result",
      );
    } catch (cause) {
      this.logger.error(
        { err: cause, matchId: match.id, roomUuid: match.hubMatchId },
        "Hub result delivery failed",
      );
    }
  }
}
