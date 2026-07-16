# Slate Optimizer

A solver for the slate/talent puzzle board. Pick the slates you own, hit **Solve**,
and it searches for the highest-scoring arrangement on the 2/4/6/6/4/2 board (24 cells).

## Scoring

Score = total **effective mods** on the board. Each slate carries intrinsic mods and
synergies add more; coverage is only a tie-breaker, so slates are always worth placing
but never at the cost of a mod:

| Slate | Value |
|---|---|
| Normal Slate | 5 mods |
| Fallen Starlight | 2 mods |
| Corner of Divinity | 2 mods |
| Pedigree of the Gods | Adjustable 0–3 (default 0) — its 1–2 mods are highly impactful but unscalable, so use the **Require** toggle on its card to force it into the layout instead of inflating its score. Cannot be copied *from* |
| Sparks of Moth Fire | +1 mod (copies the last talent of one adjacent slate). Can never be placed adjacent to Prairie Ablaze; copiers can't copy other copiers |
| Prairie Ablaze | +1 mod per distinct adjacent copyable slate (copies each one's *last* talent; max 4). Can never be placed adjacent to Sparks |
| Nether King's Divinity: Judgement | Baseline +70% effect for every distinct slate on its lines (✦): buffed slate's weight × 0.70, with the +25% (Corner/Starlight) and +20% (non-legendary) nodes stacking on top. E.g. Normal on a line = +3.5, or +4.5 with the node |
| Nether King's Divinity: Contamination | Projects **all its talents at 20% strength** into each slate in its effect area — set its baseline talent value on the card (default 1, so 5 targets ≈ +1). Its nodes multiply each projection (+100% Pedigree, etc.); the Statue node's +30% only counts if the final board has an empty slot; one node extends reach to diagonals |
| Nether King's Divinity: Banishment | +1 mod per **non-adjacent** slate; **hard constraint** — when placed, the solution must have at least 4 adjacent and at least 4 non-adjacent other slates |

Only one Nether King's Divinity variant can be owned at a time.

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
