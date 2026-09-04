/** Legacy welcome card with standalone creation, joining, and spectating. */

import { useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Value } from "@sinclair/typebox/value";
import { UuidSchema } from "@battleship/contracts";
import type { BotDifficulty, GameMode } from "@battleship/game-domain";
import { AppShell } from "../components/app-shell";
import { Button, ErrorMessage, Panel, cn } from "../components/ui";
import { createMatch, localPath, standalonePlayerId } from "../lib/api";

const modeOptions: readonly Readonly<{
  value: GameMode;
  label: string;
  explanation: string;
}>[] = [
  {
    value: "singleShot",
    label: "Single Shot",
    explanation: "Players take one shot each turn.",
  },
  {
    value: "salvo",
    label: "Salvo",
    explanation: "Players fire three shots each turn.",
  },
  {
    value: "streak",
    label: "Streak",
    explanation: "Players fire consecutive shots until they miss.",
  },
];

const difficultyOptions: readonly Readonly<{
  value: BotDifficulty;
  label: string;
}>[] = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: T;
  options: readonly Readonly<{ value: T; label: string }>[];
  onChange: (value: T) => void;
}>) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-sm font-bold text-[#555]">{label}</legend>
      <div className="flex max-w-full rounded-lg bg-[#eee] p-1 select-none">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-w-0 flex-1 cursor-pointer rounded-md border-0 px-2 py-2 text-sm transition-[background-color,box-shadow] sm:px-4 sm:text-base",
              value === option.value
                ? "bg-white font-semibold shadow-[0_2px_4px_rgb(0_0_0/0.1)]"
                : "bg-transparent font-normal hover:bg-[#e0e0e0]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Render standalone creation, join, and public spectating entry points. */
export function WelcomePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<GameMode>("singleShot");
  const [opponent, setOpponent] = useState<"human" | "bot">("human");
  const [difficulty, setDifficulty] = useState<BotDifficulty>("hard");
  const [matchId, setMatchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCreate = async (
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const common = { standalonePlayerId: standalonePlayerId(), mode };
      const response = await createMatch(
        opponent === "bot"
          ? { ...common, opponent, difficulty }
          : { ...common, opponent },
      );
      await navigate(localPath(response.playerUrl));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create the game.",
      );
    } finally {
      setBusy(false);
    }
  };

  const normalizedMatchId = matchId.trim();
  const navigateToMatch = async (kind: "join" | "spectate"): Promise<void> => {
    if (!normalizedMatchId) return;
    if (!Value.Check(UuidSchema, normalizedMatchId)) {
      setError("Enter a valid Game ID.");
      return;
    }
    const path = kind === "join" ? "join" : "spectate";
    await navigate(`/${path}/${encodeURIComponent(normalizedMatchId)}`);
  };

  return (
    <AppShell>
      <Panel className="welcome-card flex w-full max-w-[520px] flex-col items-center gap-3">
        <h1 className="text-primary mb-1 text-center text-2xl font-bold sm:text-[2rem]">
          Welcome to Battleship!
        </h1>

        <form
          onSubmit={(event) => void submitCreate(event)}
          className="flex w-full flex-col items-center gap-4"
        >
          <div className="flex w-full max-w-[400px] min-w-0 flex-col gap-3">
            <SegmentedControl
              label="Turn Rules"
              value={mode}
              options={modeOptions}
              onChange={setMode}
            />
            <p className="min-h-5 text-sm text-[#666] italic">
              {modeOptions.find((option) => option.value === mode)?.explanation}
            </p>
            <SegmentedControl
              label="Opponent"
              value={opponent}
              options={[
                { value: "human", label: "Human" },
                { value: "bot", label: "Computer" },
              ]}
              onChange={setOpponent}
            />
            {opponent === "bot" && (
              <SegmentedControl
                label="Computer Difficulty"
                value={difficulty}
                options={difficultyOptions}
                onChange={setDifficulty}
              />
            )}
          </div>

          <Button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create Game"}
          </Button>
        </form>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void navigateToMatch("join");
          }}
          onInput={() => setError(null)}
          className="mt-1 flex w-full flex-col items-center gap-2.5"
        >
          <label htmlFor="game-id-input" className="font-medium">
            Join or spectate an existing game:
          </label>
          <input
            id="game-id-input"
            value={matchId}
            onChange={(event) => setMatchId(event.target.value)}
            placeholder="Enter Game ID"
            required
            disabled={busy}
            className="focus:border-primary w-full max-w-[300px] rounded-sm border border-[#ccc] px-2 py-2 text-center text-base outline-none focus:shadow-[0_0_0_2px_rgb(0_123_255/0.25)]"
          />
          <div className="flex flex-wrap justify-center gap-3">
            <Button type="submit" variant="success">
              Join Game
            </Button>
            <Button
              type="button"
              onClick={() => void navigateToMatch("spectate")}
            >
              Spectate
            </Button>
          </div>
        </form>

        {error && <ErrorMessage message={error} />}
      </Panel>
    </AppShell>
  );
}
