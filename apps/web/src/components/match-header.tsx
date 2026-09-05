/** Legacy Game ID card, restrained connection copy, and server deadline timer. */

import { useState } from "react";
import { observer } from "mobx-react-lite";
import type { MatchProjection } from "@battleship/contracts";
import { MatchSessionStore } from "../stores/match-session-store";

/** Render shareable match identity, connection state, and stable timer slot. */
export const MatchHeader = observer(function MatchHeader({
  projection,
  store,
}: Readonly<{ projection: MatchProjection; store: MatchSessionStore }>) {
  const [copied, setCopied] = useState(false);
  const copyId = async (): Promise<void> => {
    await navigator.clipboard.writeText(projection.matchId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const otherParticipant =
    projection.viewer.role === "player"
      ? projection.participants[projection.viewer.seat === 1 ? 1 : 0]
      : null;
  const connectionText =
    projection.viewer.role === "spectator"
      ? store.socketState === "connected"
        ? "Spectating live game..."
        : "Reconnecting to the live game..."
      : !otherParticipant || otherParticipant.descriptor.kind === "open"
        ? "Waiting for opponent to connect..."
        : otherParticipant.descriptor.kind === "bot"
          ? `${otherParticipant.name} ready (${otherParticipant.descriptor.difficulty})`
          : otherParticipant.connected
            ? `${otherParticipant.name} connected`
            : `${otherParticipant.name} disconnected`;

  const seconds = store.remainingSeconds;
  const timerRelevant =
    seconds !== null &&
    (projection.phase === "placement" ||
      (projection.phase === "battle" &&
        projection.participants[projection.turnSeat - 1]?.descriptor.kind ===
          "human"));
  const timer = !timerRelevant
    ? null
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <header className="match-header mb-4 flex w-full shrink-0 flex-col items-center">
      <section className="match-id-card text-primary mx-auto my-3 flex w-full max-w-[448px] items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-center text-lg font-semibold shadow-[0_2px_12px_rgb(0_0_0/0.08)] sm:px-6 sm:text-xl">
        <span className="min-w-0 break-all">
          Game ID: <span>{projection.matchId}</span>
        </span>
        <button
          type="button"
          onClick={() => void copyId()}
          aria-label="Copy complete Game ID"
          className="text-primary active:bg-primary shrink-0 cursor-pointer rounded-sm border-0 bg-transparent px-2.5 py-1 text-xl leading-none font-bold hover:bg-[#e3eaf6] active:text-white"
        >
          {copied ? "✓" : "⧉"}
        </button>
      </section>

      <div className="match-status-row flex min-h-12 w-full items-center justify-center gap-3 text-center">
        <p className="connection-status text-[#444] italic">{connectionText}</p>
        <button
          type="button"
          onClick={() => void copyId()}
          aria-label="Copy complete Game ID"
          className="mobile-match-id-copy text-primary hover:bg-primary active:bg-primary hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-2 border-current bg-white px-2.5 py-1.5 text-sm font-semibold hover:text-white active:text-white"
        >
          <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
          {copied ? "Copied" : "Copy Game ID"}
        </button>
        <div className="timer-slot flex h-12 w-[4.75rem] shrink-0 items-center justify-center">
          {timer !== null && (
            <div
              aria-live="polite"
              aria-label={`${seconds} seconds remaining`}
              className="w-full rounded-lg border-2 border-[#ccc] bg-[#f9f9f9] px-2 py-2 text-center text-xl font-bold text-[#333] tabular-nums"
            >
              {timer}
            </div>
          )}
        </div>
      </div>
    </header>
  );
});
