import { solve } from "./solver.js";

self.onmessage = (e) => {
  const { counts, mods, maxIters } = e.data;
  const result = solve(counts, mods, maxIters, (iters, best) => {
    self.postMessage({
      type: "progress",
      iters,
      best: { score: best.score, sol: best.sol, coverage: best.coverage, bonus: best.bonus },
    });
  });
  self.postMessage({ type: "done", result });
};
