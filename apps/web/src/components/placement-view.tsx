/** Legacy placement controls, confirmation popup, and public waiting view. */

import { useEffect } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { observer } from "mobx-react-lite";
import type { PlacementProjection } from "@battleship/contracts";
import { PlacementDraftStore } from "../stores/placement-draft-store";
import { MatchSessionStore } from "../stores/match-session-store";
import { PlacementBoard } from "./placement-board";
import { Button } from "./ui";

function DiceFiveIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="currentColor"
    >
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="7" cy="7" r="1.5" />
      <circle cx="17" cy="7" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="7" cy="17" r="1.5" />
      <circle cx="17" cy="17" r="1.5" />
    </svg>
  );
}

/** Render editable player placement or a privacy-preserving spectator wait view. */
export const PlacementView = observer(function PlacementView({
  projection,
  session,
  draft,
}: Readonly<{
  projection: PlacementProjection;
  session: MatchSessionStore;
  draft: PlacementDraftStore;
}>) {
  const readyPlayers = projection.participants.filter(
    ({ ready }) => ready,
  ).length;
  const participant =
    projection.viewer.role === "player"
      ? projection.participants[projection.viewer.seat - 1]
      : null;

  // Only an authoritative ready projection makes the local draft irreversible.
  useEffect(() => {
    if (participant?.ready && !draft.locked) draft.lock();
  }, [draft, participant?.ready]);

  if (projection.viewer.role === "spectator") {
    return (
      <section className="flex min-h-52 flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-primary text-2xl font-bold">
          Players are placing their ships
        </h2>
        <p className="max-w-lg text-[#666] italic">
          Fleet positions remain hidden while you wait. {readyPlayers}/2 players
          are ready.
        </p>
      </section>
    );
  }

  if (!participant) return null;
  const editingLocked = participant.ready || draft.locked;

  return (
    <section
      className="placement-view relative flex min-h-0 w-full flex-1 flex-col items-center"
      aria-label="Place your fleet"
    >
      <div className="placement-actions mb-4 flex shrink-0 flex-wrap items-center justify-center gap-3">
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild>
            <Button
              variant="success"
              disabled={
                editingLocked ||
                !draft.allPlaced ||
                session.pendingRequestIds.size > 0
              }
            >
              Ready! <span className="ml-1">({readyPlayers}/2)</span>
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-[1200] bg-black/50" />
            <AlertDialog.Content className="safe-dialog fixed top-1/2 left-1/2 z-[1201] max-h-[90vh] w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg bg-white p-5 shadow-[0_4px_12px_rgb(0_0_0/0.15)]">
              <AlertDialog.Title className="text-center text-xl font-bold">
                Ready to start the game?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-3 text-center text-[#555]">
                Once ready, you cannot change your ship placement.
              </AlertDialog.Description>
              <div className="mt-6 flex flex-wrap justify-center gap-4">
                <AlertDialog.Cancel asChild>
                  <Button variant="neutral">Keep Editing</Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button
                    variant="success"
                    onClick={() => session.ready(draft.placements)}
                  >
                    Ready!
                  </Button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>

        <Button
          variant="danger"
          disabled={editingLocked}
          onClick={() => draft.reset()}
        >
          Reset
        </Button>

        <Button
          aria-label="Randomize unplaced ships"
          className="gap-1.5"
          disabled={editingLocked}
          onClick={() => draft.randomiseRemaining()}
        >
          <DiceFiveIcon /> Unplaced
        </Button>

        <Button
          aria-label="Randomize all ships"
          className="gap-1.5"
          disabled={editingLocked}
          onClick={() => draft.randomiseAll()}
        >
          <DiceFiveIcon /> All
        </Button>
      </div>

      <div className="placement-stage flex min-h-0 w-full flex-1 overflow-hidden">
        <PlacementBoard store={draft} />
      </div>
    </section>
  );
});
