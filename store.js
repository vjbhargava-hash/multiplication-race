// Leaderboard storage. Two backends with the same interface:
//  - "mantle": MantleDB anonymous JSON store (no account needed). Every client re-validates
//    every entry against the seeded problems when displaying, so scores can't be inflated
//    by sending a fake "correct" count.
import { rankRound, scoreEntry, compareScores, isDailyRound } from './core.js';

export const MANTLE_NS = 'zivamath-97c9a11683';
const M = 'https://mantledb.sh/v2';

async function j(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = null; }
  return { ok: r.ok, status: r.status, data: d };
}

const mantle = {
  name: 'mantle',
  async startRun() { return null; },
  async getRoundMap(roundId) {
    const r = await j(`${M}/${MANTLE_NS}/r/${roundId}`);
    if (r.status === 404) return {};
    if (!r.ok) throw new Error('Leaderboard unavailable (' + r.status + ')');
    return r.data || {};
  },
  async leaderboard(roundId) { return rankRound(await this.getRoundMap(roundId), roundId); },
  async allTime() {
    const r = await j(`${M}/${MANTLE_NS}/best`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error('Leaderboard unavailable (' + r.status + ')');
    const rows = [];
    for (const [k, e] of Object.entries(r.data || {})) {
      if (!e || !isDailyRound(e.roundId) || e.key !== k) continue;
      const s = scoreEntry(e, e.roundId);
      if (s) rows.push(s);
    }
    return rows.sort(compareScores);
  },
  async patchOrCreate(path, obj) {
    let created = false;
    let r = await j(`${M}/${MANTLE_NS}/${path}`, { method: 'PATCH', body: JSON.stringify(obj) });
    if (r.status === 404) {
      created = true;
      r = await j(`${M}/${MANTLE_NS}/${path}`, { method: 'POST', body: JSON.stringify({}) });
      r = await j(`${M}/${MANTLE_NS}/${path}`, { method: 'PATCH', body: JSON.stringify(obj) });
    }
    if (!r.ok) throw new Error('Could not save score (' + r.status + ')');
    return created;
  },
  // entry: {id, key, name, answers[10], timeMs, ts, roundId}
  async submit(roundId, entry) {
    const map = await this.getRoundMap(roundId);
    if (map[entry.id]) return { duplicate: true, rows: rankRound(map, roundId) };
    if (!scoreEntry(entry, roundId)) throw new Error('Score did not pass checks');
    const created = await this.patchOrCreate(`r/${roundId}`, { [entry.id]: entry });
    if (created) { // two "first players" at the same instant could race on creation; re-check shortly
      setTimeout(async () => {
        try { const m = await this.getRoundMap(roundId); if (!m[entry.id]) await this.patchOrCreate(`r/${roundId}`, { [entry.id]: entry }); } catch {}
      }, 3000);
    }
    if (isDailyRound(roundId)) {
      try {
        const b = await j(`${M}/${MANTLE_NS}/best`);
        const prev = b.ok && b.data ? b.data[entry.key] : null;
        const ps = prev && scoreEntry(prev, prev.roundId);
        const ns = scoreEntry(entry, roundId);
        if (!ps || compareScores(ns, ps) < 0) await this.patchOrCreate('best', { [entry.key]: { ...entry, roundId } });
      } catch (e) { /* all-time is best-effort */ }
    }
    this.housekeep().catch(() => {});
    let rows = await this.leaderboard(roundId);
    if (!rows.some((x) => x.id === entry.id)) { // read-after-write safety retry
      await this.patchOrCreate(`r/${roundId}`, { [entry.id]: entry });
      rows = await this.leaderboard(roundId);
    }
    return { duplicate: false, rows };
  },
  // Free tier allows 100 entries per namespace: keep only the newest 60 rounds.
  async housekeep() {
    if (Math.random() > 0.2) return;
    const r = await j(`${M}/list/${MANTLE_NS}`);
    const paths = ((r.data && r.data.entries) || []).map((e) => e.path).filter((p) => p.startsWith('r/'));
    if (paths.length <= 60) return;
    paths.sort((a, b) => a.localeCompare(b));
    const daily = paths.filter((p) => /^r\/\d{4}/.test(p));
    const custom = paths.filter((p) => !/^r\/\d{4}/.test(p));
    const victims = [...custom, ...daily].slice(0, paths.length - 60);
    for (const p of victims) await j(`${M}/${MANTLE_NS}/${p}`, { method: 'DELETE' });
  },
};

export async function getStore() { return mantle; } // static build: public leaderboard store only
