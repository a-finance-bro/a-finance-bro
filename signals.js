const fs = require("fs");

const LOGIN = "a-finance-bro";
async function getCalendar() {
  const token = process.env.PROFILE_TOKEN || process.env.GH_TOKEN;
  if (token) {
    try {
      const q = `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount weekday}}}}}}`;
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: "bearer " + token, "Content-Type": "application/json", "User-Agent": "signals-gen" },
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

const days = [];
const weekly = weeks.map((wk) => {
  const d = wk.contributionDays.slice().sort((a, b) => a.weekday - b.weekday);
  let s = 0;
  for (const x of d) { s += x.contributionCount; days.push(x.contributionCount); }
  return s;
});
const total = days.reduce((a, b) => a + b, 0);
const busiest = days.reduce((a, b) => Math.max(a, b), 0);

let longest = 0, run = 0;
for (const v of days) { run = v > 0 ? run + 1 : 0; if (run > longest) longest = run; }

let i = days.length - 1;
if (i >= 0 && days[i] === 0) i--;
let current = 0;
while (i >= 0 && days[i] > 0) { current++; i--; }

const CW = 840, CH = 220;
const cL = 10, cR = CW - 10, cT = 40, cB = 150;
const maxW = Math.max(1, ...weekly);
const n = weekly.length;
const X = (k) => cL + (k * (cR - cL)) / Math.max(1, n - 1);

const Y = (v) => cB - (Math.sqrt(v) / Math.sqrt(maxW)) * (cB - cT);
const pts = weekly.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`);
const line = "M" + pts.join(" L");
const area = `M${X(0).toFixed(1)},${cB} L` + pts.join(" L") + ` L${X(n - 1).toFixed(1)},${cB} Z`;

const ACC = "#c8a06a", HOT = "#e8c285", INK = "#eef1f8", DIM = "#9aa2b5", GRID = "#21262d";
const fmt = (x) => x.toLocaleString("en-US");
function stat(cx, big, label) {
  return `<text x="${cx}" y="188" text-anchor="middle" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="30" font-weight="700" fill="${INK}">${big}</text>
  <text x="${cx}" y="207" text-anchor="middle" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="12.5" letter-spacing="0.4" fill="${DIM}">${label}</text>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" fill="none">
<defs>
 <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="${ACC}" stop-opacity="0.42"/>
  <stop offset="100%" stop-color="${ACC}" stop-opacity="0"/>
 </linearGradient>
</defs>
<text x="${cL}" y="22" font-family="ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="13" letter-spacing="0.5" fill="${DIM}">Contribution activity · past year</text>
<line x1="${cL}" y1="${cB}" x2="${cR}" y2="${cB}" stroke="${GRID}" stroke-width="1"/>
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" stroke="${ACC}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
${stat(150, fmt(total), "CONTRIBUTIONS")}
${stat(420, current + (current === 1 ? " day" : " days"), "CURRENT STREAK")}
${stat(690, longest + (longest === 1 ? " day" : " days"), "LONGEST STREAK")}
<circle cx="${X(weekly.length - 1).toFixed(1)}" cy="${Y(weekly[weekly.length - 1]).toFixed(1)}" r="3" fill="${HOT}"/>
</svg>`;
fs.writeFileSync(__dirname + "/signals.svg", svg);
console.log(`wrote signals.svg ${(svg.length / 1024).toFixed(1)}KB | total ${total} | current ${current} | longest ${longest} | busiest ${busiest} | weeks ${n}`);
})();
