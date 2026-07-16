import { solve } from "./solver.js";

self.onmessage = (e) => {
  const { counts, mods, pedigreeVal, requirePedigree, maxIters } = e.data;
  const result = solve(counts, mods, pedigreeVal, requirePedigree, maxIters, (iters, best) => {
    self.postMessage({
      type: "progress",
      iters,
      best: { score: best.intrinsic + best.bonus, sol: best.sol,
              coverage: best.coverage, bonus: best.bonus, intrinsic: best.intrinsic },
    });
  });
  self.postMessage({ type: "done", result });
};
