/* ═════════════════════════════════════════════════════
   Slate Optimizer — solver core (runs in a Web Worker)
   ═════════════════════════════════════════════════════ */

/* ───── Grid definition: 2/4/6/6/4/2 cross, 24 cells ───── */
export const ROWS = 6, COLS = 6;
const ROW_COLS = [[2,3],[1,2,3,4],[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4],[2,3]];
export const VALID = [];
export const VALID_SET = new Set();
ROW_COLS.forEach((cs,r)=>cs.forEach(c=>{VALID.push([r,c]);VALID_SET.add(`${r},${c}`);}));
export const TOTAL = VALID.length; // 24

/* ───── Piece shapes ─────
   cells = occupied squares; gaps = empty "buff line" squares (Judgement only) */
const BASE_SHAPES = {
  pedigree:      { cells: [[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1]] },
  corner:        { cells: [[0,0],[1,0],[1,1]] },
  starlight:     { cells: [[0,0],[1,0]] },
  spark:         { cells: [[0,0]] },
  prairie:       { cells: [[0,0]] },
  // Full-size Nether Kings: the third entry of each cell is its mod index (0–2),
  // since every cell carries its own copyable mod.
  // Judgement: three 1x1s at corners of an L — X··X across, two gaps down, X.
  // The 4 gap cells between them are the "lines" that buff whatever covers them.
  judgement:     { cells: [[0,0,0],[0,3,1],[3,3,2]], gaps: [[0,1],[0,2],[1,3],[2,3]] },
  contamination: { cells: [[0,0,0],[0,1,1],[0,2,2]] },
  banishment:    { cells: [[0,0,0],[1,1,1],[2,2,2]] }, // three 1x1s stacked diagonally; mod 3 is the ◈ anchor
  // 1x1 Nether Kings: used for their implicits only — no Authority Effect.
  judgement1:    { cells: [[0,0]] },
  contamination1:{ cells: [[0,0]] },
  banishment1:   { cells: [[0,0]] },
};
// Full-size Nether King shapes, for drawing the per-mod value editor.
export const NETHER_FULL_SHAPES = Object.fromEntries(
  ["judgement","contamination","banishment"].map(c=>[c, BASE_SHAPES[c]]));
const BANISH_SLOT = [[0,3],[1,4],[2,5]]; // top-right outer edge
// Fixed slots the game allows for each 1x1 Nether King.
const SLOTS_1X1 = {
  banishment1:    [[0,2],[2,5],[3,0],[5,3]],                       // outer tips
  judgement1:     [[1,1],[1,4],[4,1],[4,4]],                       // ends of the 4-wide rows
  contamination1: [[1,2],[1,3],[2,1],[2,2],[2,3],[2,4],
                   [3,1],[3,2],[3,3],[3,4],[4,2],[4,3]],           // every non-edge cell
};
const NORMAL_BASES = [
  [[0,0],[0,1],[1,0],[1,1]],       // O
  [[0,0],[0,1],[0,2],[1,1]],       // T
  [[0,0],[1,0],[2,0],[2,1]],       // L
  [[0,1],[1,1],[2,0],[2,1]],       // J
];

export const NETHER = ["judgement","contamination","banishment"]; // max 1 combined (either size)
export const NETHER_1X1 = {judgement:"judgement1", contamination:"contamination1", banishment:"banishment1"};
const NETHER_ALL = [...NETHER, ...Object.values(NETHER_1X1)];
export const PIECE_SIZE = {pedigree:7,normal:4,corner:3,starlight:2,spark:1,prairie:1,judgement:3,contamination:3,banishment:3,
                           judgement1:1,contamination1:1,banishment1:1};
export const PIECE_MAX  = {pedigree:1,normal:6,corner:3,starlight:3,spark:3,prairie:1,judgement:1,contamination:1,banishment:1,
                           judgement1:1,contamination1:1,banishment1:1};
export const COLORS = {
  pedigree:"#c084fc", normal:"#60a5fa", corner:"#f1c40f", starlight:"#1abc9c",
  spark:"#e74c3c", prairie:"#ff6b35",
  judgement:"#d946ef", contamination:"#ec4899", banishment:"#818cf8",
  judgement1:"#d946ef", contamination1:"#ec4899", banishment1:"#818cf8",
};
export const PIECE_LABELS = {
  pedigree:"Pedigree of the Gods", normal:"Normal Slate", corner:"Corner of Divinity",
  starlight:"Fallen Starlight", spark:"Sparks of Moth Fire", prairie:"Prairie Ablaze",
  judgement:"Nether King's Divinity: Judgement",
  contamination:"Nether King's Divinity: Contamination",
  banishment:"Nether King's Divinity: Banishment",
  judgement1:"Nether King's Divinity: Judgement (1×1)",
  contamination1:"Nether King's Divinity: Contamination (1×1)",
  banishment1:"Nether King's Divinity: Banishment (1×1)",
};
export const PIECE_DESC = {
  pedigree:"Cannot be copied from",
  spark:"Copies the last talent of one adjacent slate (+1, or a Nether King mod's value)",
  prairie:"Copies the last talent of each adjacent slate (+1 each, or a Nether King mod's value; max 4)",
  judgement:"Buffs slates on its lines: +40% effect, talent nodes add more (⚙)",
  contamination:"Projects its talents at 12% strength into each touching slate (⚙)",
  banishment:"Locked to an outer diagonal edge. Buff at 3+ adj & 3+ non-adj: +1 mod per non-adjacent slate",
};
export const PIECE_DESC_1X1 = {
  judgement:"One strong mod · 1×1 at the ends of the 4-wide rows · no Authority Effect",
  contamination:"One strong mod · 1×1 on any non-edge cell · no Authority Effect",
  banishment:"One strong mod · 1×1 on the 4 outer tips · no Authority Effect",
};

/* ───── Nether King modifiers (Ultimate Nether King Talent Nodes) ───── */
export const NETHER_MODS = {
  contamination: [
    {id:"c_all12",    label:"+12% Projection Effect for all Divinity Slates"},
    {id:"c_pedigree", label:"+100% Projection Effect for all Pedigree of Gods"},
    {id:"c_starlight",label:"+50% Projection Effect for all Fallen Starlight"},
    {id:"c_corner",   label:"+30% Projection Effect for all A Corner of Divinity"},
    {id:"c_nonleg",   label:"+30% Projection Effect for all Non-Legendary Divinity Slates"},
    {id:"c_statue",   label:"Statue of The New God has an empty slot: +30% Projection Effect for all Divinity Slates"},
    {id:"c_diag",     label:"Diagonally adjacent spaces are also within its effect area"},
  ],
  judgement: [
    {id:"j_cs",     label:"+10% effect for A Corner of Divinity and Fallen Starlight on the link"},
    {id:"j_nonleg", label:"+10% effect for Non-Legendary Divinity Slates on the link"},
  ],
};
export const EMPTY_MODS = Object.fromEntries(
  Object.values(NETHER_MODS).flatMap(list=>list.map(m=>[m.id,false])));

/* ───── Scoring: everything is measured in "effective mods" ─────
   Each slate type carries an intrinsic mod count; synergies add mods on top.
   Coverage is only a tie-breaker (COVER_EPS per covered cell), so a slate is
   always worth placing but never at the cost of a single mod. */
// Spark copies the last talent of one adjacent slate; Prairie copies the last
// talent of each adjacent slate (max 4). See copyValueTable for what a copy is worth.
export const COPY_VALUE = 1;
export const CONTAM_PCT = 0.12;       // Contamination projects ALL its talents at 12% strength per target (−88% projection)
export const JUDGE_BASE_PCT = 0.40;   // Judgement baseline: +40% effect for every slate on its lines
export const JUDGE_NODE_CS_PCT = 0.10;     // talent node: Corner/Starlight on the link
export const JUDGE_NODE_NONLEG_PCT = 0.10; // talent node: non-legendary (Normal) on the link
export const BANISH_MIN = 3;          // Banishment buff needs at least this many adjacent AND non-adjacent slates
export const COVER_EPS = 0.01;        // per-cell tie-breaker
// Intrinsic mod counts (pedigree's is user-adjustable at runtime, 0–3:
// its mods are impactful but unscalable, so "require it" is the usual want).
export const DEFAULT_PEDIGREE_VALUE = 0;
export const MAX_PEDIGREE_VALUE = 3;
// Normal slates can roll up to 5 mods but often carry fewer good ones — adjustable 1–5.
export const DEFAULT_NORMAL_VALUE = 5;
export const MIN_NORMAL_VALUE = 1, MAX_NORMAL_VALUE = 5;
// What one Nether King mod is worth (on the board and when copied). A 1×1 has
// one mod (netherVal); a full-size piece has one mod per cell (nodeVals[cat]).
export const DEFAULT_NETHER_VALUE = 2;
export const MAX_NETHER_VALUE = 5;
export const DEFAULT_NODE_VALS = Object.fromEntries(NETHER.map(c=>[c, [2,2,2]]));
const sum = a=>a.reduce((s,v)=>s+v, 0);
export function modValueTable(pedigreeVal = DEFAULT_PEDIGREE_VALUE, normalVal = DEFAULT_NORMAL_VALUE,
                              netherVal = DEFAULT_NETHER_VALUE, nodeVals = DEFAULT_NODE_VALS){
  const t = {pedigree:pedigreeVal, normal:normalVal, starlight:2, corner:2, spark:0, prairie:0};
  for(const c of NETHER) t[c] = sum(nodeVals[c]);
  for(const c of Object.values(NETHER_1X1)) t[c] = netherVal;
  return t;
}
// Pedigree can't be copied from, and neither can the copiers themselves
// (Spark/Prairie). Judgement's lines don't buff the copiers, but
// Contamination CAN project into them.
export const CAN_COPY_FROM = {pedigree:false,normal:true,corner:true,starlight:true,spark:false,prairie:false};
export const CAN_BE_BUFFED = {pedigree:true,normal:true,corner:true,starlight:true,spark:false,prairie:false};
export const CONTAM_TARGET = {pedigree:true,normal:true,corner:true,starlight:true,spark:true,prairie:true};
for(const c of NETHER_ALL){ CAN_COPY_FROM[c] = true; CAN_BE_BUFFED[c] = true; CONTAM_TARGET[c] = true; }
// Each cell of a full-size Nether King is its own node, so a Prairie touching
// two of its cells copies two talents.
const MULTI_NODE = {judgement:true, contamination:true, banishment:true};
// Solver try-order: big coverage pieces first, specials after.
export const CAT_ORDER = ["pedigree","normal","corner","starlight","judgement","contamination","banishment",
                          "judgement1","contamination1","banishment1","spark","prairie"];

/* Worth of one talent copied from each slate type: a 1×1 Nether King's mod is
   worth its mod value; any other slate's last talent is worth COPY_VALUE.
   Full-size Nether Kings are copied per cell — see cellCopyValues. */
export function copyValueTable(netherVal = DEFAULT_NETHER_VALUE){
  const t = {};
  for(const c of CAT_ORDER){
    t[c] = !CAN_COPY_FROM[c] || MULTI_NODE[c] ? 0
         : NETHER_ALL.includes(c) ? netherVal : COPY_VALUE;
  }
  return t;
}

/* Per-slate-type value of one Contamination projection, given active modifiers.
   Non-legendary = Normal Slate (Starlight/Corner count as legendary). */
export function contamValueTable(mods, contamWorth = DEFAULT_NETHER_VALUE){
  // Each projection = 12% of Contamination's own talent value, scaled by nodes.
  // Statue node is NOT in this table — it's conditional on the final board
  // having an empty slot, so the solver adds it at evaluation time.
  const base = contamWorth*CONTAM_PCT;
  const t = {};
  for(const cat of CAT_ORDER){
    if(!CONTAM_TARGET[cat]){ t[cat] = 0; continue; }
    let m = 1;
    if(mods.c_all12)  m += 0.12;
    if(cat==="pedigree"  && mods.c_pedigree)  m += 1.0;
    if(cat==="starlight" && mods.c_starlight) m += 0.5;
    if(cat==="corner"    && mods.c_corner)    m += 0.3;
    if(cat==="normal"    && mods.c_nonleg)    m += 0.3;
    t[cat] = base*m;
  }
  return t;
}
/* Per-slate-type value of sitting on Judgement's lines: baseline +40% of the
   slate's own weight, plus picked talent nodes (+10% Corner/Starlight, +10%
   non-legendary). e.g. Normal on a line = 5 × 0.40 = +2; with node ×0.50 = +2.5. */
export function judgeValueTable(mods, modVal){
  const t = {};
  for(const cat of CAT_ORDER){
    if(!CAN_BE_BUFFED[cat]){ t[cat] = 0; continue; }
    let pct = JUDGE_BASE_PCT;
    if((cat==="corner"||cat==="starlight") && mods.j_cs) pct += JUDGE_NODE_CS_PCT;
    if(cat==="normal" && mods.j_nonleg) pct += JUDGE_NODE_NONLEG_PCT;
    t[cat] = modVal[cat]*pct;
  }
  return t;
}

/* ───── Orientation helpers (cells + gaps rotate/flip together) ─────
   A cell may carry extra entries after [r,c] (a full-size Nether King's mod
   index); they ride along unchanged. */
const cmp = (a,b)=>a[0]-b[0]||a[1]-b[1];
function normMeta(s){
  const all = s.cells.concat(s.gaps);
  const mr = Math.min(...all.map(p=>p[0])), mc = Math.min(...all.map(p=>p[1]));
  return {
    cells: s.cells.map(([r,c,...x])=>[r-mr,c-mc,...x]).sort(cmp),
    gaps:  s.gaps.map(([r,c])=>[r-mr,c-mc]).sort(cmp),
  };
}
function rotMeta(s){
  return normMeta({cells:s.cells.map(([r,c,...x])=>[c,-r,...x]), gaps:s.gaps.map(([r,c])=>[c,-r])});
}
function flipMeta(s){
  const all = s.cells.concat(s.gaps);
  const mx = Math.max(...all.map(p=>p[1]));
  return normMeta({cells:s.cells.map(([r,c,...x])=>[r,mx-c,...x]), gaps:s.gaps.map(([r,c])=>[r,mx-c])});
}
function orientationsMeta(base){
  const start = normMeta({cells:base.cells, gaps:base.gaps||[]});
  const seen = new Set(), res = [];
  let s = start;
  for(let f=0; f<2; f++){
    for(let r=0; r<4; r++){
      const k = JSON.stringify(s);
      if(!seen.has(k)){ seen.add(k); res.push(s); }
      s = rotMeta(s);
    }
    s = flipMeta(start);
  }
  return res;
}

/* ───── Precompute all valid placements ───── */
function computeAllPlacements(){
  const plc = {};
  const add = (cat, oris) => {
    plc[cat] = plc[cat] || [];
    const seenCells = new Set();
    for(const ori of oris){
      for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
        const cells = ori.cells.map(([dr,dc])=>[r+dr,c+dc]);
        if(!cells.every(([ar,ac])=>VALID_SET.has(`${ar},${ac}`)))continue;
        // Gap cells that fall off the board simply don't count as buffable.
        const gaps = ori.gaps.map(([dr,dc])=>[r+dr,c+dc]).filter(([ar,ac])=>VALID_SET.has(`${ar},${ac}`));
        // nodes[k] = which of a full-size Nether King's mods sits on cells[k].
        const nodes = ori.cells[0].length>2 ? ori.cells.map(x=>x[2]) : null;
        // Same cells as an earlier placement with only the mods swapped around:
        // skippable whenever all of the piece's mods are worth the same.
        const key = JSON.stringify(cells)+JSON.stringify(gaps);
        const canonical = !seenCells.has(key); seenCells.add(key);
        plc[cat].push({cells, gaps, gapSet:new Set(gaps.map(([gr,gc])=>gr*COLS+gc)), nodes, canonical});
      }
    }
  };
  for(const [cat, base] of Object.entries(BASE_SHAPES)) add(cat, orientationsMeta(base));
  // Normal = union of O,T,L,J orientations
  const seen = new Set(), oris = [];
  for(const b of NORMAL_BASES)for(const o of orientationsMeta({cells:b})){
    const k = JSON.stringify(o.cells);
    if(!seen.has(k)){ seen.add(k); oris.push(o); }
  }
  add("normal", oris);
  // Banishment is locked in-game to the board's four outer diagonal edges. The
  // board is 4-fold rotationally symmetric, so trying only the top-right edge
  // loses no layouts — the other three edges are rotations of any result.
  // Its orientation on the edge is fixed too: the ◈ anchor (mod 3) sits at the tip.
  const slotKey = JSON.stringify(BANISH_SLOT);
  plc.banishment = plc.banishment.filter(p=>JSON.stringify(p.cells)===slotKey && JSON.stringify(p.nodes)==="[0,1,2]");
  plc.banishment[0].canonical = true;
  for(const [cat, slots] of Object.entries(SLOTS_1X1)){
    const ok = new Set(slots.map(([r,c])=>r*COLS+c));
    plc[cat] = plc[cat].filter(p=>ok.has(p.cells[0][0]*COLS+p.cells[0][1]));
  }
  return plc;
}

/* ───── Cover index: cell -> {cat: [placement indices]} ───── */
function buildCoverIndex(plc){
  const idx = {};
  for(const [cat, list] of Object.entries(plc)){
    list.forEach((pl,i)=>{
      pl.cells.forEach(([r,c])=>{
        const k = `${r},${c}`;
        if(!idx[k]) idx[k] = {};
        if(!idx[k][cat]) idx[k][cat] = [];
        idx[k][cat].push(i);
      });
    });
  }
  return idx;
}

const ALL_PLC = computeAllPlacements();
const COVER_IDX = buildCoverIndex(ALL_PLC);
export const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
export const DIRS8 = [...DIRS,[1,1],[1,-1],[-1,1],[-1,-1]];

/* ───── Solver ─────
   Branch-and-bound over placements. Score = covered cells + synergy bonuses.
   Banishment, when placed, is a hard constraint: at least BANISH_MIN adjacent and
   at least BANISH_MIN non-adjacent other slates — solutions violating it are never recorded.
   Spark and Prairie may never be placed adjacent to each other. */
export function solve(inputCounts, mods, opts = {}){
  const {
    pedigreeVal = DEFAULT_PEDIGREE_VALUE,
    normalVal = DEFAULT_NORMAL_VALUE,
    netherVal = DEFAULT_NETHER_VALUE,
    nodeVals = DEFAULT_NODE_VALS,
    requirePedigree = false,
    requireNether = false,
    maxIters = 25_000_000,
    onProgress = null,
  } = opts;
  const counts = Object.fromEntries(CAT_ORDER.map(c=>[c, inputCounts[c]||0]));
  const occ = new Int8Array(ROWS*COLS).fill(-1); // -1 off-board, 0 empty, 1 filled, 2 skipped
  const pid = new Int16Array(ROWS*COLS).fill(-1);
  const cellCopy = new Float64Array(ROWS*COLS); // value of copying the talent on each occupied cell
  for(const [r,c] of VALID) occ[r*COLS+c] = 0;

  const modVal = modValueTable(pedigreeVal, normalVal, netherVal, nodeVals);
  const contamWorth = modVal.contamination; // projects ALL its mods
  const contamVal = contamValueTable(mods, contamWorth);
  const judgeVal = judgeValueTable(mods, modVal);
  const copyVal = copyValueTable(netherVal);
  // Mods on a full-size piece's cells all equal ⇒ placements that only swap them are redundant.
  const sameNodes = Object.fromEntries(NETHER.map(c=>[c, nodeVals[c].every(v=>v===nodeVals[c][0])]));
  const maxCopy = Math.max(0, ...CAT_ORDER.filter(c=>counts[c]>0)
    .map(c=>MULTI_NODE[c] ? Math.max(...nodeVals[c]) : copyVal[c]));
  const statueAdd = contamWorth*CONTAM_PCT*0.30; // per target, only when board has an empty slot
  const CDIRS = mods.c_diag ? DIRS8 : DIRS; // Contamination effect-area reach
  const contamMaxTargets = mods.c_diag ? 12 : 8;
  const otherPieceCount = CAT_ORDER.reduce((s,c)=>s+(c==="banishment"?0:(counts[c]||0)), 0);
  const MAXB = {
    spark:maxCopy,
    prairie:4*maxCopy,
    // Banishment is worth 1 per non-adjacent slate — at most every other piece.
    banishment:otherPieceCount,
    contamination:contamMaxTargets*(Math.max(...Object.values(contamVal)) + (mods.c_statue?statueAdd:0)),
    judgement:4*Math.max(...Object.values(judgeVal)),
    pedigree:0, normal:0, corner:0, starlight:0,
  };

  const pedigreeNeed = requirePedigree && (counts.pedigree||0)>0;
  let pedigreePlaced = 0;
  const netherNeed = requireNether && NETHER_ALL.some(c=>counts[c]>0);
  let netherPlaced = 0;

  const rem = {...counts};
  let coverage = 0, bonus = 0, intrinsic = 0, emptyCells = TOTAL;
  // Optimistic upper bound on synergy bonus still obtainable (pooled per-piece maxima).
  let potential = CAT_ORDER.reduce((s,c)=>s+(counts[c]||0)*MAXB[c], 0);
  const placed = [], sparkBest = []; // sparkBest[i]: value of the best talent Spark i copies
  let banishIdx = -1, banishAdj = 0, banishNon = 0, judgeIdx = -1;
  let contamIdx = -1, contamEff = null; // effect-area cell set of placed Contamination
  let contamTargets = 0; // distinct projection targets of placed Contamination
  let best = {score:0, sol:[], coverage:0, bonus:0, intrinsic:0};
  // A required Banishment is placed even when its buff can't be met; this holds
  // the best such layout, used only if no buff-active layout exists.
  let fallback = null;
  const pick = ()=>(best.sol.length || !fallback) ? best : fallback;
  let iters = 0, capped = false;
  const t0 = performance.now();

  // Optimistic value of every still-unplaced piece: its intrinsic mods
  // plus the coverage tie-breaker for its cells.
  const remValue = ()=>CAT_ORDER.reduce((s,c)=>s+rem[c]*(modVal[c]+COVER_EPS*PIECE_SIZE[c]), 0);

  function occupy(cat, pl, id){
    pl.cells.forEach(([r,c],k)=>{
      const idx = r*COLS+c;
      occ[idx] = 1; pid[idx] = id;
      cellCopy[idx] = pl.nodes ? nodeVals[cat][pl.nodes[k]] : copyVal[cat];
    });
    placed.push({cat, cells:pl.cells, gaps:pl.gaps, gapSet:pl.gapSet, nodes:pl.nodes});
  }
  function vacate(pl){
    for(const [r,c] of pl.cells){ const idx = r*COLS+c; occ[idx] = 0; pid[idx] = -1; cellCopy[idx] = 0; }
  }
  function neighborCells([r,c]){
    const out = [];
    for(const [dr,dc] of DIRS){
      const rr = r+dr, cc = c+dc;
      if(rr>=0&&rr<ROWS&&cc>=0&&cc<COLS) out.push(rr*COLS+cc);
    }
    return out;
  }
  // Copy values of the cells in `cells` that touch the single cell [r,c].
  function touchingValues(cells, [r,c]){
    const out = [];
    for(const [a,b] of cells) if(Math.abs(a-r)+Math.abs(b-c)===1) out.push(cellCopy[a*COLS+b]);
    return out;
  }

  function neighborIds(cells){
    const s = new Set();
    for(const [r,c] of cells)for(const [dr,dc] of DIRS){
      const rr = r+dr, cc = c+dc;
      if(rr<0||rr>=ROWS||cc<0||cc>=COLS)continue;
      const p = pid[rr*COLS+cc];
      if(p>=0) s.add(p);
    }
    return s;
  }

  function bt(){
    if(capped)return;
    if(++iters%4096===0){
      if(iters>maxIters){ capped = true; return; }
      if(onProgress && iters%2_097_152===0) onProgress(iters, pick());
    }

    // Evaluation-time extras that depend on the whole-board state:
    // Banishment = 1 mod per non-adjacent slate (only when its 3+/3+ buff holds);
    // Statue node = +0.39 per Contamination target, only if the board has an empty slot.
    let extra = 0;
    if(banishIdx>=0) extra += banishNon;
    if(contamIdx>=0 && mods.c_statue && coverage<TOTAL) extra += statueAdd*contamTargets;
    const score = intrinsic + bonus + extra + COVER_EPS*coverage;
    const banishOk = banishIdx<0 || (banishAdj>=BANISH_MIN && banishNon>=BANISH_MIN);
    const pedigreeOk = !pedigreeNeed || pedigreePlaced>0;
    const netherOk = !netherNeed || netherPlaced>0;
    if(banishOk && pedigreeOk && netherOk && score>best.score){
      best = {score, sol:placed.map(p=>({cat:p.cat, cells:p.cells, gaps:p.gaps, nodes:p.nodes})), coverage, bonus:bonus+extra, intrinsic};
    }else if(!banishOk && netherNeed && pedigreeOk && best.sol.length===0){
      const s = score - banishNon; // buff inactive: no per-non-adjacent value
      if(!fallback || s>fallback.score){
        fallback = {score:s, sol:placed.map(p=>({cat:p.cat, cells:p.cells, gaps:p.gaps, nodes:p.nodes})), coverage,
                    bonus:bonus+extra-banishNon, intrinsic, buffInactive:true};
      }
    }
    // Prune: even placing every remaining piece and hitting every remaining bonus can't beat best.
    // (`potential` never shrinks for the evaluation-time extras, so it bounds them too.)
    if(intrinsic + bonus + COVER_EPS*coverage + remValue() + potential <= best.score)return;

    let tr = -1, tc = -1;
    for(const [r,c] of VALID) if(occ[r*COLS+c]===0){ tr=r; tc=c; break; }
    if(tr===-1)return;

    {
      const opts = COVER_IDX[`${tr},${tc}`] || {};
      for(const cat of CAT_ORDER){
        if(!rem[cat] || !opts[cat])continue;
        for(const pi of opts[cat]){
          const pl = ALL_PLC[cat][pi];
          if(!pl.canonical && sameNodes[cat])continue;
          let ok = true;
          for(const [r,c] of pl.cells) if(occ[r*COLS+c]!==0){ ok = false; break; }
          if(!ok)continue;

          const nbrs = neighborIds(pl.cells);
          // Spark and Prairie can never sit next to each other.
          if(cat==="spark"||cat==="prairie"){
            const other = cat==="spark"?"prairie":"spark";
            let bad = false;
            for(const j of nbrs) if(placed[j].cat===other){ bad = true; break; }
            if(bad)continue;
          }

          /* ── place ── */
          const id = placed.length;
          occupy(cat, pl, id);
          sparkBest.push(0);
          coverage += pl.cells.length; emptyCells -= pl.cells.length; rem[cat]--;

          let d = 0;
          const satUndo = [];
          // Own synergy at placement time
          if(cat==="spark"){
            // Spark copies the single most valuable talent it touches.
            let b = 0;
            for(const idx of neighborCells(pl.cells[0])) if(pid[idx]>=0) b = Math.max(b, cellCopy[idx]);
            d += b; sparkBest[id] = b;
          }else if(cat==="prairie"){
            // Prairie copies the LAST talent of each adjacent copyable slate;
            // each touching cell of a full-size Nether King is a separate mod.
            const seen = new Set();
            for(const idx of neighborCells(pl.cells[0])){
              const j = pid[idx];
              if(j<0 || !CAN_COPY_FROM[placed[j].cat])continue;
              if(MULTI_NODE[placed[j].cat] || !seen.has(j)){ seen.add(j); d += cellCopy[idx]; }
            }
          }else if(cat==="contamination"){
            contamIdx = id;
            const eff = new Set();
            for(const [r,c] of pl.cells)for(const [dr,dc] of CDIRS){
              const rr = r+dr, cc = c+dc;
              if(rr>=0&&rr<ROWS&&cc>=0&&cc<COLS) eff.add(rr*COLS+cc);
            }
            contamEff = eff;
            const targets = new Set();
            for(const idx of eff){ const p = pid[idx]; if(p>=0 && p!==id) targets.add(p); }
            for(const j of targets) if(contamVal[placed[j].cat]>0){ d += contamVal[placed[j].cat]; contamTargets++; }
          }else if(cat==="judgement"){
            judgeIdx = id;
            // One buff per distinct buffable slate on the lines, not per covered cell.
            const buffed = new Set();
            for(const [gr,gc] of pl.gaps){
              const p = pid[gr*COLS+gc];
              if(p>=0 && !buffed.has(p) && judgeVal[placed[p].cat]>0){ buffed.add(p); d += judgeVal[placed[p].cat]; }
            }
          }else if(cat==="banishment"){
            banishIdx = id; banishAdj = nbrs.size; banishNon = id - nbrs.size;
            // Value (1 per non-adjacent slate) is computed at evaluation time.
          }
          // Synergy granted to already-placed specials
          for(const j of nbrs){
            const jc = placed[j].cat;
            if(jc!=="spark" && jc!=="prairie")continue;
            const vals = touchingValues(pl.cells, placed[j].cells[0]);
            if(jc==="spark"){
              // A Spark switches to this slate's talent if it's worth more than its current copy.
              const v = Math.max(...vals);
              if(v>sparkBest[j]){ satUndo.push([j, sparkBest[j]]); d += v-sparkBest[j]; sparkBest[j] = v; }
            }else if(CAN_COPY_FROM[cat]){
              // Prairie takes one talent from a slate, or one per touching full-size Nether King cell.
              d += MULTI_NODE[cat] ? sum(vals) : vals[0];
            }
          }
          let contamHit = false;
          if(contamIdx>=0 && contamIdx!==id && contamVal[cat]>0){
            // New piece in Contamination's effect area = one projection target.
            for(const [r,c] of pl.cells) if(contamEff.has(r*COLS+c)){
              d += contamVal[cat]; contamTargets++; contamHit = true; break;
            }
          }
          if(judgeIdx>=0 && judgeIdx!==id && judgeVal[cat]>0){
            // New piece on the lines = one buffed slate, however many cells it covers.
            const gs = placed[judgeIdx].gapSet;
            for(const [r,c] of pl.cells) if(gs.has(r*COLS+c)){ d += judgeVal[cat]; break; }
          }
          let banishDelta = null;
          if(banishIdx>=0 && banishIdx!==id){
            if(nbrs.has(banishIdx)){ banishAdj++; banishDelta = "adj"; }
            else { banishNon++; banishDelta = "non"; }
          }
          bonus += d; potential -= d; intrinsic += modVal[cat];
          if(cat==="pedigree") pedigreePlaced++;
          if(cat!=="banishment" && NETHER_ALL.includes(cat)) netherPlaced++;

          bt();

          /* ── unplace ── */
          bonus -= d; potential += d; intrinsic -= modVal[cat];
          if(cat==="pedigree") pedigreePlaced--;
          if(cat!=="banishment" && NETHER_ALL.includes(cat)) netherPlaced--;
          if(banishDelta==="adj")banishAdj--; else if(banishDelta==="non")banishNon--;
          if(contamHit) contamTargets--;
          for(const [j,prev] of satUndo) sparkBest[j] = prev;
          if(cat==="judgement") judgeIdx = -1;
          if(cat==="contamination"){ contamIdx = -1; contamEff = null; contamTargets = 0; }
          if(cat==="banishment"){ banishIdx = -1; banishAdj = 0; banishNon = 0; }
          rem[cat]++; coverage -= pl.cells.length; emptyCells += pl.cells.length;
          placed.pop(); sparkBest.pop();
          vacate(pl);
          if(capped)return;
        }
      }
    }

    // Branch: leave this cell empty
    occ[tr*COLS+tc] = 2; emptyCells--;
    bt();
    occ[tr*COLS+tc] = 0; emptyCells++;
  }

  if(rem.banishment>0){
    // Banishment has a single fixed slot, so search with it pre-placed first;
    // otherwise the budget is spent on Banishment-less layouts before the scan
    // ever reaches its slot. Then fall back to layouts without it.
    const pl = ALL_PLC.banishment[0];
    occupy("banishment", pl, 0);
    sparkBest.push(0);
    coverage += pl.cells.length; emptyCells -= pl.cells.length; rem.banishment--;
    banishIdx = 0; banishAdj = 0; banishNon = 0; netherPlaced++; intrinsic += modVal.banishment;
    bt();
    banishIdx = -1; netherPlaced--; intrinsic -= modVal.banishment;
    placed.pop(); sparkBest.pop();
    coverage -= pl.cells.length; emptyCells += pl.cells.length;
    vacate(pl);
    potential -= MAXB.banishment;
    if(!netherNeed) bt();
  }else{
    bt();
  }
  const final = pick();
  return {
    solution: final.sol, score: final.intrinsic + final.bonus, coverage: final.coverage,
    bonus: final.bonus, intrinsic: final.intrinsic,
    iterations: iters, time: Math.round(performance.now()-t0), timedOut: capped,
    banishBuffInactive: !!final.buffInactive,
  };
}

/* ───── Post-solve analysis for display ───── */
export function analyzeSolution(sol, mods, opts = {}){
  const {
    pedigreeVal = DEFAULT_PEDIGREE_VALUE,
    normalVal = DEFAULT_NORMAL_VALUE,
    netherVal = DEFAULT_NETHER_VALUE,
    nodeVals = DEFAULT_NODE_VALS,
  } = opts;
  const empty = {items:[], gapAll:new Set(), gapCovered:new Set(), pieceNotes:{}, pieceTags:{}, cellMods:{}};
  if(!sol || !sol.length)return empty;
  const modVal = modValueTable(pedigreeVal, normalVal, netherVal, nodeVals);
  const contamVal = contamValueTable(mods, modVal.contamination);
  const judgeVal = judgeValueTable(mods, modVal);
  const copyVal = copyValueTable(netherVal);
  const statueAdd = modVal.contamination*CONTAM_PCT*0.30;
  const pid = {};
  // Copy value of each occupied cell; cellMods labels each full-size Nether King cell.
  const cv = {}, cellMods = {};
  sol.forEach((p,i)=>p.cells.forEach(([r,c],k)=>{
    const key = `${r},${c}`;
    pid[key] = i;
    if(p.nodes && MULTI_NODE[p.cat]){
      const n = p.nodes[k];
      cv[key] = nodeVals[p.cat][n];
      cellMods[key] = {n:n+1, value:cv[key], anchor:p.cat==="banishment" && n===2};
    }else cv[key] = copyVal[p.cat];
  }));
  const neighborIds = (cells, self, dirs=DIRS)=>{
    const s = new Set();
    for(const [r,c] of cells)for(const [dr,dc] of dirs){
      const p = pid[`${r+dr},${c+dc}`];
      if(p!==undefined && p!==self) s.add(p);
    }
    return s;
  };
  const fmt = v=>Math.round(v*10)/10;
  const items = [];
  const gapAll = new Set(), gapCovered = new Set();
  const pieceNotes = {}, pieceTags = {};
  const addTag = (i,t)=>{ (pieceTags[i] = pieceTags[i]||[]).push(t); };
  sol.forEach((p,i)=>{
    const nbrs = [...neighborIds(p.cells, i)];
    // Names a copied talent: the slate, plus which mod for a full-size Nether King.
    const source = key=>PIECE_LABELS[sol[pid[key]].cat] + (cellMods[key] ? ` mod ${cellMods[key].n}` : "");
    const [pr,pc] = p.cells[0];
    const touching = DIRS.map(([dr,dc])=>`${pr+dr},${pc+dc}`)
      .filter(key=>pid[key]!==undefined && CAN_COPY_FROM[sol[pid[key]].cat]);
    if(p.cat==="spark"){
      // Spark picks the most valuable talent it touches.
      const src = touching.sort((a,b)=>cv[b]-cv[a])[0];
      const ok = src!==undefined;
      const what = ok ? `${source(src)} (+${fmt(cv[src])} mod)` : "";
      pieceNotes[i] = ok ? `Copies ${what}` : "No copyable neighbor";
      items.push({ok, cat:p.cat,
        text: ok ? `Sparks of Moth Fire copies ${what}` : "Sparks of Moth Fire has no copyable neighbor"});
    }else if(p.cat==="prairie"){
      // One talent per adjacent slate, or per touching cell of a full-size Nether King.
      const seen = new Set(), copied = [];
      for(const key of touching){
        const j = pid[key];
        if(MULTI_NODE[sol[j].cat] || !seen.has(j)){ seen.add(j); copied.push(key); }
      }
      const n = copied.length, val = copied.reduce((s,key)=>s+cv[key], 0);
      pieceNotes[i] = `Copies ${n} talent${n===1?"":"s"} from adjacent slates (+${fmt(val)} mods)`;
      items.push({ok:n>0, cat:p.cat,
        text: `Prairie Ablaze copies ${n} talent${n===1?"":"s"} from adjacent slates`
          + (n ? ` (+${fmt(val)} mods: ${copied.map(source).join(", ")})` : "")});
    }else if(p.cat==="contamination"){
      const reach = mods.c_diag ? DIRS8 : DIRS;
      const targets = [...neighborIds(p.cells, i, reach)].filter(j=>contamVal[sol[j].cat]>0);
      targets.forEach(j=>addTag(j, "Receives Contamination's talents"));
      const covered = sol.reduce((s,q)=>s+q.cells.length, 0);
      const statueActive = mods.c_statue && covered<TOTAL;
      const val = targets.reduce((s,j)=>s+contamVal[sol[j].cat], 0)
        + (statueActive ? statueAdd*targets.length : 0);
      pieceNotes[i] = `Projects into ${targets.length} slate${targets.length===1?"":"s"} (+${fmt(val)} mods)`;
      items.push({ok:targets.length>0, cat:p.cat,
        text: `Contamination projects into ${targets.length} slate${targets.length===1?"":"s"}`
          + (targets.length ? ` (+${fmt(val)} mods)` : "")
          + (mods.c_diag ? " · diagonal reach" : "")
          + (mods.c_statue ? (statueActive ? " · Statue bonus active (empty slot)" : " · Statue bonus inactive (board full)") : "")});
    }else if(p.cat==="judgement"){
      const gaps = p.gaps || [];
      const buffedPieces = new Set();
      gaps.forEach(([r,c])=>{
        gapAll.add(`${r},${c}`);
        const j = pid[`${r},${c}`];
        if(j!==undefined && judgeVal[sol[j].cat]>0){ buffedPieces.add(j); gapCovered.add(`${r},${c}`); }
      });
      buffedPieces.forEach(j=>addTag(j, "Buffed by Judgement"));
      const val = [...buffedPieces].reduce((s,j)=>s+judgeVal[sol[j].cat], 0);
      pieceNotes[i] = `Buffs ${buffedPieces.size} slate${buffedPieces.size===1?"":"s"} on its lines (+${fmt(val)} mods)`;
      items.push({ok:buffedPieces.size>0, cat:p.cat,
        text: `Judgement buffs ${buffedPieces.size} slate${buffedPieces.size===1?"":"s"} on its lines`
          + (buffedPieces.size ? ` (+${fmt(val)} mods: ${[...buffedPieces].map(j=>PIECE_LABELS[sol[j].cat]).join(", ")})` : "")});
    }else if(p.cat==="banishment"){
      const adj = nbrs.length, non = sol.length - 1 - adj;
      const ok = adj>=BANISH_MIN && non>=BANISH_MIN;
      pieceNotes[i] = ok ? `Buff active: +${non} mods (1 per non-adjacent slate; ${adj} adjacent)` : `${adj} adjacent / ${non} non-adjacent — buff inactive`;
      items.push({ok, cat:p.cat,
        text: `Banishment: ${adj} adjacent / ${non} non-adjacent slates${ok?` — buff active (+${non} mods, 1 per non-adjacent)`:""}`});
    }
  });
  return {items, gapAll, gapCovered, pieceNotes, pieceTags, cellMods};
}
