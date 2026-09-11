/** Browser WebSocket state reduced to the latest authoritative projection. */

import { makeAutoObservable, runInAction } from "mobx";
import {
  type MatchProjection,
  type PlayerCommand,
  type ServerMessage,
} from "@battleship/contracts";
import type { ShipPlacement } from "@battleship/game-domain";
import {
  browserUuid,
  connectLiveMatch,
  type LiveMatchConnection,
  type LiveMatchIdentity,
} from "../lib/api";

export type SessionIdentity = LiveMatchIdentity;

/** Observable transport state used only for connection-related presentation. */
export type SocketState =
  "connecting" | "connected" | "reconnecting" | "closed";

const DEADLINE_DISPLAY_TOLERANCE_MS = 100;

/**
 * Retain one complete server projection and connection metadata.
 *
 * Reconnection atomically replaces the projection; no gameplay event history
 * is merged or reconstructed in the browser.
 */
export class MatchSessionStore {
  public projection: MatchProjection | null = null;
  public socketState: SocketState = "connecting";
  public rejection: string | null = null;
  public nowMs = Date.now();
  public pendingRequestIds = new Set<string>();
  private socket: LiveMatchConnection | null = null;
  private reconnectHandle: number | null = null;
  private clockHandle: ReturnType<typeof setInterval> | null = null;
  private serverClockOffsetMs = 0;
  private disposed = false;

  public constructor(public readonly identity: SessionIdentity) {
    makeAutoObservable<this, "socket" | "reconnectHandle" | "clockHandle">(
      this,
      {
        identity: false,
        socket: false,
        reconnectHandle: false,
        clockHandle: false,
      },
      { autoBind: true },
    );
  }

  public get deadlineMs(): number | null {
    if (!this.projection) return null;
    return this.projection.phase === "placement"
      ? this.projection.placementDeadlineMs
      : this.projection.phase === "battle"
        ? this.projection.actionDeadlineMs
        : null;
  }

  public get remainingSeconds(): number | null {
    if (this.deadlineMs === null) return null;
    const serverNow = this.nowMs + this.serverClockOffsetMs;
    return Math.max(
      0,
      Math.ceil(
        (this.deadlineMs - serverNow - DEADLINE_DISPLAY_TOLERANCE_MS) / 1_000,
      ),
    );
  }

  public get completed(): boolean {
    return this.projection?.phase === "completed";
  }

  /**
   * Open the role-specific socket encoded by the trusted link.
   *
   * The method is idempotent for an open connection and restartable after
   * disposal, which supports both route remounts and React's development probe.
   */
  public connect(): void {
    if (this.socket?.socket.readyState === WebSocket.OPEN) {
      return;
    }

    // React Strict Mode deliberately mounts, cleans up, and mounts effects again
    // in development. Restart resources here so that probe exercises the real
    // cleanup path without preventing the second, durable connection.
    this.disposed = false;
    this.clockHandle ??= globalThis.setInterval(() => {
      this.nowMs = Date.now();
    }, 250);
    this.socketState = this.projection ? "reconnecting" : "connecting";
    const connection = connectLiveMatch(this.identity, {
      open: () => {
        console.info("Live match connection opened.", {
          role: this.identity.role,
          matchId: this.identity.matchId,
        });
        runInAction(() => {
          this.socketState = "connected";
          this.rejection = null;
        });
      },
      message: (message) => this.acceptServerMessage(message),
      close: (event) => this.handleClose(connection, event),
      error: () => {
        console.error("Live match connection failed.", {
          role: this.identity.role,
          matchId: this.identity.matchId,
        });
        connection.close();
      },
    });
    this.socket = connection;
  }

  /** Submit the complete local draft; only player identities may command. */
  public ready(fleet: readonly ShipPlacement[]): string | null {
    return this.sendPlayerCommand({
      type: "ready",
      requestId: browserUuid(),
      fleet: [...fleet],
    });
  }

  /** Ask the server to resolve a target coordinate. */
  public shoot(row: number, column: number): string | null {
    return this.sendPlayerCommand({
      type: "shoot",
      requestId: browserUuid(),
      row,
      column,
    });
  }

  /** Stop reconnection and browser clock updates when the route unmounts. */
  public dispose(): void {
    this.disposed = true;
    if (this.clockHandle !== null) {
      globalThis.clearInterval(this.clockHandle);
      this.clockHandle = null;
    }
    if (this.reconnectHandle !== null) {
      window.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    this.socket?.close(1000, "Route closed.");
    this.socket = null;
  }

  private sendPlayerCommand(command: PlayerCommand): string | null {
    if (
      this.identity.role !== "player" ||
      this.socket?.socket.readyState !== WebSocket.OPEN ||
      !this.socket.send
    ) {
      this.rejection = "The match connection is not ready yet.";
      return null;
    }
    this.pendingRequestIds.add(command.requestId);
    this.socket.send(command);
    return command.requestId;
  }

  /** Apply one already validated message; useful at the socket and test boundary. */
  public acceptServerMessage(message: ServerMessage): void {
    if (message.type === "commandRejected") {
      this.pendingRequestIds.delete(message.requestId);
      this.rejection = message.message;
      return;
    }
    if (
      this.projection &&
      message.projection.revision <= this.projection.revision
    ) {
      return;
    }

    // One complete newer projection supersedes all pending optimistic UI state.
    this.projection = message.projection;
    this.serverClockOffsetMs = message.projection.serverTimeMs - Date.now();
    this.pendingRequestIds.clear();
    this.rejection = null;
  }

  private handleClose(socket: LiveMatchConnection, event: CloseEvent): void {
    // A replaced connection may close after its successor opens. Identity
    // checking prevents that stale event from tearing down the live socket.
    if (this.socket !== socket) return;
    this.socket = null;
    if (this.disposed || this.completed) {
      this.socketState = "closed";
      return;
    }
    if (event.code === 1008) {
      console.warn("Live match connection was rejected.", {
        matchId: this.identity.matchId,
        reason: event.reason,
      });
      this.socketState = "closed";
      this.rejection = event.reason || "This match link is no longer valid.";
      return;
    }
    if (event.code === 1012) {
      console.warn("Live match connection closed for server restart.", {
        matchId: this.identity.matchId,
      });
      this.socketState = "closed";
      this.rejection =
        event.reason ||
        "The server restarted; active games are intentionally not resumed.";
      return;
    }

    // Protocol and restart closures are terminal; transient transport failures
    // alone enter the bounded reconnect loop.
    console.warn("Live match connection lost; retrying.", {
      matchId: this.identity.matchId,
      closeCode: event.code,
    });
    this.socketState = "reconnecting";
    this.reconnectHandle = window.setTimeout(() => {
      this.reconnectHandle = null;
      this.connect();
    }, 1_000);
  }
}
