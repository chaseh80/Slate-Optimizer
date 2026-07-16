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
  banishment:"Buff at exactly 4 adjacent + 4 non-adjacent slates",
};

/* ───── Scoring ─────
   Bonuses dominate: one copy/projection outweighs several covered cells. */
const BONUS = 10;          // per copy / projection / buffed line cell
const BANISH_BONUS = 30;   // banishment buff (only counted when 4+4 holds)
const MAXB = {spark:BONUS, prairie:4*BONUS, contamination:8*BONUS, judgement:4*BONUS,
              banishment:BANISH_BONUS, pedigree:0, normal:0, corner:0, starlight:0};
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

/* ───── Solver ─────
   Branch-and-bound over placements. Score = covered cells + synergy bonuses.
   Banishment, when placed, is a hard constraint: exactly 4 adjacent and
   4 non-adjacent other slates — solutions violating it are never recorded. */
function solve(counts){
  const occ = new Int8Array(ROWS*COLS).fill(-1); // -1 off-board, 0 empty, 1 filled, 2 skipped
  const pid = new Int16Array(ROWS*COLS).fill(-1);
  for(const [r,c] of VALID) occ[r*COLS+c] = 0;

  const rem = {...counts};
  let coverage = 0, bonus = 0, emptyCells = TOTAL;
  // Optimistic upper bound on bonus still obtainable (pooled per-piece maxima).
  let potential = CAT_ORDER.reduce((s,c)=>s+(counts[c]||0)*MAXB[c], 0);
  const placed = [], sparkSat = [];
  let banishIdx = -1, banishAdj = 0, banishNon = 0, judgeIdx = -1;
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
    const banishOk = banishIdx<0 || (banishAdj===4 && banishNon===4);
    if(banishOk && score>best.score){
      best = {score, sol:placed.map(p=>({cat:p.cat, cells:p.cells, gaps:p.gaps})), coverage, bonus};
    }
    // Prune: even filling every empty cell and hitting every remaining bonus can't beat best.
    if(score + Math.min(remArea(), emptyCells) + potential <= best.score)return;

    let tr = -1, tc = -1;
    for(const [r,c] of VALID) if(occ[r*COLS+c]===0){ tr=r; tc=c; break; }
    if(tr===-1)return;

    // With banishment down and 8 other slates placed, nothing more may be added.
    const banishFull = banishIdx>=0 && placed.length-1>=8;
    if(!banishFull){
      const opts = COVER_IDX[`${tr},${tc}`] || {};
      for(const cat of CAT_ORDER){
        if(!rem[cat] || !opts[cat])continue;
        for(const pi of opts[cat]){
          const pl = ALL_PLC[cat][pi];
          let ok = true;
          for(const [r,c] of pl.cells) if(occ[r*COLS+c]!==0){ ok = false; break; }
          if(!ok)continue;

          const nbrs = neighborIds(pl.cells);
          // Banishment feasibility: counts can only grow, so reject early.
          if(cat==="banishment"){
            const adj = nbrs.size, non = placed.length - adj;
            if(adj>4 || non>4)continue;
          }else if(banishIdx>=0){
            if(nbrs.has(banishIdx)){ if(banishAdj>=4)continue; }
            else { if(banishNon>=4)continue; }
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
            for(const j of nbrs) if(placed[j].cat!=="pedigree"){ d += BONUS; sparkSat[id] = true; break; }
          }else if(cat==="prairie"){
            for(const j of nbrs) if(placed[j].cat!=="pedigree") d += BONUS;
          }else if(cat==="contamination"){
            d += BONUS*nbrs.size;
          }else if(cat==="judgement"){
            judgeIdx = id;
            // One buff per distinct slate on the lines, not per covered cell.
            const buffed = new Set();
            for(const [gr,gc] of pl.gaps){
              const p = pid[gr*COLS+gc];
              if(p>=0 && !buffed.has(p)){ buffed.add(p); d += BONUS; }
            }
          }else if(cat==="banishment"){
            banishIdx = id; banishAdj = nbrs.size; banishNon = id - nbrs.size;
            d += BANISH_BONUS;
          }
          // Synergy granted to already-placed specials
          for(const j of nbrs){
            const jc = placed[j].cat;
            if(jc==="spark" && !sparkSat[j] && cat!=="pedigree"){ sparkSat[j] = true; satUndo.push(j); d += BONUS; }
            else if(jc==="prairie" && cat!=="pedigree") d += BONUS;
            else if(jc==="contamination") d += BONUS;
          }
          if(judgeIdx>=0 && judgeIdx!==id){
            // New piece on the lines = one buffed slate, however many cells it covers.
            const gs = placed[judgeIdx].gapSet;
            for(const [r,c] of pl.cells) if(gs.has(r*COLS+c)){ d += BONUS; break; }
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
function analyzeSolution(sol){
  if(!sol || !sol.length)return {items:[], gapAll:new Set(), gapCovered:new Set()};
  const pid = {};
  sol.forEach((p,i)=>p.cells.forEach(([r,c])=>{ pid[`${r},${c}`] = i; }));
  const neighborIds = (cells, self)=>{
    const s = new Set();
    for(const [r,c] of cells)for(const [dr,dc] of DIRS){
      const p = pid[`${r+dr},${c+dc}`];
      if(p!==undefined && p!==self) s.add(p);
    }
    return s;
  };
  const items = [];
  const gapAll = new Set(), gapCovered = new Set();
  sol.forEach((p,i)=>{
    const nbrs = [...neighborIds(p.cells, i)];
    if(p.cat==="spark"){
      const copyable = nbrs.filter(j=>sol[j].cat!=="pedigree");
      items.push({ok:copyable.length>0, cat:p.cat,
        text: copyable.length
          ? `Sparks of Moth Fire copies ${PIECE_LABELS[sol[copyable[0]].cat]}`
          : "Sparks of Moth Fire has no copyable neighbor"});
    }else if(p.cat==="prairie"){
      const copyable = nbrs.filter(j=>sol[j].cat!=="pedigree");
      items.push({ok:copyable.length>0, cat:p.cat,
        text: `Prairie Ablaze copies ${copyable.length} adjacent slate${copyable.length===1?"":"s"}`
          + (copyable.length ? ` (${copyable.map(j=>PIECE_LABELS[sol[j].cat]).join(", ")})` : "")});
    }else if(p.cat==="contamination"){
      items.push({ok:nbrs.length>0, cat:p.cat,
        text: `Contamination projects into ${nbrs.length} adjacent slate${nbrs.length===1?"":"s"}`});
    }else if(p.cat==="judgement"){
      const gaps = p.gaps || [];
      const buffedPieces = new Set();
      gaps.forEach(([r,c])=>{
        gapAll.add(`${r},${c}`);
        const j = pid[`${r},${c}`];
        if(j!==undefined){ buffedPieces.add(j); gapCovered.add(`${r},${c}`); }
      });
      items.push({ok:buffedPieces.size>0, cat:p.cat,
        text: `Judgement buffs ${buffedPieces.size} slate${buffedPieces.size===1?"":"s"} on its lines`
          + (buffedPieces.size ? ` (${[...buffedPieces].map(j=>PIECE_LABELS[sol[j].cat]).join(", ")})` : "")});
    }else if(p.cat==="banishment"){
      const adj = nbrs.length, non = sol.length - 1 - adj;
      const ok = adj===4 && non===4;
      items.push({ok, cat:p.cat,
        text: `Banishment: ${adj} adjacent / ${non} non-adjacent slates${ok?" — buff active":""}`});
    }
  });
  return {items, gapAll, gapCovered};
}

/* ───── Piece count color shading (vary per instance) ───── */
function shadeColor(hex,i){
  const shift = (i%3-1)*25;
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
  const [solving, setSolving] = useState(false);
  const [result, setResult] = useState(null);

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
    const res = solve(counts);
    setResult(res); setSolving(false);
  },[counts,totalArea]);

  const analysis = useMemo(()=>analyzeSolution(result?.solution), [result]);

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
            {col.cats.map(cat=>renderCard(cat, counts, setCount))}
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
          ⚠ Banishment's buff needs exactly 8 other slates (4 adjacent, 4 non-adjacent).
          You have {netherOthers} — it won't be placed unless the buff can be satisfied.
        </div>
      )}

      {/* ── Result stats ── */}
      {result && (
        <div style={{fontSize:12, color:"#64748b", display:"flex", gap:16, flexWrap:"wrap", justifyContent:"center"}}>
          <span>Score: <b style={{color:"#e2e8f0"}}>{result.score}</b></span>
          <span>Coverage: <b style={{color:result.coverage===TOTAL?"#22c55e":"#f59e0b"}}>{result.coverage}/{TOTAL}</b></span>
          <span>Bonus: <b style={{color:"#c084fc"}}>{result.bonus}</b></span>
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

            return(
              <div key={k} style={{
                width:CELL, height:CELL, position:"relative",
                background:col||"#1a2332",
                borderRadius:4, boxSizing:"border-box",
                borderTop:`${borderW("top")}px solid rgba(0,0,0,0.5)`,
                borderBottom:`${borderW("bottom")}px solid rgba(0,0,0,0.5)`,
                borderLeft:`${borderW("left")}px solid rgba(0,0,0,0.5)`,
                borderRight:`${borderW("right")}px solid rgba(0,0,0,0.5)`,
                outline:col?"none":(isGap?`2px dashed ${COLORS.judgement}aa`:"1px solid #2a3a4a"),
                outlineOffset:isGap&&!col?-3:0,
                boxShadow:isBuffed?`inset 0 0 0 3px ${COLORS.judgement}cc`:"none",
                transition:"background 0.3s",
              }}>
                {isGap && (
                  <span style={{
                    position:"absolute", top:2, right:4, fontSize:11,
                    color:isBuffed?"#fff":COLORS.judgement, textShadow:"0 0 3px rgba(0,0,0,0.8)",
                  }}>✦</span>
                )}
              </div>
            );
          })
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
    </div>
  );
}

function renderCard(cat, counts, setCount){
  // Inside the Nether section the header already says "Nether King's Divinity".
  const label = NETHER.includes(cat) ? PIECE_LABELS[cat].split(": ")[1] : PIECE_LABELS[cat];
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
