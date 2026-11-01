import { useState, useMemo, useCallback, useRef } from "react";
import {
  ROWS, COLS, VALID, VALID_SET, TOTAL,
  PIECE_SIZE, PIECE_MAX, NETHER, NETHER_1X1, COLORS, PIECE_LABELS, PIECE_DESC, PIECE_DESC_1X1,
  NETHER_MODS, EMPTY_MODS, DEFAULT_PEDIGREE_VALUE, MAX_PEDIGREE_VALUE,
  DEFAULT_NORMAL_VALUE, MIN_NORMAL_VALUE, MAX_NORMAL_VALUE,
  DEFAULT_NETHER_VALUE, MAX_NETHER_VALUE, DEFAULT_NODE_VALS, NETHER_FULL_SHAPES,
  CONTAM_PCT, BANISH_MIN, modValueTable, analyzeSolution,
} from "./solver.js";

/* Rotate a cell 90° clockwise k times on the (4-fold symmetric) board. */
function rotCell([r,c], k){
  let rr = r, cc = c;
  for(let i=0;i<k;i++){ const nr = cc, nc = COLS-1-rr; rr = nr; cc = nc; }
  return [rr,cc];
}

/* ───── Inventory columns ───── */
const INV_COLUMNS = [
  {title:"SLATES",                 note:null,                                                                cats:["normal","starlight","corner"]},
  {title:"LEGENDARY SLATES",       note:null,                                                                cats:["pedigree","spark","prairie"]},
  {title:"NETHER KING'S DIVINITY", note:"Only one variant can be owned — selecting one clears the others.",  cats:NETHER},
];
const INV_ORDER = INV_COLUMNS.flatMap(col=>col.cats);

/* ───── Search budget presets ───── */
const BUDGETS = [
  {label:"4M states",   hint:"~4s",             v:4_000_000},
  {label:"10M states",  hint:"~10s",            v:10_000_000},
  {label:"25M states",  hint:"~25s",            v:25_000_000},
  {label:"50M states",  hint:"~1min",           v:50_000_000},
  {label:"100M states", hint:"~2min",           v:100_000_000},
  {label:"250M states", hint:"~4min",           v:250_000_000},
  {label:"Unlimited",   hint:"until exhausted", v:Infinity},
];

/* ───── Piece count color shading (vary per instance) ───── */
const SHADE_SHIFTS = [-42,-14,14,42];
function shadeColor(hex,i){
  const shift = SHADE_SHIFTS[i%SHADE_SHIFTS.length];
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const clamp = v=>Math.max(0,Math.min(255,v+shift));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

const fmtNum = v=>Math.round(v*10)/10;

/* ═════════════════════════════════════════════════════ */
/*                    COMPONENT                          */
/* ═════════════════════════════════════════════════════ */
const CELL = 52, GAP = 2;
const EMPTY_COUNTS = Object.fromEntries(INV_ORDER.map(c=>[c,0]));

export default function SlateOptimizer(){
  const [counts, setCounts] = useState({...EMPTY_COUNTS});
  const [mods, setMods] = useState({...EMPTY_MODS});
  const [pedigreeVal, setPedigreeVal] = useState(DEFAULT_PEDIGREE_VALUE);
  const [requirePedigree, setRequirePedigree] = useState(false);
  const [requireNether, setRequireNether] = useState(false);
  const [netherVal, setNetherVal] = useState(DEFAULT_NETHER_VALUE); // 1×1's single mod
  const [nodeVals, setNodeVals] = useState(()=>structuredClone(DEFAULT_NODE_VALS)); // full size: one per cell
  const [nodeEditOpen, setNodeEditOpen] = useState(null); // which full-size Nether King's mod editor is open
  const [netherSmall, setNetherSmall] = useState({judgement:false, contamination:false, banishment:false}); // true = 1×1
  const [normalVal, setNormalVal] = useState(DEFAULT_NORMAL_VALUE);
  const [rotation, setRotation] = useState(0); // quarter-turns clockwise applied to the displayed layout
  const [modOpen, setModOpen] = useState(null); // which nether cat's modifier panel is open
  const [budgetIdx, setBudgetIdx] = useState(2); // default 25M states
  const [solving, setSolving] = useState(false);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null); // {iters, score} while solving
  const [hover, setHover] = useState(null); // {r,c} of hovered grid cell
  const workerRef = useRef(null);
  const progressRef = useRef(null);

  const toggleMod = useCallback((id)=>{
    setMods(p=>({...p, [id]:!p[id]}));
    setResult(null);
  },[]);

  const changePedigreeVal = useCallback((v)=>{
    setPedigreeVal(Math.max(0, Math.min(MAX_PEDIGREE_VALUE, v)));
    setResult(null);
  },[]);

  const changeNetherVal = useCallback((v)=>{
    setNetherVal(Math.max(0, Math.min(MAX_NETHER_VALUE, v)));
    setResult(null);
  },[]);

  const changeNodeVal = useCallback((cat, k, v)=>{
    setNodeVals(p=>{
      const vals = [...p[cat]];
      vals[k] = Math.max(0, Math.min(MAX_NETHER_VALUE, v));
      return {...p, [cat]:vals};
    });
    setResult(null);
  },[]);

  const toggleNetherSize = useCallback((cat)=>{
    setNetherSmall(p=>({...p, [cat]:!p[cat]}));
    setResult(null);
  },[]);

  // Cells a slate type takes in the current inventory (Nether Kings depend on the size switch).
  const sizeOf = useCallback(cat=>netherSmall[cat] ? 1 : PIECE_SIZE[cat], [netherSmall]);

  const changeNormalVal = useCallback((v)=>{
    setNormalVal(Math.max(MIN_NORMAL_VALUE, Math.min(MAX_NORMAL_VALUE, v)));
    setResult(null);
  },[]);

  const toggleRequirePedigree = useCallback(()=>{
    setRequirePedigree(prev=>{
      const next = !prev;
      // Requiring pedigree implies owning one.
      if(next) setCounts(p=>p.pedigree>0 ? p : {...p, pedigree:1});
      return next;
    });
    setResult(null);
  },[]);

  const totalArea = useMemo(()=>INV_ORDER.reduce((s,c)=>s+counts[c]*sizeOf(c),0), [counts,sizeOf]);

  const setCount = useCallback((cat,v)=>{
    const val = Math.max(0, Math.min(PIECE_MAX[cat], v));
    setCounts(p=>{
      const n = {...p, [cat]:val};
      // Only one Nether King's Divinity variant may be owned.
      if(NETHER.includes(cat) && val>0) NETHER.filter(x=>x!==cat).forEach(x=>{ n[x]=0; });
      return n;
    });
    if(cat==="pedigree" && val===0) setRequirePedigree(false);
    if(NETHER.includes(cat) && val===0) setRequireNether(false);
    setResult(null);
  },[]);

  // Requiring a variant implies owning it, which (one variant max) clears the others.
  const toggleRequireNether = useCallback((cat, isRequiredHere)=>{
    if(isRequiredHere){ setRequireNether(false); setResult(null); return; }
    setCount(cat, 1);
    setRequireNether(true);
  },[setCount]);

  const handleSolve = useCallback(()=>{
    if(totalArea===0 || solving)return;
    setSolving(true); setResult(null); setProgress(null); progressRef.current = null;
    if(!workerRef.current){
      workerRef.current = new Worker(new URL("./solverWorker.js", import.meta.url), {type:"module"});
    }
    const w = workerRef.current;
    w.onmessage = (e)=>{
      if(e.data.type==="progress"){
        progressRef.current = e.data;
        setProgress({iters:e.data.iters, score:e.data.best.score});
      }else if(e.data.type==="done"){
        setResult(e.data.result); setSolving(false); setProgress(null);
      }
    };
    // The solver treats 1×1 Nether Kings as their own slate types.
    const solveCounts = {...counts};
    for(const v of NETHER) if(netherSmall[v]){ solveCounts[NETHER_1X1[v]] = counts[v]; solveCounts[v] = 0; }
    w.postMessage({counts:solveCounts, mods, pedigreeVal, normalVal, netherVal, nodeVals, requirePedigree, requireNether, maxIters:BUDGETS[budgetIdx].v});
  },[counts,netherSmall,mods,pedigreeVal,normalVal,netherVal,nodeVals,requirePedigree,requireNether,totalArea,solving,budgetIdx]);

  const handleCancel = useCallback(()=>{
    if(workerRef.current){ workerRef.current.terminate(); workerRef.current = null; }
    const p = progressRef.current;
    if(p){
      setResult({solution:p.best.sol, score:p.best.score, coverage:p.best.coverage,
        bonus:p.best.bonus, intrinsic:p.best.intrinsic, iterations:p.iters, time:0, timedOut:true, cancelled:true,
        banishBuffInactive:p.best.buffInactive});
    }
    setSolving(false); setProgress(null);
  },[]);

  // The solution as displayed: rotated by the user's chosen quarter-turns.
  const shownSolution = useMemo(()=>{
    if(!result?.solution)return null;
    const k = ((rotation%4)+4)%4;
    if(k===0)return result.solution;
    return result.solution.map(p=>({
      ...p,
      cells: p.cells.map(c=>rotCell(c,k)),
      gaps: p.gaps ? p.gaps.map(c=>rotCell(c,k)) : p.gaps,
    }));
  },[result,rotation]);

  const analysis = useMemo(()=>analyzeSolution(shownSolution, mods, {pedigreeVal, normalVal, netherVal, nodeVals}),
    [shownSolution,mods,pedigreeVal,normalVal,netherVal,nodeVals]);

  // Build display grid from solution
  const display = useMemo(()=>{
    if(!shownSolution)return {cellColor:{}, cellPieceId:{}, borders:{}};
    const cellColor = {}, cellPieceId = {};
    shownSolution.forEach((p,i)=>{
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
  },[shownSolution]);

  const netherOthers = INV_ORDER.filter(c=>c!=="banishment").reduce((s,c)=>s+counts[c],0);
  const banishWarn = counts.banishment>0 && !netherSmall.banishment && netherOthers<2*BANISH_MIN;

  // Tooltip content for the hovered cell
  const hoverInfo = useMemo(()=>{
    if(!hover || !shownSolution)return null;
    const k = `${hover.r},${hover.c}`;
    const pidH = display.cellPieceId[k];
    if(pidH!==undefined){
      const p = shownSolution[pidH];
      const m = analysis.cellMods[k];
      const modLine = m && `This cell: mod ${m.n} of 3${m.anchor?" (◈ anchor)":""}, worth ${m.value}`;
      return {pid:pidH, title:PIECE_LABELS[p.cat], color:COLORS[p.cat],
        lines:[modLine, analysis.pieceNotes[pidH], ...(analysis.pieceTags[pidH]||[])].filter(Boolean)};
    }
    if(analysis.gapAll.has(k))
      return {pid:null, title:"Judgement buff line", color:COLORS.judgement,
        lines:["A slate placed here gets buffed"]};
    return null;
  },[hover,shownSolution,display,analysis]);

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
            {col.cats.map(cat=>renderCard(cat, counts, setCount, mods, setModOpen,
              {pedigreeVal, changePedigreeVal, requirePedigree, toggleRequirePedigree,
               requireNether, toggleRequireNether,
               netherVal, changeNetherVal, netherSmall, toggleNetherSize, sizeOf,
               nodeVals, openNodeEditor:setNodeEditOpen,
               normalVal, changeNormalVal}))}
          </div>
        ))}
      </div>

      {/* ── Stats + Solve ── */}
      <div style={{display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", justifyContent:"center"}}>
        <div style={{fontSize:13, color:totalArea>TOTAL?"#f59e0b":"#64748b"}}>
          {totalArea} / {TOTAL} cells
          {totalArea>TOTAL && " (over capacity — solver picks the best subset)"}
        </div>
        <button onClick={solving?handleCancel:handleSolve} disabled={!solving&&totalArea===0} style={{
          padding:"10px 28px", fontSize:14, fontWeight:700, fontFamily:"inherit",
          background:solving?"#7f1d1d":totalArea===0?"#0f1419":"#2563eb",
          color:!solving&&totalArea===0?"#475569":"#fff",
          border:"1px solid "+(solving?"#b91c1c":totalArea===0?"#1e293b":"#3b82f6"),
          borderRadius:8, cursor:!solving&&totalArea===0?"not-allowed":"pointer",
          transition:"all 0.2s",
        }}>
          {solving?"Cancel":"Solve"}
        </button>
        <button onClick={()=>{setCounts({...EMPTY_COUNTS});setResult(null);}} disabled={solving} style={{
          padding:"10px 16px", fontSize:12, fontFamily:"inherit",
          background:"#1e293b", color:solving?"#475569":"#94a3b8", border:"1px solid #334155",
          borderRadius:8, cursor:solving?"not-allowed":"pointer",
        }}>Reset</button>
        <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:2}}>
          <input type="range" min={0} max={BUDGETS.length-1} step={1} value={budgetIdx}
            disabled={solving}
            onChange={e=>setBudgetIdx(+e.target.value)}
            style={{width:140, accentColor:"#7c3aed", cursor:solving?"not-allowed":"pointer"}}/>
          <div style={{fontSize:10, color:"#64748b"}}>
            Time limit: <b style={{color:"#94a3b8"}}>{BUDGETS[budgetIdx].hint}</b> · {BUDGETS[budgetIdx].label}
          </div>
        </div>
      </div>

      {banishWarn && (
        <div style={{fontSize:11, color:"#f59e0b", maxWidth:520, textAlign:"center"}}>
          ⚠ Banishment's buff needs at least {2*BANISH_MIN} other slates ({BANISH_MIN}+ adjacent, {BANISH_MIN}+ non-adjacent).
          You have {netherOthers} — {requireNether
            ? "it will be placed without its buff."
            : "it won't be placed unless the buff can be satisfied."}
        </div>
      )}

      {/* ── Live progress while solving ── */}
      {solving && (
        <div style={{fontSize:12, color:"#94a3b8"}}>
          Searching… {progress ? `${progress.iters.toLocaleString()} states · best score ${fmtNum(progress.score)}` : "warming up"}
        </div>
      )}

      {/* ── Result stats ── */}
      {result && (
        <div style={{fontSize:12, color:"#64748b", display:"flex", gap:16, flexWrap:"wrap", justifyContent:"center"}}>
          <span>Effective mods: <b style={{color:"#e2e8f0"}}>{fmtNum(result.score)}</b></span>
          <span>Slates: <b style={{color:"#94a3b8"}}>{fmtNum(result.intrinsic)}</b> · Synergy: <b style={{color:"#c084fc"}}>+{fmtNum(result.bonus)}</b></span>
          <span>Coverage: <b style={{color:result.coverage===TOTAL?"#22c55e":"#f59e0b"}}>{result.coverage}/{TOTAL}</b></span>
          <span>Pieces placed: {result.solution.length}</span>
          <span>
            Searched {result.iterations.toLocaleString()} states{result.time?` in ${result.time}ms`:""}
            {result.cancelled?" (cancelled — best found)":result.timedOut?" (budget reached — best found)":" (exhaustive — optimal)"}
          </span>
        </div>
      )}

      {/* ── Explain results that would otherwise look broken ── */}
      {result && result.solution.length===0 && (
        <div style={{fontSize:12, color:"#f59e0b", maxWidth:560, textAlign:"center",
          border:"1px solid #f59e0b55", borderRadius:8, padding:"8px 12px"}}>
          ⚠ {result.timedOut
            ? "No layout that includes all your Required slates was found before the time limit. Try a longer time limit."
            : "No layout can include all your Required slates together. Turn off a Require toggle or change your inventory."}
        </div>
      )}
      {result && result.banishBuffInactive && (
        <div style={{fontSize:12, color:"#f59e0b", maxWidth:560, textAlign:"center",
          border:"1px solid #f59e0b55", borderRadius:8, padding:"8px 12px"}}>
          ⚠ Banishment is placed without its buff: no layout gives it {BANISH_MIN}+ adjacent and {BANISH_MIN}+ non-adjacent
          slates with this inventory. All of those slates must fit in the {TOTAL-PIECE_SIZE.banishment} cells around
          Banishment, so smaller slates (Fallen Starlight, Sparks, Prairie) make the buff easier to reach.
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
                  {analysis.cellMods[k] && (
                    <span style={{
                      position:"absolute", bottom:2, left:4, fontSize:11, fontWeight:700,
                      color:"#fff", textShadow:"0 0 3px rgba(0,0,0,0.9)", pointerEvents:"none",
                    }}>{analysis.cellMods[k].anchor?"◈ ":""}{analysis.cellMods[k].value}</span>
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

      {/* ── Rotate layout (Nether King slots are fixed in-game; rotating the whole board is fine) ── */}
      {result?.solution && result.solution.length>0 && (
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <Btn onClick={()=>setRotation(r=>r-1)}>⟲ Rotate left</Btn>
          <span style={{fontSize:10, color:"#64748b", minWidth:36, textAlign:"center"}}>
            {(((rotation%4)+4)%4)*90}°
          </span>
          <Btn onClick={()=>setRotation(r=>r+1)}>Rotate right ⟳</Btn>
        </div>
      )}

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

      {/* ── Full-size Nether King per-mod value editor ── */}
      {nodeEditOpen && (
        <div onClick={()=>setNodeEditOpen(null)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:100,
          display:"flex", alignItems:"center", justifyContent:"center", padding:20,
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:"#141c27", border:"1px solid #4c3a6e", borderRadius:12,
            padding:"16px 20px", width:440, maxWidth:"92vw", maxHeight:"85vh",
            overflowY:"auto", boxSizing:"border-box",
            display:"flex", flexDirection:"column", alignItems:"center", gap:10,
          }}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", alignSelf:"stretch"}}>
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <div style={{width:12, height:12, borderRadius:3, background:COLORS[nodeEditOpen]}}/>
                <span style={{fontSize:13, fontWeight:700, color:"#e2e8f0"}}>
                  {PIECE_LABELS[nodeEditOpen].split(": ")[1]} — Mod values
                </span>
              </div>
              <Btn small onClick={()=>setNodeEditOpen(null)}>✕</Btn>
            </div>
            <div style={{fontSize:10, color:"#8b80a8", lineHeight:1.5}}>
              Each square holds its own mod. Set what each one is worth: Sparks and Prairie copy the
              square they touch. The result board shows these values on the piece so you can line it up in-game.
              {nodeEditOpen==="banishment" && " Drawn as it sits on an outer edge, with the ◈ anchor at the tip."}
              {nodeEditOpen==="judgement" && " Dashed squares are its buff lines."}
            </div>
            <NodeValueEditor cat={nodeEditOpen} vals={nodeVals[nodeEditOpen]}
              onChange={(k,v)=>changeNodeVal(nodeEditOpen, k, v)}/>
            <div style={{fontSize:11, color:"#94a3b8"}}>
              Total: <b style={{color:"#e2e8f0"}}>{nodeVals[nodeEditOpen].reduce((s,v)=>s+v,0)}</b> mods
              {nodeEditOpen==="contamination" &&
                ` · projects ${fmtNum(nodeVals.contamination.reduce((s,v)=>s+v,0)*CONTAM_PCT)} per touching slate (${Math.round(CONTAM_PCT*100)}%)`}
            </div>
          </div>
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

function renderCard(cat, counts, setCount, mods, openMods, extras){
  const {pedigreeVal, changePedigreeVal, requirePedigree, toggleRequirePedigree,
         requireNether, toggleRequireNether,
         netherVal, changeNetherVal, netherSmall, toggleNetherSize, sizeOf,
         nodeVals, openNodeEditor,
         normalVal, changeNormalVal} = extras;
  const isNether = NETHER.includes(cat);
  const small = isNether && netherSmall[cat];
  const netherRequiredHere = requireNether && counts[cat]>0;
  // Inside the Nether section the header already says "Nether King's Divinity".
  const label = isNether ? PIECE_LABELS[cat].split(": ")[1] : PIECE_LABELS[cat];
  // Talent nodes only act through the Authority Effect, which a 1×1 doesn't have.
  const modList = small ? null : NETHER_MODS[cat];
  const activeMods = modList ? modList.filter(m=>mods[m.id]).length : 0;
  const intrinsicMods = modValueTable(pedigreeVal, normalVal, netherVal, nodeVals)[cat];
  const size = sizeOf(cat);
  const desc = small ? PIECE_DESC_1X1[cat] : PIECE_DESC[cat];
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
          {size} cell{size===1?"":"s"} · max {PIECE_MAX[cat]}
          {cat!=="pedigree" && cat!=="normal" && !isNether && intrinsicMods>0 ? ` · ${intrinsicMods} mods` : ""}
          {desc ? ` · ${desc}` : ""}
        </div>
        {cat==="normal" && (
          <div style={{display:"flex", alignItems:"center", gap:6, marginTop:4}}>
            <span style={{fontSize:10, color:"#64748b"}}>Mod value:</span>
            <Btn small onClick={()=>changeNormalVal(normalVal-1)} disabled={normalVal<=MIN_NORMAL_VALUE}>−</Btn>
            <span style={{fontSize:12, fontWeight:700, color:COLORS.normal, minWidth:16, textAlign:"center"}}>{normalVal}</span>
            <Btn small onClick={()=>changeNormalVal(normalVal+1)} disabled={normalVal>=MAX_NORMAL_VALUE}>+</Btn>
          </div>
        )}
        {cat==="pedigree" && (
          <div style={{display:"flex", alignItems:"center", gap:6, marginTop:4, flexWrap:"wrap"}}>
            <span style={{fontSize:10, color:"#64748b"}}>Mod value:</span>
            <Btn small onClick={()=>changePedigreeVal(pedigreeVal-1)} disabled={pedigreeVal<=0}>−</Btn>
            <span style={{fontSize:12, fontWeight:700, color:"#c084fc", minWidth:16, textAlign:"center"}}>{pedigreeVal}</span>
            <Btn small onClick={()=>changePedigreeVal(pedigreeVal+1)} disabled={pedigreeVal>=MAX_PEDIGREE_VALUE}>+</Btn>
            <RequirePill on={requirePedigree} onClick={toggleRequirePedigree}/>
          </div>
        )}
        {isNether && (
          <>
            <div style={{display:"flex", alignItems:"center", gap:6, marginTop:4, flexWrap:"wrap"}}>
              <SizeSwitch small={small} onClick={()=>toggleNetherSize(cat)}/>
              <RequirePill on={netherRequiredHere} onClick={()=>toggleRequireNether(cat, netherRequiredHere)}/>
            </div>
            {small ? (
              <div style={{display:"flex", alignItems:"center", gap:6, marginTop:4, flexWrap:"wrap"}}>
                <span style={{fontSize:10, color:"#64748b"}} title="What this 1×1's mod is worth, including when Sparks or Prairie copy it">Mod value:</span>
                <Btn small onClick={()=>changeNetherVal(netherVal-1)} disabled={netherVal<=0}>−</Btn>
                <span style={{fontSize:12, fontWeight:700, color:COLORS[cat], minWidth:16, textAlign:"center"}}>{netherVal}</span>
                <Btn small onClick={()=>changeNetherVal(netherVal+1)} disabled={netherVal>=MAX_NETHER_VALUE}>+</Btn>
              </div>
            ) : (
              <div style={{display:"flex", alignItems:"center", gap:6, marginTop:4, flexWrap:"wrap"}}>
                <span style={{fontSize:10, color:"#64748b"}}>Mod values:</span>
                <span style={{fontSize:12, fontWeight:700, color:COLORS[cat]}}>{nodeVals[cat].join(" · ")}</span>
                <button onClick={()=>openNodeEditor(cat)} title="Set the value of each square's mod" style={{
                  padding:"4px 10px", fontSize:10, fontWeight:700, fontFamily:"inherit",
                  background:"#1e293b", color:"#94a3b8", border:"1px solid #334155",
                  borderRadius:12, cursor:"pointer", lineHeight:1,
                }}>Edit</button>
              </div>
            )}
          </>
        )}
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

function NodeValueEditor({cat, vals, onChange}){
  const shape = NETHER_FULL_SHAPES[cat];
  const gaps = shape.gaps || [];
  const all = shape.cells.concat(gaps);
  const rows = Math.max(...all.map(p=>p[0]))+1, cols = Math.max(...all.map(p=>p[1]))+1;
  const S = 76;
  const at = (r,c)=>shape.cells.find(([a,b])=>a===r&&b===c);
  return(
    <div style={{display:"grid", gridTemplateColumns:`repeat(${cols},${S}px)`, gridTemplateRows:`repeat(${rows},${S}px)`, gap:4}}>
      {Array.from({length:rows*cols},(_,i)=>{
        const r = Math.floor(i/cols), c = i%cols, cell = at(r,c);
        if(!cell){
          const isGap = gaps.some(([a,b])=>a===r&&b===c);
          return <div key={i} style={{borderRadius:6, boxSizing:"border-box",
            border:isGap?`2px dashed ${COLORS.judgement}66`:"none",
            display:"flex", alignItems:"center", justifyContent:"center", color:`${COLORS.judgement}88`, fontSize:12}}>
            {isGap?"✦":""}</div>;
        }
        const k = cell[2], anchor = cat==="banishment" && k===2;
        return(
          <div key={i} style={{
            borderRadius:6, boxSizing:"border-box", background:`${COLORS[cat]}33`,
            border:`2px solid ${COLORS[cat]}`, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", gap:2,
          }}>
            <span style={{fontSize:9, color:"#c8b8ec"}}>Mod {k+1}{anchor?" ◈":""}</span>
            <span style={{fontSize:18, fontWeight:700, color:"#fff", lineHeight:1}}>{vals[k]}</span>
            <div style={{display:"flex", gap:3}}>
              <Btn small onClick={()=>onChange(k, vals[k]-1)} disabled={vals[k]<=0}>−</Btn>
              <Btn small onClick={()=>onChange(k, vals[k]+1)} disabled={vals[k]>=MAX_NETHER_VALUE}>+</Btn>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SizeSwitch({small, onClick}){
  const seg = active=>({
    padding:"4px 8px", fontSize:10, fontWeight:700, lineHeight:1,
    background:active?"#3b2a5e":"transparent", color:active?"#c4a7f7":"#64748b",
  });
  return(
    <button onClick={onClick} title="Switch between the full-size and 1×1 version" style={{
      display:"flex", padding:0, fontFamily:"inherit", cursor:"pointer", overflow:"hidden",
      background:"#1e293b", border:"1px solid #334155", borderRadius:12,
    }}>
      <span style={seg(!small)}>Full size</span>
      <span style={seg(small)}>1×1</span>
    </button>
  );
}

function RequirePill({on, onClick}){
  return(
    <button onClick={onClick} style={{
      padding:"4px 10px", fontSize:10, fontWeight:700, fontFamily:"inherit",
      background:on?"#3b2a5e":"#1e293b",
      color:on?"#c4a7f7":"#94a3b8",
      border:`1px solid ${on?"#7c3aed":"#334155"}`,
      borderRadius:12, cursor:"pointer", lineHeight:1,
    }}>
      {on?"✓ Required":"Require"}
    </button>
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
