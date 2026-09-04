/** Old dual-board composition with delayed action-board selection when narrow. */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import type {
  BattleProjection,
  BoardView,
  CompletedProjection,
} from "@battleship/contracts";
import type { Seat } from "@battleship/game-domain";
import { ResponsiveBattleStore } from "../stores/responsive-battle-store";
import { MatchSessionStore } from "../stores/match-session-store";
import { BattleBoard } from "./battle-board";
import { FleetDisplay } from "./fleet-display";
import { Button } from "./ui";

type BattleLikeProjection = BattleProjection | CompletedProjection;

type SeatBoard = Readonly<{
  seat: Seat;
  board: BoardView;
  label: string;
  fleetSide: "left" | "right";
}>;

type BoardGroupProps = Readonly<{
  item: SeatBoard;
  fleetLengths: readonly number[];
  opacity: number;
  interactive: boolean;
  lastShot: BattleLikeProjection["lastShot"];
  onTarget: (row: number, column: number) => void;
}>;

function opposite(seat: Seat): Seat {
  return seat === 1 ? 2 : 1;
}

/** Resolve a stable board/status label from projected match metadata. */
function participantName(projection: BattleLikeProjection, seat: Seat): string {
  return projection.participants[seat - 1]?.name ?? `Player ${seat}`;
}

function BoardGroup({
  item,
  fleetLengths,
  opacity,
  interactive,
  lastShot,
  onTarget,
}: BoardGroupProps) {
  const fleet = (
    <FleetDisplay
      fleetLengths={fleetLengths}
      board={item.board}
      side={item.fleetSide}
    />
  );
  return (
    <div className="battle-board-group flex shrink-0 items-start justify-center gap-[var(--board-fleet-gap)]">
      {item.fleetSide === "left" && fleet}
      <BattleBoard
        board={item.board}
        label={item.label}
        opacity={opacity}
        interactive={interactive}
        onTarget={onTarget}
        highlightedCoordinate={
          lastShot?.shooter === item.seat ? null : lastShot
        }
      />
      {item.fleetSide === "right" && fleet}
    </div>
  );
}

/** Render privacy-safe battle boards with responsive action-board selection. */
export const BattleView = observer(function BattleView({
  projection,
  session,
}: Readonly<{
  projection: BattleLikeProjection;
  session: MatchSessionStore;
}>) {
  const [responsive] = useState(() => new ResponsiveBattleStore());

  useEffect(() => () => responsive.dispose(), [responsive]);

  const playerSeat =
    projection.view?.kind === "player" ? projection.view.seat : null;
  const boards = useMemo<readonly [SeatBoard, SeatBoard] | null>(() => {
    const view = projection.view;
    if (!view) return null;
    return view.kind === "player"
      ? [
          {
            seat: view.seat,
            board: view.ownBoard,
            label: "Your board",
            fleetSide: "left",
          },
          {
            seat: opposite(view.seat),
            board: view.opponentBoard,
            label: `${participantName(projection, opposite(view.seat))}'s board`,
            fleetSide: "right",
          },
        ]
      : [
          {
            seat: 1,
            board: view.boards[0],
            label: `${participantName(projection, 1)}'s board`,
            fleetSide: "left",
          },
          {
            seat: 2,
            board: view.boards[1],
            label: `${participantName(projection, 2)}'s board`,
            fleetSide: "right",
          },
        ];
  }, [projection]);

  const targetedSeat =
    projection.phase === "battle" ? opposite(projection.turnSeat) : null;
  useEffect(() => {
    if (!boards) return;
    if (projection.phase === "battle") {
      responsive.observeBattle(
        opposite(projection.turnSeat),
        projection.lastShot,
      );
    } else {
      responsive.observeCompletion(boards[0].seat);
    }
  }, [boards, projection, responsive]);

  if (!boards) {
    return (
      <section className="flex min-h-48 flex-col items-center justify-center text-center">
        <h2 className="text-danger text-2xl font-bold">
          Game ended prematurely
        </h2>
        <p className="mt-3 text-[#666] italic">
          No battle boards were created before the match ended.
        </p>
      </section>
    );
  }

  const displayed =
    boards.find(({ seat }) => seat === responsive.displayedSeat) ?? boards[0];
  const targetableSeat =
    projection.phase === "battle" &&
    playerSeat !== null &&
    projection.turnSeat === playerSeat &&
    session.socketState === "connected"
      ? opposite(playerSeat)
      : null;
  const canShoot = targetableSeat !== null;
  const turnMessage =
    projection.phase === "completed"
      ? "Game over"
      : playerSeat === null
        ? `${participantName(projection, projection.turnSeat)}'s turn`
        : canShoot
          ? "Your turn"
          : `${participantName(projection, opposite(playerSeat))}'s turn`;

  const boardInteractive = (seat: Seat): boolean => seat === targetableSeat;
  const boardOpacity = (seat: Seat): number =>
    projection.phase === "completed" || targetedSeat === seat ? 1 : 0.6;

  return (
    <section className="battle-view flex min-h-0 w-full flex-1 flex-col items-center">
      <p
        className={
          projection.phase === "battle" && canShoot
            ? "turn-indicator mb-5 text-green-700"
            : "turn-indicator text-danger mb-5"
        }
      >
        {turnMessage}
        {projection.phase === "battle" && projection.mode === "salvo"
          ? ` — ${projection.shotsRemaining} shot${projection.shotsRemaining === 1 ? "" : "s"} remaining`
          : ""}
      </p>

      <div
        className={`battle-stage battle-geometry min-h-0 w-full flex-1 ${projection.phase === "completed" ? "battle-stage-completed" : ""}`}
      >
        <div className="battle-all-boards items-center justify-center gap-3">
          {boards.map((board) => (
            <BoardGroup
              key={board.seat}
              item={board}
              fleetLengths={projection.rules.fleetLengths}
              opacity={boardOpacity(board.seat)}
              interactive={boardInteractive(board.seat)}
              lastShot={projection.lastShot}
              onTarget={(row, column) => session.shoot(row, column)}
            />
          ))}
        </div>

        <div className="battle-single-board flex-col items-center justify-center gap-4">
          <BoardGroup
            item={displayed}
            fleetLengths={projection.rules.fleetLengths}
            opacity={1}
            interactive={boardInteractive(displayed.seat)}
            onTarget={(row, column) => session.shoot(row, column)}
            lastShot={projection.lastShot}
          />

          {projection.phase === "completed" && (
            <div className="battle-final-switch flex-wrap justify-center gap-3">
              {boards.map((board) => (
                <Button
                  key={board.seat}
                  variant={
                    displayed.seat === board.seat ? "primary" : "neutral"
                  }
                  onClick={() => responsive.selectFinalBoard(board.seat)}
                >
                  {board.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});
