# Slate Optimizer

A solver for the slate/talent puzzle board. Pick the slates you own, hit **Solve**,
and it searches for the highest-scoring arrangement on the 2/4/6/6/4/2 board (24 cells).

## Scoring

Score = total **effective mods** on the board. Each slate carries intrinsic mods and
synergies add more; coverage is only a tie-breaker, so slates are always worth placing
but never at the cost of a mod:

| Slate | Value |
|---|---|
| Normal Slate | Adjustable 1–5 (default 5) — most Normals carry 3–4 good mods, so set it on the card |
| Fallen Starlight | 2 mods |
| Corner of Divinity | 2 mods |
| Pedigree of the Gods | Adjustable 0–3 (default 0) — its 1–2 mods are highly impactful but unscalable, so use the **Require** toggle on its card to force it into the layout instead of inflating its score. Cannot be copied *from* |
| Sparks of Moth Fire | Copies the last talent of one adjacent slate: +1, or the Nether King's mod value when it copies a Nether King mod (it picks the most valuable neighbour). Can never be placed adjacent to Prairie Ablaze; copiers can't copy other copiers |
| Prairie Ablaze | Copies the last talent of each adjacent slate (max 4): +1 each, or the Nether King's mod value for a Nether King mod. Each touching cell of a full-size Nether King is its own node, so touching two of its cells copies two mods. Can never be placed adjacent to Sparks |
| Nether King's Divinity (any) | Every square holds its own mod, worth 0–5 (default 2) both on the board and when Sparks or Prairie copy it. A 1×1 has one mod (the **Mod value** stepper). A full-size piece has three: **Edit** on its card opens a picture of the piece where you set each square's value, and the result board shows those values on the placed piece |
| Nether King's Divinity: Judgement | Baseline +40% effect for every distinct slate on its lines (✦): buffed slate's weight × 0.40, with the +10% (Corner/Starlight) and +10% (non-legendary) nodes stacking on top. E.g. Normal on a line = +2, or +2.5 with the node |
| Nether King's Divinity: Contamination | Projects **all its talents at 12% strength** into each slate in its effect area, including the 1×1 legendaries (Spark, Prairie). Each projection is 12% of its three mods' total (default 6, so 5 targets = +3.6). Its nodes multiply each projection (+100% Pedigree, etc.); the Statue node's +30% only counts if the final board has an empty slot; one node extends reach to diagonals |
| Nether King's Divinity: Banishment | Locked in-game to one of the board's four outer diagonal edges (the solver uses the top-right edge; rotate the result for the others). +1 mod per **non-adjacent** slate; **hard constraint** — when placed, the solution must have at least 3 adjacent and at least 3 non-adjacent other slates |

Each Nether King card has a **Full size / 1×1** switch. A 1×1 counts only for its own
mods (no Authority Effect, so its ⚙ talent nodes are hidden) and can only go in its
fixed slots: Banishment on the 4 outer tips, Judgement on the ends of the two 4-wide
rows, Contamination on any non-edge cell.

Nether King slots are fixed in-game, so the solved layout can be rotated 90° left/right
with the buttons under the board.

Only one Nether King's Divinity variant can be owned at a time. Like Pedigree, each
variant has a **Require** toggle that forces it into the layout even when the score alone
would leave it out. A required Banishment is placed even when its buff can't be reached
(the app says so and explains why); an optional one is dropped in that case.

Judgement and Contamination have configurable **Ultimate Nether King Talent Node** modifiers
(⚙ on their inventory cards) that weight projection/buff values per slate type, so the solver
prefers putting the right slates next to them. "Non-legendary" means Normal Slates only —
Fallen Starlight and Corner of Divinity count as legendary for modifier purposes.

The solver runs in a Web Worker with a configurable search budget (4M states up to
unlimited). It streams live progress, can be cancelled mid-search (keeping the best
layout found so far), and reports whether the result is exhaustive/optimal or
budget-capped.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # static build in dist/
```

## Deploying to GitHub Pages

1. Create a GitHub repo and push this project to the `main` branch.
2. In the repo: **Settings → Pages → Source → GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and deploys on every push to `main`.

The build uses relative paths (`base: './'` in `vite.config.js`), so it works at any
repo URL — you can also just upload the `dist/` folder to any static host.
