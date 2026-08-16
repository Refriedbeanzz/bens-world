# Ben's World — Medieval Battle Simulator — PLAN

Top-down 2D medieval battle simulator. Dynamic battlefield with terrain and obstacles.
Soldiers fight in commandable formations (Bannerlord-style orders). Unit types: pikemen,
archers, crossbowmen, swordsmen, knights, cavalry. Start with one polished battlefield —
animations, art style, pathfinding, formations, combat — then expand (more maps, multiplayer).

## Stack

- **TypeScript + Vite** — the app framework and build tool (`vite` runs the dev server, `tsc` checks the code).
- **PixiJS v8** — 2D rendering engine; fast enough for hundreds of animated soldiers.
- **Custom simulation core** — all battle logic (movement, combat, formations) runs in a
  deterministic fixed-timestep loop, fully separated from rendering. Same inputs → same battle,
  which is the foundation multiplayer needs later.

## Projects Board

| Project | Branch | Phases done | Phases left | State |
|---|---|---|---|---|
| Battle sim core | main | BW0–BW3 | BW4–BW6 | in-progress |

## Phases

- **BW0 — Foundation** ✅: repo scaffold, game loop (fixed-timestep sim + render), one battlefield
  (grass terrain with tree clusters and rocks as obstacles), camera pan/zoom, seeded RNG for
  deterministic maps.
- **BW1 — Soldiers & formations**: soldier entities, squads, formation shapes (line, column,
  wedge, square), formation movement + facing, placeholder soldier visuals.
- **BW2 — Pathfinding & steering**: flow-field pathfinding around obstacles (scales to hundreds
  of units, unlike per-soldier A*), local avoidance so soldiers don't overlap, terrain costs.
- **BW3 — Combat**: melee engagement, ranged fire with projectile arcs, damage/health, deaths,
  basic morale (units break and flee).
- **BW4 — Unit types**: pikemen, archers, crossbowmen, swordsmen, knights, cavalry — distinct
  stats, ranges, speeds, and behaviors (pike walls vs cavalry charges, crossbow reload vs bow rate).
- **BW5 — Command UI**: select squads, issue move/attack/hold orders, formation switching,
  drag-to-set facing and width, order preview ghosts.
- **BW6 — Art & polish**: soldier sprite animations (walk, attack, death), cohesive graphical
  style, battle effects (arrows, blood, dust), sound.
- **Later**: more battlefields, battle setup screen, AI commander, multiplayer (lockstep over the
  deterministic sim).

## Architecture rules

- `src/sim/` — deterministic battle logic. No rendering imports, no `Math.random()` (seeded RNG
  only), no wall-clock time. Fixed timestep (30 ticks/sec).
- `src/render/` — PixiJS drawing + camera. Reads sim state, never mutates it.
- `src/core/` — game loop glue.
