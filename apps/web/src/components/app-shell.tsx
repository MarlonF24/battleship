/**
 * Provide the shared page frame and its optional game-specific height cascade.
 *
 * `gameLayout` marks routes whose board must take priority over decorative
 * chrome on short screens. CSS uses that marker to hide the title and match ID
 * in stages while the welcome route keeps its ordinary centered-card layout.
 */

import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";

export function AppShell({
  children,
  gameLayout = false,
}: PropsWithChildren<Readonly<{ gameLayout?: boolean }>>) {
  return (
    <div
      className={`app-shell bg-page h-dvh ${gameLayout ? "game-shell overflow-hidden" : "overflow-x-hidden overflow-y-auto"}`}
    >
      <header className="app-title-bar bg-header py-5 text-center text-white shadow-[0_2px_8px_rgb(0_0_0/0.04)]">
        <Link
          to="/"
          className="inline-block rounded-sm text-[2.5rem] leading-tight font-black tracking-tight"
        >
          Battleship
        </Link>
      </header>
      <main className="app-main mx-auto flex w-full max-w-[1200px] flex-col items-center overflow-hidden px-2 py-3 sm:px-4 sm:py-5">
        {children}
      </main>
    </div>
  );
}
