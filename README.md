# Slate Optimizer

A solver for the slate/talent puzzle board. Pick the slates you own, hit **Solve**,
and it searches for the highest-scoring arrangement on the 2/4/6/6/4/2 board (24 cells).

## Scoring

Bonuses dominate raw coverage — a copy/projection is worth 10 points vs. 1 point per covered cell:

| Slate | Behavior |
|---|---|
| Sparks of Moth Fire | Copies the last talent of one adjacent slate (+10 if it has a copyable neighbor). Can never be placed adjacent to Prairie Ablaze |
| Prairie Ablaze | Copies all talents on adjacent slates (+10 per distinct adjacent slate). Can never be placed adjacent to Sparks of Moth Fire |
| Nether King's Divinity: Judgement | L of three 1×1s; +10 (modifier-weighted) per distinct slate on the lines between them (marked ✦, max 4) |
| Nether King's Divinity: Contamination | 3×1; projects its talents into each slate in its effect area (+10 each, modifier-weighted; a modifier extends reach to diagonals) |
| Nether King's Divinity: Banishment | Three 1×1s connected diagonally; **hard constraint** — when placed, the solution must have at least 4 adjacent and at least 4 non-adjacent other slates (+30) |
| Pedigree of the Gods | Cannot be copied *from* — Spark/Prairie ignore it |

Only one Nether King's Divinity variant can be owned at a time.

Judgement and Contamination have configurable **Ultimate Nether King Talent Node** modifiers
(⚙ on their inventory cards) that weight projection/buff values per slate type, so the solver
prefers putting the right slates next to them. "Non-legendary" means Normal Slates only —
Fallen Starlight and Corner of Divinity count as legendary for modifier purposes.

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
