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
  // Judgement: three 1x1s at corners of an L — X··X across, two gaps down, X.
  // The 4 gap cells between them are the "lines" that buff whatever covers them.
  judgement:     { cells: [[0,0],[0,3],[3,3]], gaps: [[0,1],[0,2],[1,3],[2,3]] },
  contamination: { cells: [[0,0],[0,1],[0,2]] },
  banishment:    { cells: [[0,0],[1,1],[2,2]] }, // three 1x1s stacked diagonally
};
const NORMAL_BASES = [
  [[0,0],[0,1],[1,0],[1,1]],       // O
  [[0,0],[0,1],[0,2],[1,1]],       // T
  [[0,0],[1,0],[2,0],[2,1]],       // L
  [[0,1],[1,1],[2,0],[2,1]],       // J
];

export const PIECE_SIZE = {pedigree:7,normal:4,corner:3,starlight:2,spark:1,prairie:1,judgement:3,contamination:3,banishment:3};
export const PIECE_MAX  = {pedigree:1,normal:6,corner:3,starlight:3,spark:3,prairie:1,judgement:1,contamination:1,banishment:1};
export const NETHER = ["judgement","contamination","banishment"]; // max 1 combined
export const COLORS = {
  pedigree:"#c084fc", normal:"#60a5fa", corner:"#f1c40f", starlight:"#1abc9c",
  spark:"#e74c3c", prairie:"#ff6b35",
  judgement:"#d946ef", contamination:"#ec4899", banishment:"#818cf8",
};
export const PIECE_LABELS = {
  pedigree:"Pedigree of the Gods", normal:"Normal Slate", corner:"Corner of Divinity",
  starlight:"Fallen Starlight", spark:"Sparks of Moth Fire", prairie:"Prairie Ablaze",
  judgement:"Nether King's Divinity: Judgement",
  contamination:"Nether King's Divinity: Contamination",
  banishment:"Nether King's Divinity: Banishment",
};
export const PIECE_DESC = {
  pedigree:"Cannot be copied from",
  spark:"Copies the last talent of one adjacent slate (+1 mod)",
  prairie:"Copies the last talent of each adjacent slate (+1 each, max 4)",
  judgement:"Buffs slates on its lines: +70% effect, talent nodes add more (⚙)",
  contamination:"Projects its talents at 20% strength into each touching slate (⚙)",
  banishment:"Buff at 4+ adj & 4+ non-adj: +1 mod per non-adjacent slate",
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
    {id:"j_cs",     label:"+25% Effect Increase Multiplier for A Corner of Divinity and Fallen Starlight along the connecting line"},
    {id:"j_nonleg", label:"+20% Effect Increase Multiplier for Non-Legendary Divinity Slates along the connecting line"},
  ],
};
export const EMPTY_MODS = Object.fromEntries(
  Object.values(NETHER_MODS).flatMap(list=>list.map(m=>[m.id,false])));

/* ───── Scoring: everything is measured in "effective mods" ─────
   Each slate type carries an intrinsic mod count; synergies add mods on top.
   Coverage is only a tie-breaker (COVER_EPS per covered cell), so a slate is
   always worth placing but never at the cost of a single mod. */
export const SPARK_COPY_VALUE = 1;    // Spark copies the LAST talent = 1 mod
export const PRAIRIE_COPY_VALUE = 1;  // Prairie copies the LAST talent of each adjacent slate (max 4)
export const CONTAM_PCT = 0.20;       // Contamination projects ALL its talents at 20% strength per target
export const DEFAULT_CONTAM_VALUE = 1;// baseline talent value of the Contamination slate itself (adjustable)
export const MAX_CONTAM_VALUE = 5;
export const JUDGE_BASE_PCT = 0.70;   // Judgement baseline: +70% effect for every slate on its lines
export const COVER_EPS = 0.01;        // per-cell tie-breaker
// Intrinsic mod counts (pedigree's is user-adjustable at runtime, 0–3:
// its mods are impactful but unscalable, so "require it" is the usual want).
export const DEFAULT_PEDIGREE_VALUE = 0;
export const MAX_PEDIGREE_VALUE = 3;
export function modValueTable(pedigreeVal){
  return {pedigree:pedigreeVal, normal:5, starlight:2, corner:2,
          spark:0, prairie:0, judgement:0, contamination:0, banishment:0};
}
// Pedigree and Nether King slates can't be copied from, and neither can the
// copiers themselves (Spark/Prairie); buffing slates (Spark, Prairie) can't
// be buffed by Nether King slates either.
export const CAN_COPY_FROM = {pedigree:false,normal:true,corner:true,starlight:true,spark:false,prairie:false,judgement:false,contamination:false,banishment:false};
export const CAN_BE_BUFFED = {pedigree:true,normal:true,corner:true,starlight:true,spark:false,prairie:false,judgement:true,contamination:true,banishment:true};
// Solver try-order: big coverage pieces first, specials after.
export const CAT_ORDER = ["pedigree","normal","corner","starlight","judgement","contamination","banishment","spark","prairie"];

/* Per-slate-type value of one Contamination projection, given active modifiers.
   Non-legendary = Normal Slate (Starlight/Corner count as legendary). */
export function contamValueTable(mods, contamWorth = DEFAULT_CONTAM_VALUE){
  // Each projection = 20% of Contamination's own talent value, scaled by nodes.
  // Statue node is NOT in this table — it's conditional on the final board
  // having an empty slot, so the solver adds it at evaluation time.
  const base = contamWorth*CONTAM_PCT;
  const t = {};
  for(const cat of CAT_ORDER){
    if(!CAN_BE_BUFFED[cat]){ t[cat] = 0; continue; }
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
/* Per-slate-type value of sitting on Judgement's lines: baseline +70% of the
   slate's own weight, plus picked talent nodes (+25% Corner/Starlight, +20%
   non-legendary). e.g. Normal on a line = 5 × 0.70 = +3.5; with node ×0.90 = +4.5. */
export function judgeValueTable(mods, modVal){
  const t = {};
  for(const cat of CAT_ORDER){
    if(!CAN_BE_BUFFED[cat]){ t[cat] = 0; continue; }
    let pct = JUDGE_BASE_PCT;
    if((cat==="corner"||cat==="starlight") && mods.j_cs) pct += 0.25;
    if(cat==="normal" && mods.j_nonleg) pct += 0.20;
    t[cat] = modVal[cat]*pct;
  }
  return t;
}

/* ───── Orientation helpers (cells + gaps rotate/flip together) ───── */
const cmp = (a,b)=>a[0]-b[0]||a[1]-b[1];
function normMeta(s){
  const all = s.cells.concat(s.gaps);
  const mr = Math.min(...all.map(p=>p[0])), mc = Math.min(...all.map(p=>p[1]));
  return {
    cells: s.cells.map(([r,c])=>[r-mr,c-mc]).sort(cmp),
    gaps:  s.gaps.map(([r,c])=>[r-mr,c-mc]).sort(cmp),
  };
}
function rotMeta(s){
  return normMeta({cells:s.cells.map(([r,c])=>[c,-r]), gaps:s.gaps.map(([r,c])=>[c,-r])});
}
function flipMeta(s){
  const all = s.cells.concat(s.gaps);
  const mx = Math.max(...all.map(p=>p[1]));
  return normMeta({cells:s.cells.map(([r,c])=>[r,mx-c]), gaps:s.gaps.map(([r,c])=>[r,mx-c])});
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
    for(const ori of oris){
      for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
        const cells = ori.cells.map(([dr,dc])=>[r+dr,c+dc]);
        if(!cells.every(([ar,ac])=>VALID_SET.has(`${ar},${ac}`)))continue;
        // Gap cells that fall off the board simply don't count as buffable.
        const gaps = ori.gaps.map(([dr,dc])=>[r+dr,c+dc]).filter(([ar,ac])=>VALID_SET.has(`${ar},${ac}`));
        plc[cat].push({cells, gaps, gapSet:new Set(gaps.map(([gr,gc])=>gr*COLS+gc))});
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
   Banishment, when placed, is a hard constraint: at least 4 adjacent and
   at least 4 non-adjacent other slates — solutions violating it are never recorded.
   Spark and Prairie may never be placed adjacent to each other. */
export function solve(counts, mods, opts = {}){
  const {
    pedigreeVal = DEFAULT_PEDIGREE_VALUE,
    contamWorth = DEFAULT_CONTAM_VALUE,
    requirePedigree = false,
    maxIters = 25_000_000,
    onProgress = null,
  } = opts;
  const occ = new Int8Array(ROWS*COLS).fill(-1); // -1 off-board, 0 empty, 1 filled, 2 skipped
  const pid = new Int16Array(ROWS*COLS).fill(-1);
  for(const [r,c] of VALID) occ[r*COLS+c] = 0;

  const modVal = modValueTable(pedigreeVal);
  const contamVal = contamValueTable(mods, contamWorth);
  const judgeVal = judgeValueTable(mods, modVal);
  const statueAdd = contamWorth*CONTAM_PCT*0.30; // per target, only when board has an empty slot
  const CDIRS = mods.c_diag ? DIRS8 : DIRS; // Contamination effect-area reach
  const contamMaxTargets = mods.c_diag ? 12 : 8;
  const otherPieceCount = CAT_ORDER.reduce((s,c)=>s+(c==="banishment"?0:(counts[c]||0)), 0);
  const MAXB = {
    spark:SPARK_COPY_VALUE,
    prairie:4*PRAIRIE_COPY_VALUE,
    // Banishment is worth 1 per non-adjacent slate — at most every other piece.
    banishment:otherPieceCount,
    contamination:contamMaxTargets*(Math.max(...Object.values(contamVal)) + (mods.c_statue?statueAdd:0)),
    judgement:4*Math.max(...Object.values(judgeVal)),
    pedigree:0, normal:0, corner:0, starlight:0,
  };

  const pedigreeNeed = requirePedigree && (counts.pedigree||0)>0;
  let pedigreePlaced = 0;

  const rem = {...counts};
  let coverage = 0, bonus = 0, intrinsic = 0, emptyCells = TOTAL;
  // Optimistic upper bound on synergy bonus still obtainable (pooled per-piece maxima).
  let potential = CAT_ORDER.reduce((s,c)=>s+(counts[c]||0)*MAXB[c], 0);
  const placed = [], sparkSat = [];
  let banishIdx = -1, banishAdj = 0, banishNon = 0, judgeIdx = -1;
  let contamIdx = -1, contamEff = null; // effect-area cell set of placed Contamination
  let contamTargets = 0; // distinct projection targets of placed Contamination
  let best = {score:0, sol:[], coverage:0, bonus:0, intrinsic:0};
  let iters = 0, capped = false;
  const t0 = performance.now();

  // Optimistic value of every still-unplaced piece: its intrinsic mods
  // plus the coverage tie-breaker for its cells.
  const remValue = ()=>CAT_ORDER.reduce((s,c)=>s+rem[c]*(modVal[c]+COVER_EPS*PIECE_SIZE[c]), 0);

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
      if(onProgress && iters%2_097_152===0) onProgress(iters, best);
    }

    // Evaluation-time extras that depend on the whole-board state:
    // Banishment = 1 mod per non-adjacent slate (only when its 4+/4+ buff holds);
    // Statue node = +0.39 per Contamination target, only if the board has an empty slot.
    let extra = 0;
    if(banishIdx>=0) extra += banishNon;
    if(contamIdx>=0 && mods.c_statue && coverage<TOTAL) extra += statueAdd*contamTargets;
    const score = intrinsic + bonus + extra + COVER_EPS*coverage;
    const banishOk = banishIdx<0 || (banishAdj>=4 && banishNon>=4);
    const pedigreeOk = !pedigreeNeed || pedigreePlaced>0;
    if(banishOk && pedigreeOk && score>best.score){
      best = {score, sol:placed.map(p=>({cat:p.cat, cells:p.cells, gaps:p.gaps})), coverage, bonus:bonus+extra, intrinsic};
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
          for(const [r,c] of pl.cells){ occ[r*COLS+c] = 1; pid[r*COLS+c] = id; }
          placed.push({cat, cells:pl.cells, gaps:pl.gaps, gapSet:pl.gapSet});
          sparkSat.push(false);
          coverage += pl.cells.length; emptyCells -= pl.cells.length; rem[cat]--;

          let d = 0;
          const satUndo = [];
          // Own synergy at placement time
          if(cat==="spark"){
            for(const j of nbrs) if(CAN_COPY_FROM[placed[j].cat]){ d += SPARK_COPY_VALUE; sparkSat[id] = true; break; }
          }else if(cat==="prairie"){
            // Prairie copies the LAST talent of each adjacent copyable slate (1 mod each).
            for(const j of nbrs) if(CAN_COPY_FROM[placed[j].cat]) d += PRAIRIE_COPY_VALUE;
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
            if(jc==="spark" && !sparkSat[j] && CAN_COPY_FROM[cat]){ sparkSat[j] = true; satUndo.push(j); d += SPARK_COPY_VALUE; }
            else if(jc==="prairie" && CAN_COPY_FROM[cat]) d += PRAIRIE_COPY_VALUE;
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

          bt();

          /* ── unplace ── */
          bonus -= d; potential += d; intrinsic -= modVal[cat];
          if(cat==="pedigree") pedigreePlaced--;
          if(banishDelta==="adj")banishAdj--; else if(banishDelta==="non")banishNon--;
          if(contamHit) contamTargets--;
          for(const j of satUndo) sparkSat[j] = false;
          if(cat==="judgement") judgeIdx = -1;
          if(cat==="contamination"){ contamIdx = -1; contamEff = null; contamTargets = 0; }
          if(cat==="banishment"){ banishIdx = -1; banishAdj = 0; banishNon = 0; }
          rem[cat]++; coverage -= pl.cells.length; emptyCells += pl.cells.length;
          placed.pop(); sparkSat.pop();
          for(const [r,c] of pl.cells){ occ[r*COLS+c] = 0; pid[r*COLS+c] = -1; }
          if(capped)return;
        }
      }
    }

    // Branch: leave this cell empty
    occ[tr*COLS+tc] = 2; emptyCells--;
    bt();
    occ[tr*COLS+tc] = 0; emptyCells++;
  }

  bt();
  return {
    solution: best.sol, score: best.intrinsic + best.bonus, coverage: best.coverage,
    bonus: best.bonus, intrinsic: best.intrinsic,
    iterations: iters, time: Math.round(performance.now()-t0), timedOut: capped,
  };
}

/* ───── Post-solve analysis for display ───── */
export function analyzeSolution(sol, mods, opts = {}){
  const {
    pedigreeVal = DEFAULT_PEDIGREE_VALUE,
    contamWorth = DEFAULT_CONTAM_VALUE,
  } = opts;
  const empty = {items:[], gapAll:new Set(), gapCovered:new Set(), pieceNotes:{}, pieceTags:{}};
  if(!sol || !sol.length)return empty;
  const modVal = modValueTable(pedigreeVal);
  const contamVal = contamValueTable(mods, contamWorth);
  const judgeVal = judgeValueTable(mods, modVal);
  const statueAdd = contamWorth*CONTAM_PCT*0.30;
  const pid = {};
  sol.forEach((p,i)=>p.cells.forEach(([r,c])=>{ pid[`${r},${c}`] = i; }));
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
    if(p.cat==="spark"){
      const copyable = nbrs.filter(j=>CAN_COPY_FROM[sol[j].cat]);
      const ok = copyable.length>0;
      pieceNotes[i] = ok ? `Copies ${PIECE_LABELS[sol[copyable[0]].cat]} (+${SPARK_COPY_VALUE} mod)` : "No copyable neighbor";
      items.push({ok, cat:p.cat,
        text: ok
          ? `Sparks of Moth Fire copies ${PIECE_LABELS[sol[copyable[0]].cat]} (+${SPARK_COPY_VALUE} mod)`
          : "Sparks of Moth Fire has no copyable neighbor"});
    }else if(p.cat==="prairie"){
      const copyable = nbrs.filter(j=>CAN_COPY_FROM[sol[j].cat]);
      const val = copyable.length*PRAIRIE_COPY_VALUE;
      pieceNotes[i] = `Copies the last talent of ${copyable.length} adjacent slate${copyable.length===1?"":"s"} (+${fmt(val)} mods)`;
      items.push({ok:copyable.length>0, cat:p.cat,
        text: `Prairie Ablaze copies the last talent of ${copyable.length} adjacent slate${copyable.length===1?"":"s"}`
          + (copyable.length ? ` (+${fmt(val)} mods: ${copyable.map(j=>PIECE_LABELS[sol[j].cat]).join(", ")})` : "")});
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
      const ok = adj>=4 && non>=4;
      pieceNotes[i] = ok ? `Buff active: +${non} mods (1 per non-adjacent slate; ${adj} adjacent)` : `${adj} adjacent / ${non} non-adjacent — buff inactive`;
      items.push({ok, cat:p.cat,
        text: `Banishment: ${adj} adjacent / ${non} non-adjacent slates${ok?` — buff active (+${non} mods, 1 per non-adjacent)`:""}`});
    }
  });
  return {items, gapAll, gapCovered, pieceNotes, pieceTags};
}
