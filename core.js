// Shared game logic (browser + Node tests + optional Cloudflare Worker).
export const VERSION = 'mr-v1';
export const NUM_PROBLEMS = 10;
export const PENALTY_MS = 10000;      // +10 s per wrong answer
export const MIN_RAW_MS = 20000;      // faster than 2 s/problem for 3x2-digit = not believable
export const MAX_RAW_MS = 3600000;    // 1 hour
export const TZ = 'America/New_York';

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Daily round id = calendar date in New York, e.g. "2026-10-17".
export function todayRound(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function isDailyRound(id) { return /^\d{4}-\d{2}-\d{2}$/.test(id); }
// Custom rounds (?round=room5) -> "c-room5"
export function customRoundId(raw) {
  const slug = String(raw || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
  return slug ? 'c-' + slug : null;
}
export function isValidRoundId(id) { return isDailyRound(id) || /^c-[a-z0-9-]{1,20}$/.test(id); }

// Same 10 problems for everyone in a round: 3-digit (101-999, not x00) times 2-digit (12-99, not x0).
export function problemsFor(roundId) {
  const rnd = mulberry32(hashStr(VERSION + '|' + roundId));
  const out = [], seen = new Set();
  while (out.length < NUM_PROBLEMS) {
    const a = 101 + Math.floor(rnd() * 899);
    const b = 12 + Math.floor(rnd() * 88);
    if (a % 100 === 0 || a % 111 === 0 || b % 10 === 0 || b === 11) continue;
    const k = a + 'x' + b;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ a, b, answer: a * b });
  }
  return out;
}

// ---- names ----
const BAD_SUBSTR = ['fuck','fuk','fck','shit','bitch','btch','cunt','nigg','fag','slut','whore','penis','vagina','pussy','porn','sexy','dildo','boob','hitler','retard','stupid','idiot','loser','asshole','dickhead','wank','twat','bastard','killyou','poop'];
const BAD_WORD = ['ass','arse','butt','butthead','poop','pee','crap','damn','hell','piss','tit','tits','sex','hate','kill','die','ugly','fat','jerk','weirdo','moron','suck','sucks','balls','nut','nuts','fart','rape','nazi','dumb','dick','cock','kys'];
function leet(s) {
  return s.toLowerCase().replace(/[0]/g,'o').replace(/[1!|]/g,'i').replace(/3/g,'e').replace(/[4@]/g,'a').replace(/[5$]/g,'s').replace(/7/g,'t').replace(/8/g,'b');
}
export function cleanName(raw) {
  let s = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 15).join('').trim();
}
export function nameProblem(name) {
  if (!name || name.length < 2) return 'Please type at least 2 letters.';
  const l = leet(name);
  const squashed = l.replace(/[^a-z]/g, '');
  const squashedDedup = squashed.replace(/(.)\1+/g, '$1');
  if (BAD_SUBSTR.some((w) => squashed.includes(w) || squashedDedup.includes(w))) return 'Please pick a kinder name 🙂';
  const words = l.split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => BAD_WORD.includes(w) || BAD_WORD.includes(w.replace(/(.)\1+/g, '$1')))) return 'Please pick a kinder name 🙂';
  if (BAD_WORD.includes(squashed)) return 'Please pick a kinder name 🙂';
  return null;
}
export function nameKey(name) { return cleanName(name).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

// ---- scoring / validation (recomputes correctness from submitted answers) ----
export function scoreEntry(entry, roundId) {
  if (!entry || typeof entry !== 'object') return null;
  if (!isValidRoundId(roundId)) return null;
  const name = cleanName(entry.name);
  if (name !== entry.name || nameProblem(name)) return null;
  if (!Array.isArray(entry.answers) || entry.answers.length !== NUM_PROBLEMS) return null;
  const timeMs = Number(entry.timeMs);
  if (!Number.isFinite(timeMs) || timeMs < MIN_RAW_MS || timeMs > MAX_RAW_MS) return null;
  const probs = problemsFor(roundId);
  let correct = 0;
  for (let i = 0; i < NUM_PROBLEMS; i++) {
    const v = entry.answers[i];
    if (v !== null && !(Number.isInteger(v) && v >= 0 && v < 1e7)) return null;
    if (v === probs[i].answer) correct++;
  }
  const totalMs = Math.round(timeMs) + (NUM_PROBLEMS - correct) * PENALTY_MS;
  return { id: String(entry.id || ''), name, correct, timeMs: Math.round(timeMs), totalMs, ts: Number(entry.ts) || 0, roundId };
}
export function compareScores(x, y) {
  return (y.correct - x.correct) || (x.totalMs - y.totalMs) || (x.ts - y.ts);
}
export function rankRound(map, roundId) {
  const rows = [];
  for (const [id, e] of Object.entries(map || {})) {
    if (!e || typeof e !== 'object' || e.id !== id) continue;
    const s = scoreEntry(e, roundId);
    if (s) rows.push(s);
  }
  return rows.sort(compareScores);
}
export function fmtTime(ms) { return (ms / 1000).toFixed(1) + 's'; }
