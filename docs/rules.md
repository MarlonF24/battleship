# Game rules and automatic actions

`CLASSIC_RULESET` is the executable source of truth.

## Board and fleet

- Board: 10 rows by 10 columns.
- Fleet: one length-5 ship, two length-4 ships, three length-3 ships, and four length-2 ships.
- Ships are horizontal or vertical.
- Ships cannot overlap.
- Ships cannot touch, including diagonally.
- Seat one starts every battle.
- Readiness is irreversible once the server accepts the complete fleet.

The shared random fleet generator places longer ships first, shuffles legal candidates with an injected random source, and backtracks when necessary. It can generate a complete fleet or preserve a legal partial fleet while filling the remainder.

## Turn modes

| Mode         | Policy                                                |
| ------------ | ----------------------------------------------------- |
| `singleShot` | One shot, then the turn changes regardless of result. |
| `salvo`      | Exactly three shots, then the turn changes.           |
| `streak`     | A hit retains the turn; a miss changes it.            |

The same policy handles manual, timeout, reconnect-expiry, and bot shots. Repeated and out-of-turn targets are rejected without changing state.

## Timers

- When one player is ready, the other has 40 seconds to submit a fleet.
- Both-ready state waits 1.5 seconds before battle begins.
- A connected active human has 10 seconds to shoot.
- A disconnected active human has 8 seconds to reconnect.
- A bot waits 500 ms before each action so changes remain perceptible.

Deadlines are absolute server timestamps sent in projections. Browser countdowns are display-only and account for the server clock offset.

Placement expiry generates and accepts a uniformly randomized legal fleet. Shot expiry and reconnect expiry take one uniformly random legal shot for that human. These automatic human actions do not use the PDF agent.

If a reconnect succeeds before expiry, the player receives a fresh complete projection and a fresh 10-second shot deadline. If expiry takes a shot and the mode keeps that disconnected player's turn, another 8-second reconnect grace begins.

## Connections and premature results

A new socket using the same **Seat Token** replaces the prior socket. Spectators never affect abandonment. If every human player socket disconnects, the match pauses for a two-minute grace period so a mobile player can briefly leave the browser to share or reopen the game. Any player connection cancels that deadline and resumes the appropriate game timer; otherwise, the match completes prematurely with `no_players_connected`.

Server restart, extended placement inactivity, and extended battle inactivity also create explicit premature results. Active games are never resumed.

## Probability-density bot

The bot receives only `OpponentKnowledge`: public cell evidence, unresolved hits, sunk ship positions, derived impossible cells, and the remaining ship multiset. It never receives the hidden fleet.

For each remaining ship instance, the agent enumerates horizontal and vertical placements, rejects candidates that contradict public evidence, prioritizes placements covering compatible unresolved hit clusters, and accumulates occupancy weight over legal unknown cells. It chooses a maximum-density cell and uses injected randomness only to break ties. Inconsistent evidence falls back to a uniform legal target.

The same public knowledge and random seed produce the same target even when the hidden fleet changes. A compact seeded sample verifies legal targeting, performance, and a win rate of at least 70% against uniform random targeting without making routine checks unnecessarily slow.
