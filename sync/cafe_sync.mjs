// 다음카페 → 사이트 DB 비교(카페가 원본).
// 기본은 미리 보기(DB에 쓰지 않고 보고만). WRITE=1 이면 운영진 계정으로 로그인해 바뀐 것만 반영한다.
// 반영 규칙: 카페가 원본. 바뀐 경기·일정만 고치고 새 것은 추가. DB에만 있는 경기는 지우지 않음. 확인 필요 줄은 반영 안 함.
// 실행: node sync/cafe_sync.mjs   (Node 18 이상, 외부 패키지 없음)
// 환경변수: CAFE_MATCHES_URL = 시즌 기록 글(예: "2026 Matches"), CAFE_SCHED_URL = 다음경기 메모 게시판
import { readFileSync, appendFileSync } from 'node:fs';

const MATCHES_URL = process.env.CAFE_MATCHES_URL || 'https://m.cafe.daum.net/iandd/MmV9/1';
const SCHED_URL = process.env.CAFE_SCHED_URL || 'https://m.cafe.daum.net/iandd/_memo';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

// Supabase 주소·공개 키는 사이트가 쓰는 값(script.js)을 그대로 읽는다
const siteJs = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const SB_URL = siteJs.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
const SB_KEY = siteJs.match(/sb_publishable_[A-Za-z0-9_-]+/)[0];

const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const toText = h => decode(h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/ /g, ' ');
const norm = s => (s || '').replace(/\s+/g, '').toLowerCase();
const given = n => (n.length === 3 ? n.slice(1) : n);

async function getPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`카페 글을 읽지 못함 (HTTP ${res.status}) ${url} — 게시판이 회원 전용이면 403`);
  return body;
}
async function db(path) {
  const rows = [], sep = path.includes('?') ? '&' : '?';
  for (let off = 0; ; off += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}${sep}limit=1000&offset=${off}`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
    if (!res.ok) throw new Error(`DB 조회 실패 ${res.status} ${path}`);
    const b = await res.json(); rows.push(...b);
    if (b.length < 1000) return rows;
  }
}

// ── 시즌 기록 글 읽기 ──
// 머리 줄: "36. vrs 엘미하FC 1:7 X ('26.10.04 노량진축구장)"  (승부차기 "3:0(5:6)", 한 자리 날짜 "'26.02.8"도 허용)
const HEAD = /^(\d+)\.\s*vrs\s+(.+?)\s+(\d+)\s*:\s*(\d+)\s*(?:\(\s*\d+\s*:\s*\d+\s*\))?\s*([OX△-]?)\s*\(\s*'(\d\d)\.(\d\d?)\.(\d\d?)\s+(.+?)\)\s*$/;
export function parseMatches(html) {
  const a = html.indexOf('id="article"'), b = html.indexOf('class="article_more"', a);
  if (a < 0) throw new Error('글 본문(id="article")을 찾지 못함 — 카페 화면 구조가 바뀌었을 수 있음');
  const text = toText(html.slice(a, b > a ? b : undefined));
  const games = [], stray = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('ⓒ')) break;
    const m = HEAD.exec(l);
    if (m) {
      const [, no, opp, our, their, res, yy, mm, dd, venue] = m;
      cur = { no: +no, opp: opp.trim(), our: +our, their: +their, res, date: `20${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`, venue: venue.trim(),
        shootout: /\(\s*\d+\s*:\s*\d+\s*\)/.test(l.split("('")[0]), goals: [], line: null, mvp: [], merc: 0 };
      games.push(cur); continue;
    }
    if (!cur) continue;
    if (cur.line === null && (l.startsWith('☞') || l.startsWith('*') || l.includes(','))) {
      let body = l.replace(/^☞/, '');
      const mc = body.match(/\+\s*용\s*병\s*(\d+)/);
      cur.merc = mc ? +mc[1] : 0;
      body = body.replace(/\+\s*용\s*병\s*\d+/, '');
      const names = body.split(/[,.，、]/).map(x => x.trim()).filter(Boolean);
      cur.mvp = [...new Set(names.filter(x => x.startsWith('*')).map(x => x.slice(1).trim()))];
      cur.line = [...new Set(names.map(x => x.replace(/^\*/, '').trim()))];
      cur.dupLine = names.length !== cur.line.length;
      continue;
    }
    if (cur.line === null) {
      const g = /^(\D+?)\s*(\d+)?$/.exec(l.replace(/\(.*?\)/g, '').trim());
      if (g) { cur.goals.push([g[1].replace(/\s+/g, ''), +(g[2] || 1)]); continue; }
    }
    stray.push(`${cur.no}번 아래 읽지 못한 줄: "${l}"`);
  }
  return { games, stray };
}

// ── 다음경기 메모 읽기: "[2026.10.04 12:00] 엘미하FC 노량진축구장" ──
export function parseSchedules(html) {
  const out = [];
  for (const raw of toText(html).split('\n')) {
    const m = /^\[(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})\]\s*(.+)$/.exec(raw.trim());
    if (m) out.push({ date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, time: `${m[4].padStart(2, '0')}:${m[5]}`, rest: m[6].trim() });
  }
  return out;
}

// ── 쓰기(WRITE=1): 운영진 계정으로 로그인해서 바뀐 것만 반영 ──
const WRITE = process.env.WRITE === '1';
let TOKEN = null;
async function login() {
  const email = process.env.WHISTLE_ADMIN_EMAIL, pin = process.env.WHISTLE_ADMIN_PIN;
  if (!email || !pin) throw new Error('쓰기 모드인데 WHISTLE_ADMIN_EMAIL / WHISTLE_ADMIN_PIN 비밀값이 없음');
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pin }) });
  if (!res.ok) throw new Error(`운영진 로그인 실패 (HTTP ${res.status}) — 비밀값의 이메일·PIN 확인`);
  TOKEN = (await res.json()).access_token;
}
async function w(method, path, body, one) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const r = await res.json();
  if (one && (!Array.isArray(r) || r.length !== 1)) throw new Error(`${method} ${path.split('?')[0]}: 바뀐 행이 ${Array.isArray(r) ? r.length : '?'}건(1건이어야 함)`);
  return r;
}

async function main() {
  const report = [];
  const say = s => { report.push(s); };
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // 한국 날짜
  say(`# 카페 → 사이트 ${WRITE ? '반영' : '비교 (미리 보기, DB에 쓰지 않음)'}\n\n- 실행: ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} (KST)\n- 기록 글: ${MATCHES_URL}\n- 일정 게시판: ${SCHED_URL}\n`);

  const [mHtml, sHtml] = await Promise.all([getPage(MATCHES_URL), getPage(SCHED_URL)]);
  const { games, stray } = parseMatches(mHtml);
  if (!games.length) throw new Error('기록 글에서 경기를 하나도 읽지 못함');
  const seasons = [...new Set(games.map(g => +g.date.slice(0, 4)))];

  const [players, matches, venues] = await Promise.all([
    db('players?select=id,name,active&order=id.asc'),
    db(`matches?season=in.(${seasons.join(',')})&select=id,date,match_no,opponent,venue,our_score,opp_score&order=date.asc`),
    db('venue_regions?select=venue')
  ]);
  // 안전장치: 카페에서 읽은 경기 수가 DB보다 크게 적으면 글 구조가 바뀐 것으로 보고 쓰지 않음
  if (WRITE && games.length < matches.length * 0.8) throw new Error(`카페에서 ${games.length}경기만 읽힘(DB ${matches.length}경기) — 글 구조 변경 의심, 반영 중단`);
  const ids = matches.map(m => m.id).join(',') || '0';
  const [lus, gls, mvs, recentLu] = await Promise.all([
    db(`match_lineups?match_id=in.(${ids})&select=match_id,player_id,is_mercenary&order=id.asc`),
    db(`match_goals?match_id=in.(${ids})&select=match_id,player_id,is_mercenary,goal_type&order=id.asc`),
    db(`match_mvps?match_id=in.(${ids})&select=match_id,player_id,raw_name&order=id.asc`),
    db(`match_lineups?select=player_id,matches!inner(date)&matches.date=gte.${+today.slice(0, 4) - 2}${today.slice(4)}&player_id=not.is.null&order=id.asc`)
  ]);
  const pName = Object.fromEntries(players.map(p => [p.id, p.name]));
  const recent = new Set(recentLu.map(l => l.player_id));

  // 출전 명단(성 없는 이름) → 선수: 최근 2년 출전 선수 중 하나면 확정, 없으면 전체에서 하나일 때만
  const byGiven = (pool, g) => pool.filter(p => given(p.name) === g || p.name === g);
  const resolveGiven = g => {
    let hit = byGiven(players.filter(p => recent.has(p.id)), g);
    if (hit.length === 1) return { id: hit[0].id };
    if (hit.length > 1) return { err: `"${g}" 동명이인(${hit.map(p => p.name).join('/')})` };
    hit = byGiven(players, g);
    if (hit.length === 1) return { id: hit[0].id };
    return { err: hit.length ? `"${g}" 동명이인(${hit.map(p => p.name).join('/')})` : `"${g}" 선수 명단에 없음` };
  };
  // 득점자(성까지 쓰는 칸) → 선수: 전체 이름이 정확히 하나일 때. 이름만 썼으면 전체 선수 중 하나일 때만(여럿이면 확인 필요)
  const resolveFull = n => {
    const hit = players.filter(p => p.name === n);
    if (hit.length === 1) return { id: hit[0].id };
    if (hit.length > 1) return { err: `득점자 "${n}" 동명이인` };
    const g = byGiven(players, given(n));
    if (g.length === 1) return { id: g[0].id };
    return { err: g.length ? `득점자 "${n}" 동명이인(${g.map(p => p.name).join('/')}) — 성까지 적어 주세요` : `득점자 "${n}" 선수 명단에 없음` };
  };
  const gName = k => k === 'og' ? '자살골' : k === 'merc' ? '용병' : pName[k];
  const gStr = o => Object.entries(o).map(([k, n]) => gName(k) + (n > 1 ? ' ' + n : '')).sort().join(', ') || '없음';

  const rows = { same: [], change: [], create: [], review: [] };
  const notes = [], plans = [];
  for (const g of games) {
    const problems = [];
    if (g.line === null) problems.push('출전 명단 줄(☞ …)이 없음');
    const sum = g.goals.reduce((a, [, n]) => a + n, 0);
    if (sum !== g.our) problems.push(`득점자 합계 ${sum}골 ≠ 우리 점수 ${g.our}${g.shootout ? ' (승부차기 기록 있음)' : ''}`);
    const lineIds = [], mvpIds = [];
    for (const n of g.line || []) { const r = resolveGiven(n); if (r.id) lineIds.push(r.id); else problems.push(r.err); }
    for (const n of g.mvp) { const r = resolveGiven(n); if (r.id) mvpIds.push(r.id); else problems.push('MVP ' + r.err); }
    const cG = {};
    for (const [n, k] of g.goals) {
      let key;
      if (n === '용병') key = 'merc';
      else if (n === '자살골' || n === '자책골') key = 'og';
      else { const r = resolveFull(n); if (r.id) key = r.id; else { problems.push(r.err); continue; } }
      cG[key] = (cG[key] || 0) + k;
    }
    const label = `${g.no}. ${g.date} vs ${g.opp} ${g.our}:${g.their}`;
    if (g.dupLine) notes.push(`${label} — 출전 명단에 같은 이름이 두 번 있어 한 번으로 셈`);
    if (problems.length) { rows.review.push(`${label} — ${problems.join(' · ')}`); continue; }
    const want = { lineIds, mvpIds, cG };

    const sameDay = matches.filter(m => m.date === g.date);
    const m = sameDay.length > 1 ? (sameDay.find(x => x.match_no === g.no) || sameDay.find(x => norm(x.opponent) === norm(g.opp))) : sameDay[0];
    if (!m) {
      rows.create.push(`${label} (${g.venue}) — 출전 ${lineIds.length}명 + 용병 ${g.merc} · 득점 [${gStr(cG)}] · MVP ${mvpIds.map(i => pName[i]).join('·') || '없음'}`);
      plans.push({ kind: 'create', g, want, label }); continue;
    }

    const diff = [], fields = {};
    if (m.match_no !== g.no) { diff.push(`번호 ${m.match_no ?? '비어 있음'} → ${g.no}`); fields.match_no = g.no; }
    if (norm(m.opponent) !== norm(g.opp)) { diff.push(`상대 "${m.opponent}" → "${g.opp}"`); fields.opponent = g.opp; }
    const dbVenue = (m.venue || '').includes(' | ') ? m.venue.split(' | ').slice(1).join(' | ') : (m.venue || '');
    if (norm(dbVenue) !== norm(g.venue)) { diff.push(`장소 "${dbVenue}" → "${g.venue}"`); fields.venue = g.venue; }
    if (m.our_score !== g.our || m.opp_score !== g.their) { diff.push(`스코어 ${m.our_score}:${m.opp_score} → ${g.our}:${g.their}`); fields.our_score = g.our; fields.opp_score = g.their; }
    const lu = lus.filter(l => l.match_id === m.id);
    const dbLine = new Set(lu.filter(l => l.player_id).map(l => l.player_id));
    const add = lineIds.filter(i => !dbLine.has(i)), del = [...dbLine].filter(i => !lineIds.includes(i));
    const dbMerc = lu.filter(l => l.is_mercenary).length;
    const lineupChanged = add.length || del.length || dbMerc !== g.merc;
    if (add.length || del.length) diff.push(`출전 ${add.length ? '+' + add.map(i => pName[i]).join(',') : ''}${del.length ? ' -' + del.map(i => pName[i]).join(',') : ''}`);
    if (dbMerc !== g.merc) diff.push(`용병 ${dbMerc} → ${g.merc}`);
    const key = x => x.goal_type === 'own_goal' ? 'og' : x.player_id || 'merc';
    const dbG = {}; gls.filter(x => x.match_id === m.id).forEach(x => { dbG[key(x)] = (dbG[key(x)] || 0) + 1; });
    const goalsChanged = gStr(dbG) !== gStr(cG);
    if (goalsChanged) diff.push(`득점 [${gStr(dbG)}] → [${gStr(cG)}]`);
    const dbM = mvs.filter(x => x.match_id === m.id).map(x => x.player_id ? pName[x.player_id] : x.raw_name).sort().join('·');
    const cM = mvpIds.map(i => pName[i]).sort().join('·');
    const mvpChanged = dbM !== cM;
    if (mvpChanged) diff.push(`MVP ${dbM || '없음'} → ${cM || '없음'}`);
    if (diff.length) { rows.change.push(`${label} — ${diff.join(' · ')}`); plans.push({ kind: 'change', g, want, label, id: m.id, fields, lineupChanged, goalsChanged, mvpChanged }); }
    else rows.same.push(label);
  }

  // 일정
  const sched = parseSchedules(sHtml).filter(s => s.date >= today);
  const dbSched = await db(`schedules?date=gte.${today}&select=id,date,time,opponent,venue,address&order=date.asc`);
  // 주소: 카페 메모엔 주소가 없으므로, 예전에 같은 구장으로 등록한 일정의 주소(가장 최근 것)를 가져다 씀
  const pastAddr = {};
  (await db('schedules?select=venue,address,date&address=not.is.null&order=date.asc')).forEach(x => { if ((x.address || '').trim()) pastAddr[norm(x.venue)] = x.address.trim(); });
  const addrOf = venue => pastAddr[norm(venue)] || null;
  const known = [...new Set([...venues.map(v => v.venue), ...matches.map(m => (m.venue || '').split(' | ').pop())])].filter(Boolean).sort((a, b) => b.length - a.length);
  const splitRest = rest => {
    const v = known.find(v => rest.endsWith(v) && rest.length > v.length);
    if (v) return { opp: rest.slice(0, -v.length).trim(), venue: v };
    const parts = rest.split(/\s+/);
    if (parts.length === 2) return { opp: parts[0], venue: parts[1], guess: true };
    return null;
  };
  const sRows = [], sPlans = [];
  for (const s of sched) {
    const sp = splitRest(s.rest);
    const d = dbSched.find(x => x.date === s.date);
    const label = `${s.date} ${s.time} ${s.rest}`;
    if (!sp) { sRows.push(`확인 필요 · ${label} — 상대와 구장을 나누지 못함(반영 안 함)`); continue; }
    if (!d) {
      const address = addrOf(sp.venue);
      sRows.push(`새로 등록 · ${label} → 상대 "${sp.opp}", 구장 "${sp.venue}"${sp.guess ? ' (띄어쓰기로 추정)' : ''} · 주소 ${address ? '"' + address + '"(예전 일정에서)' : '없음(관리자에서 입력)'}`);
      sPlans.push({ s, sp, label, address }); continue;
    }
    const diff = [], fields = {};
    if ((d.time || '').slice(0, 5) !== s.time) { diff.push(`시간 ${(d.time || '없음').slice(0, 5)} → ${s.time}`); fields.time = s.time; }
    if (norm(d.opponent) !== norm(sp.opp)) { diff.push(`상대 "${d.opponent}" → "${sp.opp}"`); fields.opponent = sp.opp; }
    if (norm(d.venue) !== norm(sp.venue)) {
      // 구장이 바뀌면 원래 주소는 맞지 않으므로 예전 일정의 주소로 바꾸고, 없으면 비움
      diff.push(`구장 "${d.venue}" → "${sp.venue}"`); fields.venue = sp.venue; fields.address = addrOf(sp.venue);
      diff.push(`주소 → ${fields.address ? '"' + fields.address + '"' : '비움'}`);
    } else if (!(d.address || '').trim() && addrOf(sp.venue)) {
      // 주소가 비어 있는 일정은 예전 주소로 채움(관리자에서 넣은 주소는 건드리지 않음)
      fields.address = addrOf(sp.venue); diff.push(`주소 채움 "${fields.address}"`);
    }
    if (diff.length) { sRows.push(`수정 · ${label} — ${diff.join(' · ')}`); sPlans.push({ s, sp, label, id: d.id, fields }); }
    else sRows.push(`같음 · ${label}`);
  }

  // 반영
  const done = [], failed = [];
  if (WRITE && (plans.length || sPlans.length)) {
    await login();
    const children = async (id, p) => {
      const { lineIds, mvpIds, cG } = p.want;
      if (p.kind === 'create' || p.lineupChanged) {
        if (p.kind === 'change') await w('DELETE', `match_lineups?match_id=eq.${id}`);
        const lu = [...lineIds.map(pid => ({ match_id: id, player_id: pid, is_mercenary: false })), ...Array.from({ length: p.g.merc }, () => ({ match_id: id, player_id: null, is_mercenary: true }))];
        if (lu.length) await w('POST', 'match_lineups', lu);
      }
      if (p.kind === 'create' || p.goalsChanged) {
        if (p.kind === 'change') await w('DELETE', `match_goals?match_id=eq.${id}`);
        const rows = [];
        Object.entries(cG).forEach(([k, n]) => { for (let i = 0; i < n; i++) rows.push(k === 'og' ? { match_id: id, player_id: null, is_mercenary: false, goal_type: 'own_goal' } : k === 'merc' ? { match_id: id, player_id: null, is_mercenary: true, goal_type: 'normal' } : { match_id: id, player_id: +k, is_mercenary: false, goal_type: 'normal' }); });
        if (rows.length) await w('POST', 'match_goals', rows);
      }
      if (p.kind === 'create' || p.mvpChanged) {
        if (p.kind === 'change') await w('DELETE', `match_mvps?match_id=eq.${id}`);
        if (mvpIds.length) await w('POST', 'match_mvps', mvpIds.map(pid => ({ match_id: id, player_id: pid, raw_name: pName[pid] })));
      }
    };
    for (const p of plans) {
      try {
        if (p.kind === 'create') {
          const r = await w('POST', 'matches', { season: +p.g.date.slice(0, 4), date: p.g.date, match_no: p.g.no, opponent: p.g.opp, venue: p.g.venue, our_score: p.g.our, opp_score: p.g.their }, true);
          await children(r[0].id, p);
        } else {
          if (Object.keys(p.fields).length) await w('PATCH', `matches?id=eq.${p.id}`, p.fields, true);
          await children(p.id, p);
        }
        done.push(p.label);
      } catch (e) { failed.push(`${p.label} — ${e.message}`); }
    }
    for (const p of sPlans) {
      try {
        if (p.id) await w('PATCH', `schedules?id=eq.${p.id}`, p.fields, true);
        else await w('POST', 'schedules', { season: +p.s.date.slice(0, 4), date: p.s.date, time: p.s.time, opponent: p.sp.opp, venue: p.sp.venue, address: p.address }, true);
        done.push('일정 ' + p.label);
      } catch (e) { failed.push(`일정 ${p.label} — ${e.message}`); }
    }
  }

  const verb = WRITE ? '' : ' 예정';
  say(`## 경기 기록 (카페 ${games.length}경기, 시즌 ${seasons.join(',')}, DB ${matches.length}경기)\n`);
  say(`- 같음: ${rows.same.length}경기\n- 바뀜${verb}: ${rows.change.length}경기\n- 새로 추가${verb}: ${rows.create.length}경기\n- 확인 필요(반영 안 함): ${rows.review.length}경기\n`);
  if (rows.change.length) say(`### 바뀜${verb}\n` + rows.change.map(x => '- ' + x).join('\n') + '\n');
  if (rows.create.length) say(`### 새로 추가${verb}\n` + rows.create.map(x => '- ' + x).join('\n') + '\n');
  if (rows.review.length) say('### 확인 필요\n' + rows.review.map(x => '- ' + x).join('\n') + '\n');
  if (notes.length) say('### 참고\n' + notes.map(x => '- ' + x).join('\n') + '\n');
  if (stray.length) say('### 읽지 못한 줄\n' + stray.map(x => '- ' + x).join('\n') + '\n');
  const dbOnly = matches.filter(m => !games.some(g => g.date === m.date));
  if (dbOnly.length) say('### DB에만 있는 경기(지우지 않음)\n' + dbOnly.map(m => `- ${m.date} vs ${m.opponent}`).join('\n') + '\n');
  say(`## 다가오는 일정 (카페 ${sched.length}건)\n` + (sRows.length ? sRows.map(x => '- ' + x).join('\n') : '- 오늘 이후 일정 글 없음') + '\n');
  if (WRITE) {
    say(`## 반영 결과\n- 성공 ${done.length}건 / 실패 ${failed.length}건\n`);
    if (failed.length) say('### 실패\n' + failed.map(x => '- ' + x).join('\n') + '\n');
  }

  const md = report.join('\n');
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  if (failed.length) process.exitCode = 1;   // 실패가 있으면 작업을 실패로 표시(GitHub가 메일로 알림)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cafe_sync.mjs')) {
  main().catch(e => {
    console.error('실패: ' + e.message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# 카페 비교 실패\n\n${e.message}\n`);
    process.exit(1);
  });
}
