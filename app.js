import { problemsFor, todayRound, customRoundId, isDailyRound, cleanName, nameProblem, nameKey,
  scoreEntry, fmtTime, NUM_PROBLEMS, PENALTY_MS } from './core.js';
import { getStore } from './store.js';

const $ = (id) => document.getElementById(id);
const screens = ['home', 'countdown', 'play', 'results', 'board'];
function show(id) { screens.forEach((s) => $(s).classList.toggle('hidden', s !== id)); window.scrollTo(0, 0); }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const params = new URLSearchParams(location.search);
const custom = customRoundId(params.get('round'));
const ROUND = custom || todayRound();
const isTouch = matchMedia('(pointer: coarse)').matches;

let deviceId = ls.get('mr:device');
if (!deviceId) { deviceId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 16); ls.set('mr:device', deviceId); }

function prettyRound(id) {
  if (isDailyRound(id)) {
    const [y, m, d] = id.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return 'Room “' + id.slice(2) + '”';
}
$('roundPill').textContent = (custom ? '🎯 ' : '📅 Today: ') + prettyRound(ROUND);
$('tabToday').textContent = custom ? 'This room' : 'Today';
$('name').value = ls.get('mr:lastName') || '';

// ---------- game state ----------
let G = null, timerHandle = null, busy = false;

function liveMs() {
  if (!G) return 0;
  return G.accum + (G.t0 ? performance.now() - G.t0 : 0) + G.wrong * PENALTY_MS;
}
function tick() { $('timer').textContent = '⏱ ' + (liveMs() / 1000).toFixed(1) + 's'; }

$('startBtn').onclick = () => {
  const name = cleanName($('name').value);
  $('name').value = name;
  const prob = nameProblem(name);
  if (prob) { $('nameErr').textContent = prob; $('name').classList.add('shake'); setTimeout(() => $('name').classList.remove('shake'), 400); return; }
  if (name.includes(' ') && !confirm('Just a first name or nickname, please — no last names. Keep "' + name + '"?')) return;
  $('nameErr').textContent = '';
  ls.set('mr:lastName', name);
  startGame(name);
};
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('startBtn').click(); });

function startGame(name) {
  const nk = nameKey(name);
  const practice = !!ls.get(`mr:played:${ROUND}:${nk}`);
  G = { name, nk, practice, probs: problemsFor(ROUND), i: 0, answers: [], accum: 0, t0: 0, wrong: 0 };
  G.ticket = practice ? Promise.resolve(null) : getStore().then((st) => st.startRun(ROUND)).catch(() => null);
  $('practiceTag').textContent = practice ? '🧪 Practice run (your first score is already saved)' : '🏁 Official run!';
  $('dots').innerHTML = G.probs.map(() => '<span class="dot"></span>').join('');
  show('countdown');
  let n = 3; $('countNum').textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) $('countNum').textContent = n;
    else if (n === 0) $('countNum').textContent = 'GO!';
    else { clearInterval(iv); show('play'); nextProblem(); timerHandle = setInterval(tick, 100); }
  }, 700);
}

function nextProblem() {
  const p = G.probs[G.i];
  $('qnum').textContent = `${G.i + 1} / ${NUM_PROBLEMS}`;
  $('problem').innerHTML = `${p.a} <span class="x">×</span> ${p.b}`;
  [...$('dots').children].forEach((d, k) => d.classList.toggle('cur', k === G.i));
  $('answer').value = '';
  if (!isTouch) $('answer').focus();
  G.t0 = performance.now();
  busy = false;
}

function submitAnswer() {
  if (!G || busy) return;
  const raw = $('answer').value.replace(/\D/g, '');
  if (!raw) { $('answer').classList.add('shake'); setTimeout(() => $('answer').classList.remove('shake'), 350); return; }
  busy = true;
  G.accum += performance.now() - G.t0; G.t0 = 0; // clock pauses during feedback
  const val = parseInt(raw, 10);
  const p = G.probs[G.i];
  const ok = val === p.answer;
  G.answers.push(val);
  if (!ok) G.wrong++;
  const dot = $('dots').children[G.i]; dot.classList.remove('cur'); dot.classList.add(ok ? 'ok' : 'no');
  tick();
  $('fbBig').textContent = ok ? ['🎉', '⭐', '🔥', '💪', '🚀'][G.i % 5] : '😬';
  $('fbMsg').textContent = ok ? ['Correct!', 'Awesome!', 'Nailed it!', 'Great job!', 'Yes!'][G.i % 5] : 'Not quite… +10 s';
  $('fbMsg').style.color = ok ? 'var(--good)' : 'var(--bad)';
  $('fbDet').innerHTML = ok ? '' : `${p.a} × ${p.b} = <b>${p.answer.toLocaleString('en-US')}</b><br><span class="muted" style="font-size:16px">you typed ${val.toLocaleString('en-US')}</span>`;
  $('fb').classList.remove('hidden');
  if (!isTouch) $('answer').blur();
  setTimeout(() => {
    $('fb').classList.add('hidden');
    G.i++;
    if (G.i < NUM_PROBLEMS) nextProblem(); else finish();
  }, ok ? 650 : 2000);
}
$('answer').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); } });
$('answer').addEventListener('input', () => { $('answer').value = $('answer').value.replace(/\D/g, '').slice(0, 7); });
$('pad').addEventListener('click', (e) => {
  const k = e.target.closest('button')?.dataset.k; if (!k || busy) return;
  const a = $('answer');
  if (k === 'ok') return submitAnswer();
  if (k === 'del') a.value = a.value.slice(0, -1);
  else if (a.value.length < 7) a.value += k;
});

function confetti() {
  const em = ['🎉', '⭐', '✨', '🎊', '🟣', '🟡'];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('div'); s.className = 'confetti'; s.textContent = em[i % em.length];
    s.style.left = Math.random() * 100 + 'vw'; s.style.animationDelay = Math.random() * 0.8 + 's';
    document.body.appendChild(s); setTimeout(() => s.remove(), 3600);
  }
}

async function finish() {
  clearInterval(timerHandle);
  const timeMs = Math.round(G.accum);
  const correct = G.answers.filter((v, k) => v === G.probs[k].answer).length;
  const total = timeMs + (NUM_PROBLEMS - correct) * PENALTY_MS;
  $('resTitle').textContent = correct === 10 ? '🏆 Perfect 10!' : correct >= 7 ? '🎉 Great race!' : '💪 Nice effort!';
  $('sCorrect').textContent = `${correct}/10`;
  $('sTotal').textContent = fmtTime(total);
  $('sRaw').textContent = fmtTime(timeMs);
  $('sPen').textContent = '+' + ((NUM_PROBLEMS - correct) * PENALTY_MS / 1000) + 's';
  $('saveErr').textContent = '';
  $('ansList').innerHTML = G.probs.map((p, k) => {
    const ok = G.answers[k] === p.answer;
    return `<li>${p.a} × ${p.b} = <b>${p.answer.toLocaleString('en-US')}</b> — <span class="${ok ? 'good' : 'badc'}">${ok ? '✓' : '✗ you said ' + G.answers[k].toLocaleString('en-US')}</span></li>`;
  }).join('');
  $('reveal').classList.add('hidden'); $('revealBtn').textContent = '👀 Show answers';
  show('results');
  if (correct >= 7) confetti();

  const entry = { id: deviceId + '-' + G.nk, key: deviceId + '-' + G.nk, name: G.name, answers: G.answers.slice(), timeMs, ts: Date.now(), v: 1 };
  if (G.practice) {
    $('rankLine').textContent = '🧪 Practice run — not added to the board';
    return;
  }
  if (!scoreEntry(entry, ROUND)) {
    $('rankLine').textContent = 'Wow, that was super fast! (Not posted — under 20 s looks like a glitch.)';
    return;
  }
  $('rankLine').textContent = 'Saving your score…';
  // device-level guardrails: max 3 different names per device per round
  const namesKey = `mr:names:${ROUND}`;
  const names = JSON.parse(ls.get(namesKey) || '[]');
  if (!names.includes(G.nk) && names.length >= 3) { $('rankLine').textContent = 'This device already posted 3 players today 🙂'; return; }
  try {
    const store = await getStore();
    entry.ticket = await G.ticket;
    const res = await store.submit(ROUND, entry);
    ls.set(`mr:played:${ROUND}:${G.nk}`, '1');
    if (!names.includes(G.nk)) { names.push(G.nk); ls.set(namesKey, JSON.stringify(names)); }
    const rows = res.rows || [];
    const r = rows.findIndex((x) => x.id === entry.id);
    $('rankLine').innerHTML = res.duplicate ? 'Your first score today is already on the board.'
      : r >= 0 ? `You're <b>#${r + 1}</b> of ${rows.length} ${r === 0 ? '🥇' : r === 1 ? '🥈' : r === 2 ? '🥉' : ''}` : 'Score saved!';
  } catch (err) {
    $('rankLine').textContent = 'Score not saved 😕';
    $('saveErr').innerHTML = esc(err.message || 'Network problem') + ' <button class="btn small" id="retrySave">Try again</button>';
    $('retrySave').onclick = () => { G.practice = false; finish(); };
  }
}

$('revealBtn').onclick = () => { const h = $('reveal').classList.toggle('hidden'); $('revealBtn').textContent = h ? '👀 Show answers' : '🙈 Hide answers'; };
$('againBtn').onclick = () => startGame(G ? G.name : cleanName($('name').value));
$('homeBtn').onclick = () => show('home');

// ---------- leaderboard ----------
let tab = 'today', boardTimer = null;
async function renderBoard() {
  $('boardSub').textContent = tab === 'today' ? prettyRound(ROUND) : 'Best daily score per player';
  $('tabToday').classList.toggle('on', tab === 'today'); $('tabAll').classList.toggle('on', tab === 'all');
  try {
    const store = await getStore();
    const rows = tab === 'today' ? await store.leaderboard(ROUND) : await store.allTime();
    if (!rows.length) { $('boardBody').innerHTML = '<p>No scores yet — be the first! 🚀</p>'; return; }
    const medal = (k) => ['🥇', '🥈', '🥉'][k] || k + 1;
    $('boardBody').innerHTML = `<table><tr><th>#</th><th>Name</th><th>✓</th><th>Time</th>${tab === 'all' ? '<th>Day</th>' : ''}</tr>` +
      rows.slice(0, 100).map((x, k) => `<tr class="${x.id.startsWith(deviceId + '-') ? 'me' : ''}"><td class="r">${medal(k)}</td><td>${esc(x.name)}</td><td>${x.correct}/10</td><td>${fmtTime(x.totalMs)}</td>${tab === 'all' ? `<td style="font-size:13px">${esc(x.roundId.slice(5))}</td>` : ''}</tr>`).join('') + '</table>' +
      '<p class="muted" style="font-size:13px">Time includes +10 s for each wrong answer.</p>';
  } catch (e) { $('boardBody').innerHTML = '<p class="err">Could not load the leaderboard. Check your internet and tap Refresh.</p>'; }
}
function openBoard() { show('board'); $('boardBody').innerHTML = 'Loading…'; renderBoard(); clearInterval(boardTimer); boardTimer = setInterval(() => { if (!$('board').classList.contains('hidden')) renderBoard(); else clearInterval(boardTimer); }, 20000); }
$('lbBtn').onclick = openBoard; $('resLbBtn').onclick = () => { tab = 'today'; openBoard(); };
$('tabToday').onclick = () => { tab = 'today'; renderBoard(); };
$('tabAll').onclick = () => { tab = 'all'; renderBoard(); };
if (custom) $('tabAll').classList.add('hidden');
$('refreshBtn').onclick = renderBoard; $('boardHome').onclick = () => show('home');
if (params.get('view') === 'board') openBoard();
