/** Explicit old-style terminal popup layered over the retained final boards. */

import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useNavigate } from "react-router-dom";
import type { CompletedProjection } from "@battleship/contracts";
import { Button } from "./ui";

/** Present the terminal result without removing the final projected boards. */
export function CompletionDialog({
  projection,
}: Readonly<{ projection: CompletedProjection }>) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const viewerSeat =
    projection.viewer.role === "player" ? projection.viewer.seat : null;
  const heading =
    projection.winnerSeat === null
      ? "Game Ended Prematurely."
      : viewerSeat === null
        ? `${projection.participants[projection.winnerSeat - 1]?.name ?? `Player ${projection.winnerSeat}`} won!`
        : projection.winnerSeat === viewerSeat
          ? "Congratulations! You won!"
          : "Game Over! You lost.";
  const detail = {
    fleet_destroyed: "A fleet was completely destroyed.",
    no_players_connected: "No human players remained connected.",
    server_restart:
      "The server restarted. Active games are intentionally not restored.",
    placement_expired: "The placement session expired after inactivity.",
    battle_expired: "The battle expired after inactivity.",
  }[projection.reason];

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[1200] bg-black/50" />
        <AlertDialog.Content className="safe-dialog fixed top-1/2 left-1/2 z-[1201] max-h-[90vh] w-[min(90vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg bg-white p-5 shadow-[0_4px_12px_rgb(0_0_0/0.15)]">
          <AlertDialog.Title className="text-center text-2xl font-bold">
            {heading}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-center text-[#555]">
            {detail}
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col items-center gap-4">
            {projection.view && (
              <AlertDialog.Cancel asChild>
                <Button variant="neutral">Review Boards</Button>
              </AlertDialog.Cancel>
            )}
            <AlertDialog.Action asChild>
              <Button onClick={() => void navigate("/")}>Back to Home</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
