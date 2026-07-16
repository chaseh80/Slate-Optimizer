import { useState, useMemo, useCallback } from "react";

/* ───── Grid definition: 2/4/6/6/4/2 cross, 24 cells ───── */
const ROWS = 6, COLS = 6;
const ROW_COLS = [[2,3],[1,2,3,4],[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4],[2,3]];
const VALID = [];
const VALID_SET = new Set();
ROW_COLS.forEach((cs,r)=>cs.forEach(c=>{VALID.push([r,c]);VALID_SET.add(`${r},${c}`);}));
const TOTAL = VALID.length; // 24

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

const PIECE_SIZE = {pedigree:7,normal:4,corner:3,starlight:2,spark:1,prairie:1,judgement:3,contamination:3,banishment:3};
const PIECE_MAX  = {pedigree:1,normal:6,corner:3,starlight:3,spark:3,prairie:1,judgement:1,contamination:1,banishment:1};
const NETHER = ["judgement","contamination","banishment"]; // max 1 combined
const COLORS = {
  pedigree:"#c084fc", normal:"#60a5fa", corner:"#f1c40f", starlight:"#1abc9c",
  spark:"#e74c3c", prairie:"#ff6b35",
  judgement:"#d946ef", contamination:"#ec4899", banishment:"#818cf8",
};
const PIECE_LABELS = {
  pedigree:"Pedigree of the Gods", normal:"Normal Slate", corner:"Corner of Divinity",
  starlight:"Fallen Starlight", spark:"Sparks of Moth Fire", prairie:"Prairie Ablaze",
  judgement:"Nether King's Divinity: Judgement",
  contamination:"Nether King's Divinity: Contamination",
  banishment:"Nether King's Divinity: Banishment",
};
const PIECE_DESC = {
  pedigree:"Cannot be copied from",
  spark:"Copies the last talent of one adjacent slate",
  prairie:"Copies all talents on adjacent slates",
  judgement:"Buffs slates on the lines between its cells",
  contamination:"Projects its talents into each adjacent slate",
  banishment:"Buff at 4+ adjacent and 4+ non-adjacent slates",
};

/* ───── Nether King modifiers (Ultimate Nether King Talent Nodes) ───── */
const NETHER_MODS = {
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
const EMPTY_MODS = Object.fromEntries(
  Object.values(NETHER_MODS).flatMap(list=>list.map(m=>[m.id,false])));

/* Per-slate-type value of one Contamination projection, given active modifiers.
   Non-legendary = Normal Slate (Starlight/Corner count as legendary). */
function contamValueTable(mods){
  const t = {};
  for(const cat of CAT_ORDER){
    if(!CAN_BE_BUFFED[cat]){ t[cat] = 0; continue; }
    let m = 1;
    if(mods.c_all12)  m += 0.12;
    if(mods.c_statue) m += 0.30;
    if(cat==="pedigree"  && mods.c_pedigree)  m += 1.0;
    if(cat==="starlight" && mods.c_starlight) m += 0.5;
    if(cat==="corner"    && mods.c_corner)    m += 0.3;
    if(cat==="normal"    && mods.c_nonleg)    m += 0.3;
    t[cat] = BONUS*m;
  }
  return t;
}
/* Per-slate-type value of sitting on Judgement's lines. */
function judgeValueTable(mods){
  const t = {};
  for(const cat of CAT_ORDER){
    if(!CAN_BE_BUFFED[cat]){ t[cat] = 0; continue; }
    let m = 1;
    if((cat==="corner"||cat==="starlight") && mods.j_cs) m += 0.25;
    if(cat==="normal" && mods.j_nonleg) m += 0.20;
    t[cat] = BONUS*m;
  }
  return t;
}

/* ───── Scoring ─────
   Bonuses dominate: one copy/projection outweighs several covered cells. */
const BONUS = 10;          // per copy / projection / buffed slate
const BANISH_BONUS = 30;   // banishment buff (only counted when 4+/4+ holds)
// Pedigree and Nether King slates can't be copied from; buffing slates
// (Spark, Prairie) can't be buffed by Nether King slates either.
const CAN_COPY_FROM = {pedigree:false,normal:true,corner:true,starlight:true,spark:true,prairie:true,judgement:false,contamination:false,banishment:false};
const CAN_BE_BUFFED = {pedigree:true,normal:true,corner:true,starlight:true,spark:false,prairie:false,judgement:true,contamination:true,banishment:true};
// Solver try-order: big coverage pieces first, specials after.
const CAT_ORDER = ["pedigree","normal","corner","starlight","judgement","contamination","banishment","spark","prairie"];
// Inventory columns.
const INV_COLUMNS = [
  {title:"SLATES",                 note:null,                                                       cats:["normal","starlight","corner"]},
  {title:"LEGENDARY SLATES",       note:null,                                                       cats:["pedigree","spark","prairie"]},
  {title:"NETHER KING'S DIVINITY", note:"Only one variant can be owned — selecting one clears the others.", cats:NETHER},
];
const INV_ORDER = INV_COLUMNS.flatMap(col=>col.cats);

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
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const DIRS8 = [...DIRS,[1,1],[1,-1],[-1,1],[-1,-1]];

/* ───── Solver ─────
   Branch-and-bound over placements. Score = covered cells + synergy bonuses.
   Banishment, when placed, is a hard constraint: at least 4 adjacent and
   at least 4 non-adjacent other slates — solutions violating it are never recorded.
   Spark and Prairie may never be placed adjacent to each other. */
function solve(counts, mods){
  const occ = new Int8Array(ROWS*COLS).fill(-1); // -1 off-board, 0 empty, 1 filled, 2 skipped
  const pid = new Int16Array(ROWS*COLS).fill(-1);
  for(const [r,c] of VALID) occ[r*COLS+c] = 0;

  const contamVal = contamValueTable(mods);
  const judgeVal = judgeValueTable(mods);
  const CDIRS = mods.c_diag ? DIRS8 : DIRS; // Contamination effect-area reach
  const MAXB = {
    spark:BONUS, prairie:4*BONUS, banishment:BANISH_BONUS,
    contamination:(mods.c_diag?12:8)*Math.max(...Object.values(contamVal)),
    judgement:4*Math.max(...Object.values(judgeVal)),
    pedigree:0, normal:0, corner:0, starlight:0,
  };

  const rem = {...counts};
  let coverage = 0, bonus = 0, emptyCells = TOTAL;
  // Optimistic upper bound on bonus still obtainable (pooled per-piece maxima).
  let potential = CAT_ORDER.reduce((s,c)=>s+(counts[c]||0)*MAXB[c], 0);
  const placed = [], sparkSat = [];
  let banishIdx = -1, banishAdj = 0, banishNon = 0, judgeIdx = -1;
  let contamIdx = -1, contamEff = null; // effect-area cell set of placed Contamination
  let best = {score:0, sol:[], coverage:0, bonus:0};
  let iters = 0, timedOut = false;
  const t0 = performance.now(), LIMIT = 8000, MAX_ITERS = 40_000_000;

  const remArea = ()=>CAT_ORDER.reduce((s,c)=>s+rem[c]*PIECE_SIZE[c], 0);

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
    if(timedOut)return;
    if(++iters%4096===0 && (performance.now()-t0>LIMIT || iters>MAX_ITERS)){ timedOut = true; return; }

    const score = coverage + bonus;
    const banishOk = banishIdx<0 || (banishAdj>=4 && banishNon>=4);
    if(banishOk && score>best.score){
      best = {score, sol:placed.map(p=>({cat:p.cat, cells:p.cells, gaps:p.gaps})), coverage, bonus};
    }
    // Prune: even filling every empty cell and hitting every remaining bonus can't beat best.
    if(score + Math.min(remArea(), emptyCells) + potential <= best.score)return;

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
            for(const j of nbrs) if(CAN_COPY_FROM[placed[j].cat]){ d += BONUS; sparkSat[id] = true; break; }
          }else if(cat==="prairie"){
            for(const j of nbrs) if(CAN_COPY_FROM[placed[j].cat]) d += BONUS;
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
            for(const j of targets) d += contamVal[placed[j].cat];
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
            d += BANISH_BONUS;
          }
          // Synergy granted to already-placed specials
          for(const j of nbrs){
            const jc = placed[j].cat;
            if(jc==="spark" && !sparkSat[j] && CAN_COPY_FROM[cat]){ sparkSat[j] = true; satUndo.push(j); d += BONUS; }
            else if(jc==="prairie" && CAN_COPY_FROM[cat]) d += BONUS;
          }
          if(contamIdx>=0 && contamIdx!==id && contamVal[cat]>0){
            // New piece in Contamination's effect area = one projection target.
            for(const [r,c] of pl.cells) if(contamEff.has(r*COLS+c)){ d += contamVal[cat]; break; }
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
          bonus += d; potential -= d;

          bt();

          /* ── unplace ── */
          bonus -= d; potential += d;
          if(banishDelta==="adj")banishAdj--; else if(banishDelta==="non")banishNon--;
          for(const j of satUndo) sparkSat[j] = false;
          if(cat==="judgement") judgeIdx = -1;
          if(cat==="contamination"){ contamIdx = -1; contamEff = null; }
          if(cat==="banishment"){ banishIdx = -1; banishAdj = 0; banishNon = 0; }
          rem[cat]++; coverage -= pl.cells.length; emptyCells += pl.cells.length;
          placed.pop(); sparkSat.pop();
          for(const [r,c] of pl.cells){ occ[r*COLS+c] = 0; pid[r*COLS+c] = -1; }
          if(timedOut)return;
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
    solution: best.sol, score: best.score, coverage: best.coverage, bonus: best.bonus,
    iterations: iters, time: Math.round(performance.now()-t0), timedOut,
  };
}

/* ───── Post-solve analysis for display ───── */
function analyzeSolution(sol, mods){
  const empty = {items:[], gapAll:new Set(), gapCovered:new Set(), pieceNotes:{}, pieceTags:{}};
  if(!sol || !sol.length)return empty;
  const contamVal = contamValueTable(mods);
  const judgeVal = judgeValueTable(mods);
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
      pieceNotes[i] = ok ? `Copies ${PIECE_LABELS[sol[copyable[0]].cat]}` : "No copyable neighbor";
      items.push({ok, cat:p.cat,
        text: ok
          ? `Sparks of Moth Fire copies ${PIECE_LABELS[sol[copyable[0]].cat]}`
          : "Sparks of Moth Fire has no copyable neighbor"});
    }else if(p.cat==="prairie"){
      const copyable = nbrs.filter(j=>CAN_COPY_FROM[sol[j].cat]);
      pieceNotes[i] = `Copies ${copyable.length} adjacent slate${copyable.length===1?"":"s"}`;
      items.push({ok:copyable.length>0, cat:p.cat,
        text: `Prairie Ablaze copies ${copyable.length} adjacent slate${copyable.length===1?"":"s"}`
          + (copyable.length ? ` (${copyable.map(j=>PIECE_LABELS[sol[j].cat]).join(", ")})` : "")});
    }else if(p.cat==="contamination"){
      const reach = mods.c_diag ? DIRS8 : DIRS;
      const targets = [...neighborIds(p.cells, i, reach)].filter(j=>contamVal[sol[j].cat]>0);
      targets.forEach(j=>addTag(j, "Receives Contamination's talents"));
      const val = targets.reduce((s,j)=>s+contamVal[sol[j].cat], 0);
      pieceNotes[i] = `Projects into ${targets.length} slate${targets.length===1?"":"s"} (+${fmt(val)})`;
      items.push({ok:targets.length>0, cat:p.cat,
        text: `Contamination projects into ${targets.length} slate${targets.length===1?"":"s"}`
          + (targets.length ? ` (+${fmt(val)} bonus)` : "")
          + (mods.c_diag ? " · diagonal reach" : "")});
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
      pieceNotes[i] = `Buffs ${buffedPieces.size} slate${buffedPieces.size===1?"":"s"} on its lines (+${fmt(val)})`;
      items.push({ok:buffedPieces.size>0, cat:p.cat,
        text: `Judgement buffs ${buffedPieces.size} slate${buffedPieces.size===1?"":"s"} on its lines`
          + (buffedPieces.size ? ` (+${fmt(val)} bonus: ${[...buffedPieces].map(j=>PIECE_LABELS[sol[j].cat]).join(", ")})` : "")});
    }else if(p.cat==="banishment"){
      const adj = nbrs.length, non = sol.length - 1 - adj;
      const ok = adj>=4 && non>=4;
      pieceNotes[i] = ok ? `Buff active (${adj} adjacent / ${non} non-adjacent)` : `${adj} adjacent / ${non} non-adjacent`;
      items.push({ok, cat:p.cat,
        text: `Banishment: ${adj} adjacent / ${non} non-adjacent slates${ok?" — buff active":""}`});
    }
  });
  return {items, gapAll, gapCovered, pieceNotes, pieceTags};
}

/* ───── Piece count color shading (vary per instance) ───── */
const SHADE_SHIFTS = [-42,-14,14,42];
function shadeColor(hex,i){
  const shift = SHADE_SHIFTS[i%SHADE_SHIFTS.length];
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const clamp = v=>Math.max(0,Math.min(255,v+shift));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

/* ═════════════════════════════════════════════════════ */
/*                    COMPONENT                          */
/* ═════════════════════════════════════════════════════ */
const CELL = 52, GAP = 2;
const EMPTY_COUNTS = Object.fromEntries(INV_ORDER.map(c=>[c,0]));

export default function SlateOptimizer(){
  const [counts, setCounts] = useState({...EMPTY_COUNTS});
  const [mods, setMods] = useState({...EMPTY_MODS});
  const [modOpen, setModOpen] = useState(null); // which nether cat's modifier panel is open
  const [solving, setSolving] = useState(false);
  const [result, setResult] = useState(null);
  const [hover, setHover] = useState(null); // {r,c} of hovered grid cell

  const toggleMod = useCallback((id)=>{
    setMods(p=>({...p, [id]:!p[id]}));
    setResult(null);
  },[]);

  const totalArea = useMemo(()=>INV_ORDER.reduce((s,c)=>s+counts[c]*PIECE_SIZE[c],0), [counts]);

  const setCount = useCallback((cat,v)=>{
    const val = Math.max(0, Math.min(PIECE_MAX[cat], v));
    setCounts(p=>{
      const n = {...p, [cat]:val};
      // Only one Nether King's Divinity variant may be owned.
      if(NETHER.includes(cat) && val>0) NETHER.filter(x=>x!==cat).forEach(x=>{ n[x]=0; });
      return n;
    });
    setResult(null);
  },[]);

  const handleSolve = useCallback(async()=>{
    if(totalArea===0)return;
    setSolving(true); setResult(null);
    await new Promise(r=>setTimeout(r,60));
    const res = solve(counts, mods);
    setResult(res); setSolving(false);
  },[counts,mods,totalArea]);

  const analysis = useMemo(()=>analyzeSolution(result?.solution, mods), [result,mods]);

  // Build display grid from solution
  const display = useMemo(()=>{
    if(!result?.solution)return {cellColor:{}, cellPieceId:{}, borders:{}};
    const cellColor = {}, cellPieceId = {};
    result.solution.forEach((p,i)=>{
      const col = shadeColor(COLORS[p.cat], i);
      p.cells.forEach(([r,c])=>{ cellColor[`${r},${c}`] = col; cellPieceId[`${r},${c}`] = i; });
    });
    const borders = {};
    for(const [r,c] of VALID){
      const k = `${r},${c}`;
      const pidHere = cellPieceId[k];
      if(pidHere===undefined)continue;
      const b = [];
      if(cellPieceId[`${r-1},${c}`]!==pidHere)b.push("top");
      if(cellPieceId[`${r+1},${c}`]!==pidHere)b.push("bottom");
      if(cellPieceId[`${r},${c-1}`]!==pidHere)b.push("left");
      if(cellPieceId[`${r},${c+1}`]!==pidHere)b.push("right");
      borders[k] = b;
    }
    return {cellColor, cellPieceId, borders};
  },[result]);

  const netherOthers = INV_ORDER.filter(c=>c!=="banishment").reduce((s,c)=>s+counts[c],0);
  const banishWarn = counts.banishment>0 && netherOthers<8;

  // Tooltip content for the hovered cell
  const hoverInfo = useMemo(()=>{
    if(!hover || !result?.solution)return null;
    const k = `${hover.r},${hover.c}`;
    const pidH = display.cellPieceId[k];
    if(pidH!==undefined){
      const p = result.solution[pidH];
      return {pid:pidH, title:PIECE_LABELS[p.cat], color:COLORS[p.cat],
        lines:[analysis.pieceNotes[pidH], ...(analysis.pieceTags[pidH]||[])].filter(Boolean)};
    }
    if(analysis.gapAll.has(k))
      return {pid:null, title:"Judgement buff line", color:COLORS.judgement,
        lines:["A slate placed here gets buffed"]};
    return null;
  },[hover,result,display,analysis]);

  return(
    <div style={{
      minHeight:"100vh", background:"#0f1419", color:"#c8cdd3",
      fontFamily:"'JetBrains Mono','Fira Code',monospace",
      display:"flex", flexDirection:"column", alignItems:"center",
      padding:20, gap:16, userSelect:"none",
    }}>
      <h1 style={{fontSize:22, fontWeight:700, color:"#e2e8f0", margin:0, letterSpacing:"0.05em"}}>
        SLATE OPTIMIZER
      </h1>
      <div style={{fontSize:12, color:"#94a3b8", textAlign:"center"}}>
        Enter how many of each slate you own, then press <b style={{color:"#e2e8f0"}}>Solve</b> — the optimizer finds the best layout for you.
      </div>

      {/* ── Piece inventory: three columns ── */}
      <div style={{display:"flex", flexWrap:"wrap", gap:10, justifyContent:"center", alignItems:"stretch"}}>
        {INV_COLUMNS.map(col=>(
          <div key={col.title} style={{
            display:"flex", flexDirection:"column", gap:8, alignItems:"center",
            padding:"10px 12px 12px", boxSizing:"border-box",
            background:col.cats===NETHER?"#12101d":"#101720",
            border:`1px solid ${col.cats===NETHER?"#4c3a6e":"#243447"}`, borderRadius:10,
          }}>
            <div style={{fontSize:12, fontWeight:700, letterSpacing:"0.08em",
              color:col.cats===NETHER?"#b8a5e0":"#7d93ab"}}>
              {col.title}
            </div>
            {col.note && <div style={{fontSize:10, color:"#6b5f8a", maxWidth:300, textAlign:"center"}}>{col.note}</div>}
            {col.cats.map(cat=>renderCard(cat, counts, setCount, mods, setModOpen))}
          </div>
        ))}
      </div>

      {/* ── Stats + Solve ── */}
      <div style={{display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", justifyContent:"center"}}>
        <div style={{fontSize:13, color:totalArea>TOTAL?"#f59e0b":"#64748b"}}>
          {totalArea} / {TOTAL} cells
          {totalArea>TOTAL && " (over capacity — solver picks the best subset)"}
        </div>
        <button onClick={handleSolve} disabled={solving||totalArea===0} style={{
          padding:"10px 28px", fontSize:14, fontWeight:700, fontFamily:"inherit",
          background:solving?"#1e293b":totalArea===0?"#0f1419":"#2563eb",
          color:solving||totalArea===0?"#475569":"#fff",
          border:"1px solid "+(solving||totalArea===0?"#1e293b":"#3b82f6"),
          borderRadius:8, cursor:solving||totalArea===0?"not-allowed":"pointer",
          transition:"all 0.2s",
        }}>
          {solving?"Solving...":"Solve"}
        </button>
        <button onClick={()=>{setCounts({...EMPTY_COUNTS});setResult(null);}} style={{
          padding:"10px 16px", fontSize:12, fontFamily:"inherit",
          background:"#1e293b", color:"#94a3b8", border:"1px solid #334155",
          borderRadius:8, cursor:"pointer",
        }}>Reset</button>
      </div>

      {banishWarn && (
        <div style={{fontSize:11, color:"#f59e0b", maxWidth:520, textAlign:"center"}}>
          ⚠ Banishment's buff needs at least 8 other slates (4+ adjacent, 4+ non-adjacent).
          You have {netherOthers} — it won't be placed unless the buff can be satisfied.
        </div>
      )}

      {/* ── Result stats ── */}
      {result && (
        <div style={{fontSize:12, color:"#64748b", display:"flex", gap:16, flexWrap:"wrap", justifyContent:"center"}}>
          <span>Score: <b style={{color:"#e2e8f0"}}>{Math.round(result.score*10)/10}</b></span>
          <span>Coverage: <b style={{color:result.coverage===TOTAL?"#22c55e":"#f59e0b"}}>{result.coverage}/{TOTAL}</b></span>
          <span>Bonus: <b style={{color:"#c084fc"}}>{Math.round(result.bonus*10)/10}</b></span>
          <span>Pieces placed: {result.solution.length}</span>
          <span>Searched {result.iterations.toLocaleString()} states in {result.time}ms{result.timedOut?" (time limit — best found)":""}</span>
        </div>
      )}

      {/* ── Synergy breakdown ── */}
      {result && analysis.items.length>0 && (
        <div style={{display:"flex", flexDirection:"column", gap:4, maxWidth:560}}>
          {analysis.items.map((it,i)=>(
            <div key={i} style={{fontSize:11, color:it.ok?"#94a3b8":"#f59e0b", display:"flex", alignItems:"center", gap:6}}>
              <span style={{color:it.ok?"#22c55e":"#f59e0b"}}>{it.ok?"✓":"✗"}</span>
              <div style={{width:9, height:9, borderRadius:2, background:COLORS[it.cat], flexShrink:0}}/>
              {it.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Grid ── */}
      <div style={{position:"relative"}} onMouseLeave={()=>setHover(null)}>
        <div style={{
          display:"grid",
          gridTemplateColumns:`repeat(${COLS},${CELL}px)`,
          gridTemplateRows:`repeat(${ROWS},${CELL}px)`,
          gap:GAP,
        }}>
          {Array.from({length:ROWS},(_,r)=>
            Array.from({length:COLS},(_,c)=>{
              const k = `${r},${c}`;
              const valid = VALID_SET.has(k);
              if(!valid)return <div key={k} style={{width:CELL, height:CELL}}/>;

              const col = display.cellColor[k];
              const brd = display.borders[k]||[];
              const borderW = side=>brd.includes(side)?3:0;
              const isGap = analysis.gapAll.has(k);
              const isBuffed = analysis.gapCovered.has(k);
              const isHoveredPiece = hoverInfo?.pid!=null && display.cellPieceId[k]===hoverInfo.pid;

              return(
                <div key={k}
                  onMouseEnter={()=>setHover({r,c})}
                  style={{
                    width:CELL, height:CELL, position:"relative",
                    background:col||"#1a2332",
                    borderRadius:4, boxSizing:"border-box",
                    borderTop:`${borderW("top")}px solid #0f1419`,
                    borderBottom:`${borderW("bottom")}px solid #0f1419`,
                    borderLeft:`${borderW("left")}px solid #0f1419`,
                    borderRight:`${borderW("right")}px solid #0f1419`,
                    outline:col?"none":(isGap?`2px dashed ${COLORS.judgement}aa`:"1px solid #2a3a4a"),
                    outlineOffset:isGap&&!col?-3:0,
                    boxShadow:isBuffed?`inset 0 0 0 3px ${COLORS.judgement}cc`:"none",
                    filter:isHoveredPiece?"brightness(1.3)":"none",
                    transition:"background 0.3s, filter 0.1s",
                  }}>
                  {isGap && (
                    <span style={{
                      position:"absolute", top:2, right:4, fontSize:11,
                      color:isBuffed?"#fff":COLORS.judgement, textShadow:"0 0 3px rgba(0,0,0,0.8)",
                      pointerEvents:"none",
                    }}>✦</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Hover tooltip ── */}
        {hoverInfo && hover && (
          <div style={{
            position:"absolute", zIndex:10, pointerEvents:"none",
            left:hover.c*(CELL+GAP)+CELL/2,
            ...(hover.r<=1
              ? {top:(hover.r+1)*(CELL+GAP)+6, transform:"translateX(-50%)"}
              : {top:hover.r*(CELL+GAP)-8, transform:"translate(-50%,-100%)"}),
            background:"#0b1220", border:`1px solid ${hoverInfo.color}`,
            borderRadius:6, padding:"6px 10px", whiteSpace:"nowrap",
            boxShadow:"0 4px 12px rgba(0,0,0,0.6)",
          }}>
            <div style={{display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:"#e2e8f0"}}>
              <div style={{width:9, height:9, borderRadius:2, background:hoverInfo.color, flexShrink:0}}/>
              {hoverInfo.title}
            </div>
            {hoverInfo.lines.map((l,i)=>(
              <div key={i} style={{fontSize:10, color:"#94a3b8", marginTop:2}}>{l}</div>
            ))}
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      {result?.solution && result.solution.length>0 && (
        <div style={{display:"flex", gap:12, flexWrap:"wrap", justifyContent:"center", maxWidth:640}}>
          {[...new Set(result.solution.map(p=>p.cat))].map(cat=>(
            <div key={cat} style={{display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#94a3b8"}}>
              <div style={{width:10, height:10, borderRadius:2, background:COLORS[cat]}}/>
              {PIECE_LABELS[cat]} ×{result.solution.filter(p=>p.cat===cat).length}
            </div>
          ))}
          {analysis.gapAll.size>0 && (
            <div style={{display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#94a3b8"}}>
              <span style={{color:COLORS.judgement}}>✦</span> Judgement buff line
            </div>
          )}
        </div>
      )}

      {/* ── Nether King modifier panel ── */}
      {modOpen && NETHER_MODS[modOpen] && (
        <div onClick={()=>setModOpen(null)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:100,
          display:"flex", alignItems:"center", justifyContent:"center", padding:20,
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:"#141c27", border:"1px solid #4c3a6e", borderRadius:12,
            padding:"16px 20px", width:520, maxWidth:"92vw", maxHeight:"80vh",
            overflowY:"auto", boxSizing:"border-box",
          }}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4}}>
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <div style={{width:12, height:12, borderRadius:3, background:COLORS[modOpen]}}/>
                <span style={{fontSize:13, fontWeight:700, color:"#e2e8f0"}}>
                  {PIECE_LABELS[modOpen]} — Modifiers
                </span>
              </div>
              <Btn small onClick={()=>setModOpen(null)}>✕</Btn>
            </div>
            <div style={{fontSize:10, color:"#6b5f8a", marginBottom:8}}>
              Ultimate Nether King Talent Nodes — toggle the ones you have rolled.
            </div>
            {NETHER_MODS[modOpen].map(m=>(
              <label key={m.id} style={{
                display:"flex", alignItems:"flex-start", gap:10, padding:"8px 10px",
                margin:"4px 0", borderRadius:8, cursor:"pointer",
                background:mods[m.id]?"#1e1533":"#0f1622",
                border:`1px solid ${mods[m.id]?"#6d4fa8":"#243447"}`,
              }}>
                <input type="checkbox" checked={!!mods[m.id]} onChange={()=>toggleMod(m.id)}
                  style={{marginTop:2, accentColor:"#7c3aed", cursor:"pointer"}}/>
                <span style={{fontSize:11, color:mods[m.id]?"#c8b8ec":"#94a3b8", lineHeight:1.5}}>
                  {m.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function renderCard(cat, counts, setCount, mods, openMods){
  // Inside the Nether section the header already says "Nether King's Divinity".
  const label = NETHER.includes(cat) ? PIECE_LABELS[cat].split(": ")[1] : PIECE_LABELS[cat];
  const modList = NETHER_MODS[cat];
  const activeMods = modList ? modList.filter(m=>mods[m.id]).length : 0;
  return(
    <div key={cat} style={{
      display:"flex", alignItems:"center", gap:8,
      padding:"8px 12px", background:"#141c27",
      border:`1px solid ${COLORS[cat]}44`, borderRadius:8, width:320,
      boxSizing:"border-box",
    }}>
      <div style={{width:12, height:12, borderRadius:3, background:COLORS[cat], flexShrink:0}}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:11, color:"#94a3b8"}}>{label}</div>
        <div style={{fontSize:10, color:"#475569"}}>
          {PIECE_SIZE[cat]} cell{PIECE_SIZE[cat]===1?"":"s"} · max {PIECE_MAX[cat]}
          {PIECE_DESC[cat] ? ` · ${PIECE_DESC[cat]}` : ""}
        </div>
      </div>
      {modList && (
        <button onClick={()=>openMods(cat)} title="Configure modifiers" style={{
          width:28, height:28, padding:0, fontSize:14, fontFamily:"inherit",
          background:activeMods?"#2b2140":"#1e293b",
          color:activeMods?"#c4a7f7":"#94a3b8",
          border:`1px solid ${activeMods?"#6d4fa8":"#334155"}`,
          borderRadius:6, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
          position:"relative", flexShrink:0,
        }}>
          ⚙
          {activeMods>0 && (
            <span style={{
              position:"absolute", top:-6, right:-6, fontSize:9, fontWeight:700,
              background:"#7c3aed", color:"#fff", borderRadius:8,
              minWidth:14, height:14, display:"flex", alignItems:"center", justifyContent:"center",
            }}>{activeMods}</span>
          )}
        </button>
      )}
      <div style={{display:"flex", alignItems:"center", gap:4}}>
        <Btn small onClick={()=>setCount(cat,counts[cat]-1)} disabled={counts[cat]<=0}>−</Btn>
        <span style={{fontSize:16, fontWeight:700, color:"#e2e8f0", minWidth:20, textAlign:"center"}}>
          {counts[cat]}
        </span>
        <Btn small onClick={()=>setCount(cat,counts[cat]+1)} disabled={counts[cat]>=PIECE_MAX[cat]}>+</Btn>
      </div>
    </div>
  );
}

function Btn({children,onClick,disabled,small}){
  return(
    <button onClick={onClick} disabled={disabled} style={{
      width:small?28:undefined, height:small?28:undefined,
      padding:small?0:"6px 12px", fontSize:small?16:12, fontFamily:"inherit",
      background:disabled?"#0f1419":"#1e293b",
      color:disabled?"#334155":"#94a3b8",
      border:`1px solid ${disabled?"#1e293b":"#334155"}`,
      borderRadius:6, cursor:disabled?"not-allowed":"pointer",
      display:"flex", alignItems:"center", justifyContent:"center",
      lineHeight:1, fontWeight:700,
    }}>{children}</button>
  );
}
