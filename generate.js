const fs = require("fs");

const LOGIN = "a-finance-bro";
async function getCalendar() {
  const token = process.env.PROFILE_TOKEN || process.env.GH_TOKEN;
  if (token) {
    try {
      const q = `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount weekday}}}}}}`;
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: "bearer " + token, "Content-Type": "application/json", "User-Agent": "pacman-gen" },
        body: JSON.stringify({ query: q, variables: { l: LOGIN } }),
      });
      const j = await res.json();
      const cal = j && j.data && j.data.user && j.data.user.contributionsCollection.contributionCalendar;
      if (cal && cal.weeks && cal.weeks.length) {
        fs.writeFileSync(__dirname + "/contrib.json", JSON.stringify(j));
        return cal;
      }
    } catch (e) {
      console.error("graphql fetch failed; using cache:", e.message);
    }
  }
  return JSON.parse(fs.readFileSync(__dirname + "/contrib.json", "utf8")).data.user.contributionsCollection.contributionCalendar;
}

(async () => {
const cal = await getCalendar();
const weeks = cal.weeks;
const W = weeks.length, H = 7;

const counts = Array.from({ length: W }, () => Array(H).fill(-1));
weeks.forEach((wk, c) => wk.contributionDays.forEach((d) => (counts[c][d.weekday] = d.contributionCount)));
const nz = [].concat(...counts).filter((v) => v > 0).sort((a, b) => a - b);
const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] || 1;
const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
const lvlOf = (v) => (v < 0 ? -1 : v === 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4);
const lvl = Array.from({ length: W }, (_, c) => Array.from({ length: H }, (_, r) => lvlOf(counts[c][r])));

const now = new Date();
let SEED = process.env.PAC_SEED ? +process.env.PAC_SEED : now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CELL = 13, STEP = 16, GAP = STEP - CELL, MX = 12, MT = 26, MB = 26;
const cx = (c) => MX + c * STEP + CELL / 2;
const cy = (r) => MT + r * STEP + CELL / 2;
const SVGW = MX * 2 + (W - 1) * STEP + CELL;
const SVGH = MT + MB + (H - 1) * STEP + CELL;
const FILL = ["#171511", "#5c4a26", "#8a6e34", "#c8a06a", "#f0d9a8"];

const DIRS = [{ c: 0, r: -1 }, { c: -1, r: 0 }, { c: 0, r: 1 }, { c: 1, r: 0 }];
const d2 = (a, b) => (a.c - b.c) ** 2 + (a.r - b.r) ** 2;
const key = (p) => p.c + "," + p.r;
const eq = (a, b) => a.c === b.c && a.r === b.r;
const isRev = (d, dir) => dir && d.c === -dir.c && d.r === -dir.r;
const passable = (c, r) => c >= 0 && c < W && r >= 0 && r < H && lvl[c][r] >= 0;
function snapPass(c, r) {
  if (passable(c, r)) return { c, r };
  for (let rad = 1; rad < 12; rad++) for (const d of DIRS) if (passable(c + d.c * rad, r + d.r * rad)) return { c: c + d.c * rad, r: r + d.r * rad };
  return { c: 1, r: 0 };
}
const corners = [{ c: W - 1, r: 0 }, { c: 0, r: 0 }, { c: W - 1, r: 6 }, { c: 0, r: 6 }];
const ghostMeta = [
  { name: "blinky", color: "#e8564b" },
  { name: "pinky", color: "#f2a7cf" },
  { name: "inky", color: "#74d3ec" },
  { name: "clyde", color: "#e8a14e" },
];
const nearestGhost = (p, ghosts) => Math.min(...ghosts.map((g) => Math.abs(p.c - g.c) + Math.abs(p.r - g.r)));

const collides = (pFrom, pTo, gOld, gNew) => {
  for (let i = 0; i < gNew.length; i++) {
    if (eq(pTo, gNew[i])) return true;
    if (eq(gOld[i], pTo) && eq(gNew[i], pFrom)) return true;
  }
  return false;
};
function targetOf(gi, st) {
  const p = st.pac, dir = st.pdir;
  if (gi === 0) return { c: p.c, r: p.r };
  if (gi === 1) return { c: p.c + dir.c * 4, r: p.r + dir.r * 4 };
  if (gi === 2) { const p2 = { c: p.c + dir.c * 2, r: p.r + dir.r * 2 }; const b = st.ghosts[0]; return { c: 2 * p2.c - b.c, r: 2 * p2.r - b.r }; }
  const cl = st.ghosts[3];
  return d2(cl, p) > 64 ? { c: p.c, r: p.r } : corners[3];
}

const MAXLIFE = 500, HOR = 26, GHOST_SKIP = 7, MIN_LIFE = 170, DEATH_TICKS = 16;

function buildRun(seedVal) {
  const rnd = mulberry32(seedVal);

  const vwall = Array.from({ length: W }, () => Array(H).fill(false));
  const hwall = Array.from({ length: W }, () => Array(H).fill(false));
  const idxOf = (c, r) => c * H + r;
  const gnbrs = (c, r) => {
    const out = [];
    if (passable(c + 1, r)) out.push({ c: c + 1, r, kind: "v", wc: c, wr: r });
    if (passable(c - 1, r)) out.push({ c: c - 1, r, kind: "v", wc: c - 1, wr: r });
    if (passable(c, r + 1)) out.push({ c, r: r + 1, kind: "h", wc: c, wr: r });
    if (passable(c, r - 1)) out.push({ c, r: r - 1, kind: "h", wc: c, wr: r - 1 });
    return out;
  };
  const wallAt = (kind, wc, wr) => (kind === "v" ? vwall[wc][wr] : hwall[wc][wr]);
  const putWall = (kind, wc, wr, v) => { if (kind === "v") vwall[wc][wr] = v; else hwall[wc][wr] = v; };
  const openDeg = (c, r) => gnbrs(c, r).filter((n) => !wallAt(n.kind, n.wc, n.wr)).length;

  const edgeList = [];
  for (let c = 0; c < W; c++)
    for (let r = 0; r < H; r++) {
      if (!passable(c, r)) continue;
      if (passable(c + 1, r)) edgeList.push({ kind: "v", wc: c, wr: r, a: { c, r }, b: { c: c + 1, r } });
      if (passable(c, r + 1)) edgeList.push({ kind: "h", wc: c, wr: r, a: { c, r }, b: { c, r: r + 1 } });
    }
  for (let i = edgeList.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [edgeList[i], edgeList[j]] = [edgeList[j], edgeList[i]]; }

  let seedCell = null;
  for (let c = 0; c < W && !seedCell; c++) for (let r = 0; r < H; r++) if (passable(c, r)) { seedCell = { c, r }; break; }
  const totalCells = lvl.flat().filter((v) => v >= 0).length;
  const mazeConnected = () => {
    const seen = new Set([idxOf(seedCell.c, seedCell.r)]);
    const stack = [seedCell];
    while (stack.length) {
      const p = stack.pop();
      for (const n of gnbrs(p.c, p.r)) {
        if (wallAt(n.kind, n.wc, n.wr)) continue;
        const k = idxOf(n.c, n.r);
        if (!seen.has(k)) { seen.add(k); stack.push(n); }
      }
    }
    return seen.size === totalCells;
  };
  for (const e of edgeList) {
    if (openDeg(e.a.c, e.a.r) <= 2 || openDeg(e.b.c, e.b.r) <= 2) continue;
    putWall(e.kind, e.wc, e.wr, true);
    if (!mazeConnected()) putWall(e.kind, e.wc, e.wr, false);
  }

  const canMove = (f, t) => {
    if (!passable(t.c, t.r)) return false;
    const dc = t.c - f.c, dr = t.r - f.r;
    if (dc === 1) return !vwall[f.c][f.r];
    if (dc === -1) return !vwall[t.c][t.r];
    if (dr === 1) return !hwall[f.c][f.r];
    if (dr === -1) return !hwall[t.c][t.r];
    return false;
  };
  const moves = (p) => DIRS.map((d) => ({ d, n: { c: p.c + d.c, r: p.r + d.r } })).filter((o) => canMove(p, o.n));

  const NCELL = W * H;
  const DIST = new Array(NCELL).fill(null);
  for (let c = 0; c < W; c++)
    for (let r = 0; r < H; r++) {
      if (!passable(c, r)) continue;
      const src = c * H + r;
      const dist = new Int16Array(NCELL).fill(-1);
      dist[src] = 0;
      const queue = [{ c, r }]; let qi = 0;
      while (qi < queue.length) {
        const p = queue[qi++], dc = dist[p.c * H + p.r];
        for (const o of moves(p)) { const ni = o.n.c * H + o.n.r; if (dist[ni] === -1) { dist[ni] = dc + 1; queue.push(o.n); } }
      }
      DIST[src] = dist;
    }
  const gdist = (a, b) => { const da = DIST[a.c * H + a.r]; if (!da) return Infinity; const v = da[b.c * H + b.r]; return v < 0 ? Infinity : v; };

  function moveGhosts(st, tick) {
    for (let gi = 0; gi < 4; gi++) {
      if ((tick + gi * 2) % GHOST_SKIP === 0) continue;
      const g = st.ghosts[gi], dir = st.gdir[gi];
      const raw = st.scatter ? corners[gi] : targetOf(gi, st);
      const tgt = snapPass(raw.c, raw.r);
      let opts = moves(g).filter((o) => !isRev(o.d, dir));
      if (!opts.length) opts = moves(g);
      if (!opts.length) continue;

      let best = opts[0], bd = Infinity, be = Infinity;
      for (const o of opts) {
        const dd = gdist(o.n, tgt), ee = d2(o.n, tgt);
        if (dd < bd || (dd === bd && ee < be)) { bd = dd; be = ee; best = o; }
      }
      st.ghosts[gi] = best.n; st.gdir[gi] = best.d;
    }
  }

  function rollout(st0, Hn) {
    const st = { tick: st0.tick, pac: { ...st0.pac }, pdir: { ...st0.pdir }, ghosts: st0.ghosts.map((g) => ({ ...g })), gdir: st0.gdir.map((d) => ({ ...d })), scatter: st0.scatter };
    let minD = nearestGhost(st.pac, st.ghosts), caught = false;
    for (let h = 1; h <= Hn; h++) {
      const pacFrom = { ...st.pac };
      const gOld = st.ghosts.map((g) => ({ ...g }));
      moveGhosts(st, st0.tick + h);
      const opts = moves(st.pac).filter((o) => !collides(pacFrom, o.n, gOld, st.ghosts));
      if (!opts.length) { caught = true; break; }
      let bestO = opts[0], bs = -Infinity;
      for (const o of opts) {
        const s = nearestGhost(o.n, st.ghosts) * 3 + moves(o.n).length;
        if (s > bs) { bs = s; bestO = o; }
      }
      st.pac = bestO.n; st.pdir = bestO.d;
      minD = Math.min(minD, nearestGhost(st.pac, st.ghosts));
    }
    return { caught, minD };
  }
  function nearestPellet(from, eaten) {
    let best = null, bd = Infinity;
    for (let c = 0; c < W; c++) for (let r = 0; r < H; r++)
      if (passable(c, r) && lvl[c][r] > 0 && !eaten.has(c + "," + r)) { const dd = gdist(from, { c, r }); if (dd < bd) { bd = dd; best = { c, r }; } }
    return best;
  }

  const mid = Math.floor(W / 2);
  const so = Math.floor(rnd() * 18) - 9;
  const pac0 = snapPass(mid + so, [0, 3, 6][Math.floor(rnd() * 3)]);
  let st = { tick: 0, pac: { ...pac0 }, pdir: { c: 1, r: 0 }, ghosts: corners.map((c) => snapPass(c.c, c.r)), gdir: [{ c: -1, r: 0 }, { c: 1, r: 0 }, { c: -1, r: 0 }, { c: 1, r: 0 }], scatter: false };
  const eaten = new Set(), eatTick = {};
  const pacPath = [{ ...st.pac }], ghPaths = st.ghosts.map((g) => [{ ...g }]);
  let deathTick = -1;
  const eat = (p) => { const k = key(p); if (passable(p.c, p.r) && lvl[p.c][p.r] > 0 && !eaten.has(k)) { eaten.add(k); eatTick[k] = pacPath.length - 1; } };
  eat(st.pac);

  for (let t = 1; t < MAXLIFE; t++) {
    st.tick = t - 1;
    st.scatter = t % 80 < 16;
    const pacFrom = { ...st.pac };
    const gOld = st.ghosts.map((g) => ({ ...g }));
    moveGhosts(st, t);
    const target = nearestPellet(st.pac, eaten);

    const safe = moves(st.pac).filter((o) => !collides(pacFrom, o.n, gOld, st.ghosts));
    if (!safe.length) { deathTick = pacPath.length - 1; break; }
    let best = safe[0], bestScore = -Infinity;
    for (const o of safe) {
      const trial = { tick: t, pac: o.n, pdir: o.d, ghosts: st.ghosts.map((g) => ({ ...g })), gdir: st.gdir.map((d) => ({ ...d })), scatter: st.scatter };
      const { caught, minD } = rollout(trial, HOR);
      const safeNow = nearestGhost(o.n, st.ghosts);

      const dn = target ? gdist(o.n, target) : Infinity;
      const pull = target && dn < Infinity ? gdist(st.pac, target) - dn : 0;
      const pellet = lvl[o.n.c][o.n.r] > 0 && !eaten.has(key(o.n)) ? 1 : 0;
      const sameDir = o.d.c === st.pdir.c && o.d.r === st.pdir.r ? 1 : 0;
      const mob = moves(o.n).length;
      const score = (caught ? -1e6 : 0) + pellet * 7 + pull * 3.2 + minD * 2 + safeNow * 1 + sameDir * 0.6 + mob * 0.5 + rnd() * 0.4;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    st.pac = best.n; st.pdir = best.d;
    pacPath.push({ ...st.pac });
    st.ghosts.forEach((g, i) => ghPaths[i].push({ ...g }));
    eat(st.pac);
  }

  return { vwall, hwall, pacPath, ghPaths, eatTick, eaten, deathTick };
}

let best = null, picks = [];
for (let k = 0; k < 90; k++) {
  const sv = (SEED + k * 0x9e3779b1) | 0;
  const r = buildRun(sv);
  r._seed = sv;
  r._life = r.deathTick < 0 ? r.pacPath.length : r.deathTick;
  if (!best || r._life > best._life) best = r;
  if (r.deathTick >= MIN_LIFE) { picks.push(r); if (picks.length >= 6) break; }
}
const run = picks.length ? picks.reduce((a, b) => (b.eaten.size > a.eaten.size ? b : a)) : best;
const usedSeed = run._seed;
const died = run.deathTick >= 0;
const { vwall, hwall, pacPath, ghPaths, eatTick, eaten, deathTick } = run;

const pacFrames = pacPath.slice();
const ghFrames = ghPaths.map((p) => p.slice());
if (died) {
  for (let i = 0; i < DEATH_TICKS; i++) {
    pacFrames.push({ ...pacFrames[pacFrames.length - 1] });
    ghFrames.forEach((p) => p.push({ ...p[p.length - 1] }));
  }
}
const TOTAL = pacFrames.length;
const PER = 0.092;
const LOOP = (TOTAL * PER).toFixed(2);
const deathFrac = died ? (pacPath.length - 1) / (TOTAL - 1) : 1;

function motionAttrs(path) {
  const P = path.map((p) => ({ x: cx(p.c), y: cy(p.r) }));
  const n = P.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
  const total = cum[n - 1] || 1;
  const kp = cum.map((v) => (v / total).toFixed(5)).join(";");
  const kt = P.map((_, i) => (i / (n - 1)).toFixed(5)).join(";");
  const d = "M" + P.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L");
  return `calcMode="linear" keyPoints="${kp}" keyTimes="${kt}" path="${d}"`;
}
function pacD(angDeg) { const R = 7, a = (angDeg * Math.PI) / 180; const x = (R * Math.cos(a)).toFixed(2), y = (R * Math.sin(a)).toFixed(2); return `M0 0 L${x} ${y} A7 7 0 1 1 ${x} ${-y} Z`; }
const pacOpen = pacD(40), pacClosed = pacD(6);
function ghost(color, path, i) {
  const g = `M-6.5 -1 A6.5 6.5 0 0 1 6.5 -1 L6.5 6 L4.3 4 L2.2 6 L0 4 L-2.2 6 L-4.3 4 L-6.5 6 Z`;
  return `<g><animateMotion dur="${LOOP}s" repeatCount="indefinite" ${motionAttrs(path)}/>
  <g class="bob" style="animation-delay:${(-i * 0.35).toFixed(2)}s">
   <path d="${g}" fill="${color}"/>
   <circle cx="-2.4" cy="-1.4" r="1.7" fill="#fff"/><circle cx="2.4" cy="-1.4" r="1.7" fill="#fff"/>
   <circle cx="-1.9" cy="-1.1" r="0.8" fill="#1b2a4a"/><circle cx="2.9" cy="-1.1" r="0.8" fill="#1b2a4a"/>
  </g></g>`;
}

let cells = "";
for (let c = 0; c < W; c++)
  for (let r = 0; r < H; r++) {
    const L = lvl[c][r];
    if (L < 0) continue;
    const x = (MX + c * STEP).toFixed(1), y = (MT + r * STEP).toFixed(1), k = c + "," + r;
    let anim = "";
    if (L > 0 && k in eatTick) {

      const f = Math.max(0.02, Math.min(0.985, eatTick[k] / (TOTAL - 1)));
      anim = `<animate attributeName="opacity" dur="${LOOP}s" repeatCount="indefinite" values="1;1;0.1" keyTimes="0;${f.toFixed(3)};1" calcMode="linear"/>`;
    }
    cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${FILL[L]}">${anim}</rect>`;
  }

const TH = 2.4, WC = "#3a4a8c";
let mz = "";
for (let c = 0; c < W; c++)
  for (let r = 0; r < H; r++) {
    if (vwall[c][r]) {
      const x = (MX + c * STEP + CELL + (GAP - TH) / 2).toFixed(2);
      mz += `<rect x="${x}" y="${(MT + r * STEP - GAP / 2).toFixed(1)}" width="${TH}" height="${(CELL + GAP).toFixed(1)}" rx="${(TH / 2).toFixed(1)}" fill="${WC}"/>`;
    }
    if (hwall[c][r]) {
      const y = (MT + r * STEP + CELL + (GAP - TH) / 2).toFixed(2);
      mz += `<rect x="${(MX + c * STEP - GAP / 2).toFixed(1)}" y="${y}" width="${(CELL + GAP).toFixed(1)}" height="${TH}" rx="${(TH / 2).toFixed(1)}" fill="${WC}"/>`;
    }
  }

const ghosts = ghFrames.map((p, i) => ghost(ghostMeta[i].color, p, i)).join("\n");

const df2 = died ? (deathFrac + (1 - deathFrac) * 0.45).toFixed(4) : 1;
const deathAnim = died
  ? `<animate attributeName="opacity" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear" values="1;1;1;0" keyTimes="0;${deathFrac.toFixed(4)};${df2};1"/>
   <animateTransform attributeName="transform" type="scale" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear" values="1;1;1.6;0" keyTimes="0;${deathFrac.toFixed(4)};${df2};1"/>`
  : "";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVGW}" height="${SVGH}" viewBox="0 0 ${SVGW} ${SVGH}" fill="none">
<style>@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.3px)}}.bob{animation:bob 1s ease-in-out infinite}</style>
<g>${cells}</g>
<g opacity="0.85">${mz}</g>
${ghosts}
<g>
 <animateMotion dur="${LOOP}s" repeatCount="indefinite" rotate="auto" ${motionAttrs(pacFrames)}/>
 <g>${deathAnim}
  <path d="${pacClosed}" fill="#f5d152"><animate attributeName="d" dur=".34s" repeatCount="indefinite" values="${pacClosed};${pacOpen};${pacClosed}"/></path>
 </g>
</g>
</svg>`;
fs.writeFileSync(__dirname + "/pacman-contribution.svg", svg);
const wcount = vwall.flat().filter(Boolean).length + hwall.flat().filter(Boolean).length;
console.log(`wrote pacman-contribution.svg ${(svg.length / 1024).toFixed(1)}KB | baseSeed ${SEED} usedSeed ${usedSeed} | wallsegs ${wcount} | pellets ${nz.length} eaten ${eaten.size} | ${died ? "DIED@" + run.deathTick : "SURVIVED"} life ${run._life} | frames ${TOTAL} loop ${LOOP}s`);
})();
