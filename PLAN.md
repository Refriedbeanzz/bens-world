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
| Battle sim core | main | BW0–BW7 | BW8 | in-progress |

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
  Plus combat stances (defensive / offensive / balanced) with per-formation defaults (wall/circle
  default defensive, wedge offensive) — stances only mean something once unit types exist.
- **BW5 — Command UI**: select squads, issue move/attack/hold orders, formation switching,
  drag-to-set facing and width, order preview ghosts. Flank and fighting-retreat commands live
  here (they're command macros that deserve buttons, not more hidden hotkeys).
- **BW6 — Enemy AI commander**: combined-arms brain replacing the charge-nearest dummy — archers
  screened behind infantry, cavalry hunting flanks/routed squads, focus fire, withdrawing mauled
  squads, committing reserves, reacting to player moves. Placed right after command UI so there's
  a worthy opponent the moment the controls get good. Gets a terrain-aware v2 pass after BW7.
- **BW7 — Terrain & maps**: elevation/slopes (uphill slows, high ground helps archers; slopes
  feed squad.impactPower so downhill charges hit harder than 1.0 and uphill softer), ridges,
  canyons, big rock fields, steppe/biome variety, multiple battlefields. Deliberately after unit
  types — terrain is only tactically meaningful once archers/cavalry/pikes exist. The cell-based
  world model (blocked/slow/cost flags) was built to absorb this without rework.
- **BW8 — Art & polish** (style locked with Jonathan 2026-08-16):
  - **Period**: 12th–13th century — nasal/great helms, mail + team-color surcoats, kite/heater
    shields, pikes, self bows, early crossbows, caparisoned knight horses. No plate anachronisms.
  - **Style**: hand-drawn Norland-like — soft wobbly outlines, organic shapes, warm muted palette,
    texture grain; built procedurally for consistency and custom-unit support.
  - **Soldier rig**: 3 sprites per soldier — armless body + left hand + right hand; weapons held
    by hands and procedurally animated (melee wind-up/swing/return, bow draw-loose, crossbow
    crank); walk bob on bodies.
  - **Gore**: heavy — blood spurts on hits, spreading pools, persistent static corpse sprites
    (random sprawl) that stay all battle.
  - Plus: battle effects (dust behind charges, impact flashes), terrain texture upgrade, UI reskin.
  - **Checkpoint 2026-08-17**: terrain texture upgrade is functionally done — ground color blend
    is a real per-pixel canvas (no seams), shore-foam and cliff-edge ink lines now trace the
    continuous smooth boundary instead of the 32px cell grid (was the last source of "square"
    edges), rocks are rounded via a new `smoothBlob()` curve-through-jittered-points helper, and a
    ground-litter pass (twigs, tree-base leaf flecks) plus higher brush/grit/tuft/bush density were
    added for "go crazy on details." Prone corpses (added last session) had their head/leg
    orientation mirrored per feedback that it read backwards. Not yet visually confirmed in-browser
    by Jonathan — next session should open the dev server and eyeball a map before moving on.
    Committed + pushed to origin/main at `267a107`.
- **Later**: more battlefields, battle setup screen / army picker, multiplayer (lockstep over the
  deterministic sim).
- **Later — player-created content**: custom units (stat-editor over the unittype data blocks,
  with stat limits and a point-cost budget so armies stay fair) and a custom map editor (paint
  terrain cells + place obstacles/spawn zones over the existing grid world model; build after BW7
  so every terrain type is paintable). Both are data-only thanks to current architecture, and
  determinism means custom content works in multiplayer by just sharing the JSON at match setup.

## Unit roster wishlist (add via unittype.ts — ~20 lines each — when their mechanic lands)

Jonathan wants a deep roster. Core six are in (swordsman, pikeman, archer, crossbowman, knight,
cavalry). Queue, each tied to the feature that gives it a reason to exist:
- **Shieldmen / heavy infantry** — with shield-block vs missiles (wall formation combat bonus)
- **Horse archers** — with kiting behavior (BW6 AI)
- **Halberdiers / axemen** — with armor-shred or anti-armor mechanics
- **Two-handers / berserkers** — high damage, low armor glass cannons
- **Peasant levies** — cheap, fragile, morale-brittle (interesting once army costs exist)
- **Mounted crossbows, javelin skirmishers, longbowmen vs shortbow split** — ranged variety
- **Commanders/banner units** — morale auras (pairs with deeper morale system)

## Architecture rules

- `src/sim/` — deterministic battle logic. No rendering imports, no `Math.random()` (seeded RNG
  only), no wall-clock time. Fixed timestep (30 ticks/sec).
- `src/render/` — PixiJS drawing + camera. Reads sim state, never mutates it.
- `src/core/` — game loop glue.
