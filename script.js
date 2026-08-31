// WHISTLE FC STAT — script.js
// Claude Design "Whistle STAT.dc.html"의 로직(WhistleApp)을 그대로 옮기고,
// 디자인 컴포넌트 템플릿({{ }} / <sc-for> / <sc-if> / on*)을 해석하는 소형 렌더러를 붙였다.
// 상태가 바뀌면 renderVals() → 템플릿 전체를 다시 그린다(#app).

// ── 템플릿 렌더러 ──
const SVG_NS = 'http://www.w3.org/2000/svg';
const HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;
const WHOLE = /^\s*\{\{\s*([\w$.]+)\s*\}\}\s*$/;

function lookup(scope, path) {
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (path === 'null') return null;
  let cur = scope;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function interpolate(str, scope) {
  return str.replace(HOLE, (_, path) => {
    const v = lookup(scope, path);
    return v == null ? '' : String(v);
  });
}

function pathOf(attr) {
  return (attr || '').replace(/[{}\s]/g, '');
}

function renderNodes(parent, nodes, scope) {
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.nodeValue.includes('{{') ? interpolate(node.nodeValue, scope) : node.nodeValue));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      const list = lookup(scope, pathOf(node.getAttribute('list'))) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, index) => {
        const inner = Object.create(scope);
        inner[as] = item;
        inner.$index = index;
        renderNodes(parent, node.childNodes, inner);
      });
      continue;
    }
    if (tag === 'sc-if') {
      if (lookup(scope, pathOf(node.getAttribute('value')))) renderNodes(parent, node.childNodes, scope);
      continue;
    }

    const inSvg = tag === 'svg' || parent.namespaceURI === SVG_NS;
    const el = inSvg ? document.createElementNS(SVG_NS, node.tagName) : document.createElement(tag);
    let pendingValue;
    for (const { name, value } of Array.from(node.attributes)) {
      if (name.startsWith('hint-')) continue;
      const whole = WHOLE.exec(value);
      if (name.startsWith('on') && whole) {
        const fn = lookup(scope, whole[1]);
        if (typeof fn === 'function') el.addEventListener(name.slice(2), fn);
        continue;
      }
      if (name === 'value' && whole) { pendingValue = lookup(scope, whole[1]); continue; }
      el.setAttribute(name, value.includes('{{') ? interpolate(value, scope) : value);
    }
    renderNodes(el, node.childNodes, scope);
    if (pendingValue !== undefined) el.value = pendingValue;
    parent.appendChild(el);
  }
}

const KAKAO_MAP_API_KEY = '47eed652b004605d8a8e3e39df268f24'; // JS 키(도메인 제한: fcwhistle.vercel.app · github.io 등록)
const DEFAULT_LAT = 37.656, DEFAULT_LNG = 127.065; // 성불빌라 부근(지오코딩 실패 시)
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 앱 로직 (디자인 원본 그대로) ──
class WhistleApp {
  props = { koreanTabs: false, recentCount: 3 };

  state = { tab: 'home', season: '2026', matchSort: 'desc', playerFilter: 'all', regionalSort: 'winrate', teamSort: 'season', openMatch: null };

  async supa(path) {
    const URL = 'https://sgzanwxgdcyojcoskseo.supabase.co';
    const KEY = 'sb_publishable_tHW4O3rv3B0hk1p-v4s7gg_MLc2BeN4';
    const res = await fetch(URL + '/rest/v1/' + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    if (!res.ok) throw new Error('Supabase ' + res.status);
    return res.json();
  }

  async supaAll(path, pageSize = 1000) {
    const rows = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let offset = 0; ; offset += pageSize) {
      const batch = await this.supa(`${path}${sep}limit=${pageSize}&offset=${offset}`);
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }

  db(year) {
    this._db = this._db || {};
    if (this._db[year]) return this._db[year];
    this._db[year] = { matches: [], players: [], total: 0, loading: true };
    this.loadSeason(year);
    return this._db[year];
  }

  async loadSeason(y) {
    try {
      const s2026 = y >= 2026;
      const [matchesRaw, playersRaw] = await Promise.all([
        this.supa(`matches_with_result?season=eq.${y}&order=date.desc`),
        s2026
          ? this.supa(`season_player_stats?season=eq.${y}&select=name,appearances,goals,mvp&order=goals.desc`)
          : this.supa(`legacy_stats?season=eq.${y}&select=appearances,goals,mvp,players(name)&order=goals.desc`)
      ]);
      const ids = matchesRaw.map(m => m.id).join(',') || '0';
      let mvpRaw = [];
      try { mvpRaw = await this.supa(`match_mvps?select=raw_name,match_id&match_id=in.(${ids})`); } catch (e) {}
      const mvpMap = {};
      mvpRaw.forEach(r => { (mvpMap[r.match_id] = mvpMap[r.match_id] || []).push(r.raw_name); });
      const matches = matchesRaw.map(m => ({
        id: m.id, date: m.date, opponent: m.opponent,
        gf: m.our_score, ga: m.opp_score, score: m.our_score + ':' + m.opp_score,
        result: m.result === 'W' ? 'win' : m.result === 'D' ? 'draw' : 'loss',
        mvp: (mvpMap[m.id] || []).join(', ') || '-'
      }));
      const players = playersRaw.map(r => ({
        name: s2026 ? r.name : (r.players && r.players.name),
        ap: r.appearances || 0, goals: r.goals || 0, mvp: r.mvp || 0
      })).filter(p => p.name);
      this._db[y] = { matches, players, total: matches.length, loading: false };
    } catch (e) {
      this._db[y] = { matches: [], players: [], total: 0, error: true };
    }
    this.setState({ tick: Date.now() });
  }

  loadDetail(m) {
    this._details = this._details || {};
    if (this._details[m.id]) return;
    this._details[m.id] = { loading: true, lineup: [], goalChips: [] };
    Promise.all([
      this.supa(`match_lineups?match_id=eq.${m.id}&select=is_mercenary,players(name)&order=is_mercenary.asc`),
      this.supa(`match_goals?match_id=eq.${m.id}&select=is_mercenary,players(name)`)
    ]).then(([lineups, goals]) => {
      const lineup = lineups.filter(l => !l.is_mercenary && l.players).map(l => l.players.name);
      const merc = lineups.filter(l => l.is_mercenary).length;
      const gm = {};
      goals.forEach(g => { const n = g.players ? g.players.name : '용병'; gm[n] = (gm[n] || 0) + 1; });
      this._details[m.id] = { lineup, merc, goalChips: Object.entries(gm).map(([n, c]) => c > 1 ? n + ' ' + c + '골' : n) };
      this.setState({ tick: Date.now() });
    }).catch(() => {
      this._details[m.id] = { error: true, lineup: [], goalChips: [] };
      this.setState({ tick: Date.now() });
    });
  }

  async loadSchedules() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      this._sched = await this.supa(`schedules?date=gte.${today}&order=date.asc&select=date,time,opponent,venue,address,note`);
    } catch (e) { this._sched = []; }
    this.setState({ tick: Date.now() });
  }

  componentDidMount() { this.loadSchedules(); }

  async loadNorwich() {
    try {
      const get = u => fetch(u).then(r => r.json());
      let view = [], league = '';
      for (const lg of ['eng.2', 'eng.1']) {
        try {
          const j = await get(`https://site.api.espn.com/apis/v2/sports/soccer/${lg}/standings`);
          const entries = (j.children && j.children[0] && j.children[0].standings && j.children[0].standings.entries) || [];
          const stat = (e, n) => { const s = e.stats.find(x => x.name === n); return s ? s.displayValue : '-'; };
          const rows = entries.map(e => ({
            rank: Number(stat(e, 'rank')), team: e.team.displayName,
            played: stat(e, 'gamesPlayed'), pts: stat(e, 'points'),
            isNor: (e.team.displayName || '').includes('Norwich')
          })).sort((a, b) => a.rank - b.rank);
          const idx = rows.findIndex(r => r.isNor);
          if (idx > -1) {
            view = rows.slice(Math.max(0, idx - 2), idx + 3);
            league = (j.children[0].name || '') + ' · ' + rows.length + '팀 중 ' + rows[idx].rank + '위';
            break;
          }
        } catch (e) {}
      }
      let lastRows = [];
      try {
        const j2 = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/eng.2/teams/381/schedule');
        const done = (j2.events || []).filter(e => e.competitions && e.competitions[0] && e.competitions[0].status.type.completed);
        lastRows = done.slice(-5).reverse().map(e => {
          const c = e.competitions[0];
          const us = c.competitors.find(x => (x.team.displayName || '').includes('Norwich'));
          const them = c.competitors.find(x => x !== us);
          const ug = Number(us.score && us.score.displayValue || 0);
          const tg = Number(them.score && them.score.displayValue || 0);
          return {
            date: (e.date || '').slice(5, 10).replace('-', '.'),
            opp: them.team.displayName, score: ug + ':' + tg,
            ha: us.homeAway === 'home' ? '홈' : '원정',
            res: ug > tg ? 'win' : ug === tg ? 'draw' : 'loss'
          };
        });
      } catch (e) {}
      this._nor = { view, lastRows, league, error: !view.length && !lastRows.length };
    } catch (e) { this._nor = { view: [], lastRows: [], error: true }; }
    this.setState({ tick: Date.now() });
  }

  schedVals() {
    const sched = this._sched || [];
    const nv = sched.find(s => s.address) || sched[0];
    return {
      schedules: sched.slice(0, 3).map(s => ({ dateShort: Number(s.date.slice(5, 7)) + '/' + Number(s.date.slice(8, 10)), time: s.time || '', opponent: s.opponent, venue: s.venue || '미정' })),
      venueName: (nv && nv.venue) || '성불빌라',
      venueAddr: (nv && nv.address) || '서울 노원구 동일로231가길 7',
      venueInfo: (nv && nv.note) || '전화번호: 031-790-2022, 주차 아무데나'
    };
  }

  allTime() {
    if (this._all) return this._all;
    if (!this._allLoading) { this._allLoading = true; this.loadAll(); }
    return { overall: { matches: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 }, perSeason: [], players: [], regional: [], bigWin: '-', bigLoss: '-', loading: true };
  }

  async loadAll() {
    try {
      const [playerStats, allMatches, regional, legacySeasons, newSeasons] = await Promise.all([
        this.supaAll('alltime_player_stats?select=*&order=total_goals.desc'),
        this.supaAll('matches_with_result?select=season,date,opponent,our_score,opp_score,result&order=date.asc'),
        this.supa('regional_stats?select=region,matches,wins,draws,losses&order=matches.desc').catch(() => []),
        this.supaAll('legacy_stats?select=season,players(name)').catch(() => []),
        this.supaAll('season_player_stats?select=season,name').catch(() => [])
      ]);
      const debut = {};
      legacySeasons.forEach(r => { const n = r.players && r.players.name; if (n && (!debut[n] || r.season < debut[n])) debut[n] = r.season; });
      newSeasons.forEach(r => { if (r.name && (!debut[r.name] || r.season < debut[r.name])) debut[r.name] = r.season; });
      const players = playerStats.map(p => ({
        name: p.name, ap: p.total_appearances || 0, goals: p.total_goals || 0, mvp: p.total_mvp || 0,
        debut: p.debut_season || p.first_season || debut[p.name] || '-'
      }));
      const overall = { matches: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 };
      const per = {};
      let bigWin = null, bigLoss = null;
      allMatches.forEach(m => {
        const res = m.result === 'W' ? 'wins' : m.result === 'D' ? 'draws' : 'losses';
        const s = per[m.season] = per[m.season] || { season: String(m.season), matches: 0, wins: 0, draws: 0, losses: 0 };
        s.matches++; s[res]++;
        overall.matches++; overall[res]++; overall.gf += m.our_score; overall.ga += m.opp_score;
        const diff = m.our_score - m.opp_score;
        const txt = `${m.season} ${m.our_score}:${m.opp_score} vs ${m.opponent}`;
        if (!bigWin || diff > bigWin.diff) bigWin = { diff, txt };
        if (!bigLoss || diff < bigLoss.diff) bigLoss = { diff, txt };
      });
      const perSeason = Object.values(per).map(s => ({ ...s, winRate: (s.wins / (s.matches || 1) * 100).toFixed(1) }));
      this._all = { overall, perSeason, players, regional, bigWin: bigWin ? bigWin.txt : '-', bigLoss: bigLoss ? bigLoss.txt : '-' };
    } catch (e) {
      this._all = { overall: { matches: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 }, perSeason: [], players: [], regional: [], bigWin: '-', bigLoss: '-', error: true };
    }
    this.setState({ tick: Date.now() });
  }

  renderVals() {
    const koreanTabs = this.props.koreanTabs ?? false;
    const recentCount = this.props.recentCount ?? 3;
    const st = this.state;
    const d = this.db(Number(st.season));
    const resPal = { win: ['#E4F5EA', '#15803D'], draw: ['#FAF3DC', '#A5841B'], loss: ['#FBE9E9', '#C0392B'] };
    const resLabel = { win: '승', draw: '무', loss: '패' };
    const rateColor = v => v >= 60 ? '#15803D' : v >= 40 ? '#A5841B' : '#C0392B';
    const chip = (on, label, onClick) => ({ label, onClick, bg: on ? '#113C98' : '#FFFFFF', color: on ? '#FFFFFF' : '#8A8577', bd: on ? '#113C98' : '#E7E4DB' });
    const deco = m => ({ ...m, resLabel: resLabel[m.result], resBg: resPal[m.result][0], resColor: resPal[m.result][1] });

    const wins = d.matches.filter(m => m.result === 'win').length;
    const draws = d.matches.filter(m => m.result === 'draw').length;
    const losses = d.matches.length - wins - draws;
    const gf = d.matches.reduce((s, m) => s + m.gf, 0);
    const ga = d.matches.reduce((s, m) => s + m.ga, 0);
    const mvpP = [...d.players].sort((a, b) => b.mvp - a.mvp || b.ap - a.ap)[0];

    const sortedMatches = [...d.matches].sort((a, b) => st.matchSort === 'asc' ? (a.date < b.date ? -1 : 1) : (a.date < b.date ? 1 : -1));
    const matchList = sortedMatches.map(m => {
      const det = (this._details || {})[m.id];
      const lineup = det ? det.lineup : [];
      const goalChips = det ? det.goalChips : [];
      return {
        ...deco(m), lineup, goalChips,
        lineupLabel: lineup.length ? `출전 선수 (${lineup.length}명${det.merc ? ' + 용병 ' + det.merc + '명' : ''})` : '',
        goalLabel: goalChips.length ? '득점' : '',
        detailNote: !det ? '' : det.loading ? '불러오는 중...' : det.error ? '불러오기 실패' : !lineup.length ? '출전 명단 없음 (레거시 데이터)' : '',
        detailDisplay: st.openMatch === m.id ? 'block' : 'none',
        toggleLabel: st.openMatch === m.id ? '▲ 닫기' : '▼ 상세보기',
        onToggle: () => { this.loadDetail(m); this.setState(s => ({ openMatch: s.openMatch === m.id ? null : m.id })); }
      };
    });

    const collator = new Intl.Collator('ko');
    let pl = [...d.players];
    if (st.playerFilter === 'goals') pl.sort((a, b) => b.goals - a.goals || b.ap - a.ap);
    else if (st.playerFilter === 'attendance') pl.sort((a, b) => b.ap - a.ap || b.goals - a.goals);
    else if (st.playerFilter === 'mvp') pl.sort((a, b) => b.mvp - a.mvp || b.goals - a.goals);
    else pl.sort((a, b) => collator.compare(a.name, b.name));
    const playerList = pl.map((p, i) => {
      const rate = Math.round(p.ap / (d.total || 1) * 100);
      const rk = i === 0 ? ['#F0D281', '#113C98'] : i === 1 ? ['#D9D9D9', '#374151'] : i === 2 ? ['#CD9B6A', '#5B3A1E'] : ['#F3F1EA', '#8A8577'];
      const rc = rate >= 70 ? ['#E4F5EA', '#15803D'] : rate >= 40 ? ['#FAF3DC', '#A5841B'] : ['#FBE9E9', '#C0392B'];
      const chips = [
        { key: 'attendance', label: '출전 ' + p.ap, bg: '#F3F1EA', color: '#8A8577', weight: 500 },
        { key: 'goals', label: '골 ' + p.goals, bg: '#EEF2FB', color: '#113C98', weight: 700 },
        { key: 'mvp', label: 'MVP ' + p.mvp + '회', bg: '#FAF3DC', color: '#A5841B', weight: 500 }
      ];
      const ai = chips.findIndex(c => c.key === st.playerFilter);
      if (ai > -1) {
        const [act] = chips.splice(ai, 1);
        chips.unshift({ ...act, bg: '#FEE2E2', color: '#DC2626', weight: 700 });
      }
      const badge = st.playerFilter === 'goals' ? { badgeLabel: p.goals + '골', badgeBg: '#EEF2FB', badgeColor: '#113C98' }
        : st.playerFilter === 'mvp' ? { badgeLabel: 'MVP ' + p.mvp + '회', badgeBg: '#FAF3DC', badgeColor: '#A5841B' }
        : { badgeLabel: '참석률 ' + rate + '%', badgeBg: rc[0], badgeColor: rc[1] };
      return { ...p, rate, rank: i + 1, rankBg: rk[0], rankColor: rk[1], rateBg: rc[0], rateColor: rc[1], statChips: chips, ...badge };
    });

    const tops = k => [...d.players].sort((a, b) => b[k] - a[k])[0];
    const tg = tops('goals'), ta = tops('ap'), tm = tops('mvp');
    const seasonCards = [
      { title: '경기 수', value: d.matches.length, sub: `${wins}승 ${draws}무 ${losses}패`, accent: '#113C98' },
      { title: '승률', value: (wins / (d.matches.length || 1) * 100).toFixed(1) + '%', sub: st.season + ' 시즌', accent: '#113C98' },
      { title: '득점', value: gf, sub: `경기당 ${(gf / (d.matches.length || 1)).toFixed(1)}골`, accent: '#113C98' },
      { title: '실점', value: ga, sub: `경기당 ${(ga / (d.matches.length || 1)).toFixed(1)}골`, accent: '#113C98' }
    ];
    const seasonBest = [
      { icon: '골', title: '최다 골', name: tg ? tg.name : '-', sub: tg ? tg.goals + '골' : '' },
      { icon: '출', title: '최다 참여', name: ta ? ta.name : '-', sub: ta ? ta.ap + '경기' : '' },
      { icon: 'M', title: '최다 MVP', name: tm && tm.mvp > 0 ? tm.name : '-', sub: tm && tm.mvp > 0 ? tm.mvp + '회' : '' }
    ];
    const formPal = { win: ['#2E7D4F', '#FFFFFF'], draw: ['#E0B94B', '#5B4708'], loss: ['#C0392B', '#FFFFFF'] };
    const formList = [...d.matches].sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 5).reverse()
      .map(m => ({ label: resLabel[m.result], bg: formPal[m.result][0], fg: formPal[m.result][1] }));
    const monthlyMap = {};
    d.matches.forEach(m => {
      const mo = Number(m.date.slice(5, 7));
      const e = monthlyMap[mo] = monthlyMap[mo] || { gf: 0, ga: 0 };
      e.gf += m.gf; e.ga += m.ga;
    });
    const moKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const moMax = Math.max(1, ...moKeys.map(k => monthlyMap[k] ? Math.max(monthlyMap[k].gf, monthlyMap[k].ga) : 0));
    const monthly = moKeys.map(k => {
      const e = monthlyMap[k] || { gf: 0, ga: 0 };
      return {
        label: k + '월', gf: e.gf, ga: e.ga,
        gfH: Math.max(3, Math.round(e.gf / moMax * 80)) + 'px',
        gaH: Math.max(3, Math.round(e.ga / moMax * 80)) + 'px',
        tipDisplay: st.hoverMonth === k ? 'block' : 'none',
        onEnter: () => this.setState({ hoverMonth: k }),
        onLeave: () => this.setState(s => s.hoverMonth === k ? { hoverMonth: null } : null)
      };
    });

    const A = this.allTime();
    const bestRate = Math.max(...A.perSeason.map(s => Number(s.winRate)));
    const trendBars = [...A.perSeason].sort((a, b) => a.season.localeCompare(b.season)).map(s => ({
      label: "'" + s.season.slice(2),
      h: Math.max(4, Math.round(Number(s.winRate) / 100 * 74)) + 'px',
      bg: Number(s.winRate) === bestRate ? '#C9A227' : '#113C98'
    }));
    const seasonRows = [...A.perSeason];
    if (st.teamSort === 'winrate') seasonRows.sort((a, b) => b.winRate - a.winRate);
    else if (st.teamSort === 'wins') seasonRows.sort((a, b) => b.wins - a.wins);
    else if (st.teamSort === 'matches') seasonRows.sort((a, b) => b.matches - a.matches);
    else seasonRows.sort((a, b) => b.season.localeCompare(a.season));

    let regional = A.regional.map(x => ({ ...x, winRate: (x.wins / (x.matches || 1) * 100).toFixed(1) }));
    if (st.regionalSort === 'matches') regional.sort((a, b) => b.matches - a.matches);
    else if (st.regionalSort === 'wins') regional.sort((a, b) => b.wins - a.wins);
    else if (st.regionalSort === 'name') regional.sort((a, b) => collator.compare(a.region, b.region));
    else regional.sort((a, b) => b.winRate - a.winRate);

    // 지역 그룹: 서울(구) / 경기(시·군) / 인천 / 기타 — 표·히트맵 공용
    const GROUP_THEME = { '서울': ['#113C98', '#EEF2FB'], '경기': ['#0F766E', '#E6F4F1'], '인천': ['#7C3AED', '#F1EBFB'], '기타': ['#8A8577', '#F3F1EA'] };
    const SEOUL_GU = new Set(['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구']);
    const groupOf = r => SEOUL_GU.has(r.region) ? '서울' : r.region.startsWith('인천') ? '인천' : /(시|군)$/.test(r.region) ? '경기' : '기타';
    const regionalGroups = ['서울', '경기', '인천', '기타'].map(name => {
      const rows = regional.filter(r => groupOf(r) === name).map(r => ({ ...r, rateColor: rateColor(Number(r.winRate)) }));
      const sum = rows.reduce((s, r) => ({ m: s.m + r.matches, w: s.w + r.wins }), { m: 0, w: 0 });
      const heat = rows.map(r => {
        const v = Number(r.winRate);
        const pal = v >= 60 ? ['#CDEBD8', '#14532D'] : v >= 40 ? ['#F6ECC8', '#7C5E0B'] : ['#F6D5D5', '#8E2323'];
        return { ...r, bg: pal[0], fg: pal[1] };
      });
      const theme = GROUP_THEME[name];
      const byRegion = Object.fromEntries(heat.map(r => [r.region, r]));
      const isSeoul = name === '서울' && !!window.SEOUL_DISTRICTS;
      // 서울 지도: 선택 구(hover/터치) — 기본값은 최다 경기 구
      const defaultGu = isSeoul ? [...heat].sort((a, b) => b.matches - a.matches)[0]?.region : null;
      const selGu = isSeoul ? (st.seoulGu && byRegion[st.seoulGu] ? st.seoulGu : defaultGu) : null;
      const mapCells = isSeoul ? Object.entries(window.SEOUL_DISTRICTS).map(([gu, geo]) => {
        const r = byRegion[gu];
        const short = gu.replace(/구$/, '');
        const selected = gu === selGu;
        return {
          path: geo.d, cx: geo.cx, cy: geo.cy, cy2: geo.cy + 10,
          fill: r ? r.bg : '#EFEDE6', stroke: selected ? '#113C98' : '#FFFFFF', strokeWidth: selected ? 2.4 : 1.2,
          labelColor: r ? r.fg : '#B0AB9D', label: short, sub: r ? r.winRate + '%' : '-',
          tip: r ? `${gu} · ${r.matches}경기 ${r.wins}승 ${r.draws}무 ${r.losses}패 · 승률 ${r.winRate}%` : `${gu} · 경기 없음`,
          onPick: r ? () => this.setState({ seoulGu: gu }) : () => {}
        };
      }).sort((a, b) => (a.stroke === '#113C98') - (b.stroke === '#113C98')) : [];
      const selR = selGu ? byRegion[selGu] : null;
      const sel = selR ? { gu: selGu, winRate: selR.winRate, matches: selR.matches, record: `${selR.wins}승 ${selR.draws}무 ${selR.losses}패`, bg: selR.bg, fg: selR.fg,
                           rank: [...heat].sort((a, b) => b.winRate - a.winRate).findIndex(r => r.region === selGu) + 1, total: heat.length }
                       : { gu: '-', winRate: '-', matches: 0, record: '', bg: '#F3F1EA', fg: '#8A8577', rank: 0, total: heat.length };
      return { name, rows, heat, mapCells, sel, isSeoul, notSeoul: !isSeoul, color: theme[0], bg: theme[1], count: rows.length + '개 지역',
               summary: `${rows.length}개 지역 · ${sum.m}경기 · 승률 ${(sum.w / (sum.m || 1) * 100).toFixed(1)}%` };
    }).filter(g => g.rows.length);

    const topOf = k => [...A.players].sort((a, b) => b[k] - a[k])[0];
    const hg = topOf('goals'), hap = topOf('ap'), hm = topOf('mvp');

    const tabDefs = [['Home', '홈', 'home'], ['Seasons', '시즌', 'seasons'], ['Matches', '경기', 'matches'], ['Players', '선수', 'players'], ['Records', '기록', 'records']];
    const mkTabs = pos => tabDefs.map(([en, kr, key]) => {
      const on = st.tab === key;
      const label = koreanTabs ? kr : en;
      const onClick = () => { this.setState({ tab: key, openMatch: null }); window.scrollTo({ top: 0 }); };
      return pos === 'top'
        ? { label, onClick, color: on ? '#113C98' : '#CBD8F5', bg: on ? '#F6F5F1' : 'rgba(255,255,255,.06)' }
        : { label, onClick, color: on ? '#113C98' : '#B0AB9D', bd: on ? '#113C98' : 'transparent' };
    });

    const allOn = st.tab === 'records';
    const nor = this._nor || {};
    return {
      vNorwich: !!st.norwich,
      norLeague: nor.league || 'NORWICH CITY',
      norStatus: nor.loading ? '노리치 데이터를 불러오는 중...' : nor.error ? '지금은 노리치 데이터를 불러올 수 없습니다.' : '',
      norRows: (nor.view || []).map(r => ({ ...r, bg: r.isNor ? '#00A650' : 'transparent', fg: r.isNor ? '#FFFFFF' : '#1A1A1A', weight: r.isNor ? 800 : 600 })),
      norLast: (nor.lastRows || []).map(e => ({ ...e, resLabel: resLabel[e.res], resBg: resPal[e.res][0], resColor: resPal[e.res][1] })),
      onNorClose: () => this.setState({ norwich: false }),
      onLogo: () => {
        const now = Date.now();
        this._clicks = (this._lastClick && now - this._lastClick < 1500) ? (this._clicks || 0) + 1 : 1;
        this._lastClick = now;
        if (this._clicks >= 3) {
          this._clicks = 0;
          if (!this._nor) { this._nor = { loading: true }; this.loadNorwich(); }
          this.setState(s => ({ norwich: !s.norwich }));
        }
      },
      season: st.season,
      onSeason: e => this.setState({ season: e.target.value, tab: st.tab === 'records' ? 'home' : st.tab, openMatch: null }),
      allBtnLabel: allOn ? '시즌 보기' : '역대 기록',
      allBtnBg: allOn ? '#F0D281' : 'transparent', allBtnColor: allOn ? '#113C98' : '#CBD8F5', allBtnBd: allOn ? '#F0D281' : '#4C6CC0',
      onAllTime: () => { this.setState({ tab: allOn ? 'home' : 'records' }); window.scrollTo({ top: 0 }); },
      tabsTop: mkTabs('top'), tabsBottom: mkTabs('bottom'),
      vHome: st.tab === 'home', vSeasons: st.tab === 'seasons', vMatches: st.tab === 'matches', vPlayers: st.tab === 'players', vRecords: st.tab === 'records',
      stTotal: d.matches.length, stRate: (wins / (d.matches.length || 1) * 100).toFixed(1), stRecord: `${wins}승 ${draws}무 ${losses}패`,
      stGoals: gf, stGpm: (gf / (d.matches.length || 1)).toFixed(1),
      mvpName: mvpP ? mvpP.name : '-', mvpSub: mvpP ? `MVP ${mvpP.mvp}회 · 출전 ${mvpP.ap}회` : 'MVP 0회',
      recentMatches: sortedMatches.slice(0, recentCount).map(deco),
      ...this.schedVals(),
      ...(() => {
        const now = new Date();
        const y = Number(st.season);
        const pct = y < now.getFullYear() ? 100 : y > now.getFullYear() ? 0
          : Math.min(100, Math.round((now - new Date(y, 0, 1)) / (new Date(y, 11, 31) - new Date(y, 0, 1)) * 100));
        const found = new Date(2000, 4, 9);
        const foundDays = Math.floor((now - found) / 86400000);
        let foundYears = now.getFullYear() - 2000;
        if (now < new Date(now.getFullYear(), 4, 9)) foundYears--;
        return {
          progPct: pct + '%', progLabel: pct + '%',
          progSub: st.season + ' 시즌 · ' + d.matches.length + '경기 소화',
          foundYears, foundDays: foundDays.toLocaleString()
        };
      })(),
      hasStatus: !!(d.loading || d.error || (st.tab === 'records' && A.loading)),
      statusMsg: d.error ? st.season + ' 시즌 데이터를 불러올 수 없습니다.' : (st.tab === 'records' && A.loading) ? '역대 기록을 불러오는 중...' : st.season + ' 시즌 데이터를 불러오는 중...',
      seasonCards, seasonBest, formList, monthly, trendBars,
      stGa: ga,
      wdlWin: (wins / (d.matches.length || 1) * 100).toFixed(1) + '%', wdlDraw: (draws / (d.matches.length || 1) * 100).toFixed(1) + '%', wdlLoss: (losses / (d.matches.length || 1) * 100).toFixed(1) + '%',
      wdlWinN: wins, wdlDrawN: draws, wdlLossN: losses,
      matchChips: [chip(st.matchSort === 'desc', '날짜 내림차순', () => this.setState({ matchSort: 'desc' })), chip(st.matchSort === 'asc', '날짜 오름차순', () => this.setState({ matchSort: 'asc' }))],
      matchList,
      playerChips: [['all', '전체'], ['goals', '골 순'], ['attendance', '참석 순'], ['mvp', 'MVP 횟수']].map(([k, l]) => chip(st.playerFilter === k, l, () => this.setState({ playerFilter: k }))),
      playerList,
      ovMatches: A.overall.matches, ovRecord: `${A.overall.wins}승 ${A.overall.draws}무 ${A.overall.losses}패`,
      ovRate: (A.overall.wins / (A.overall.matches || 1) * 100).toFixed(1), ovGf: A.overall.gf, ovGa: A.overall.ga,
      bigWin: A.bigWin, bigLoss: A.bigLoss,
      teamChips: [['season', '시즌 순'], ['winrate', '승률 순'], ['wins', '승수 순'], ['matches', '경기수 순']].map(([k, l]) => chip(st.teamSort === k, l, () => this.setState({ teamSort: k }))),
      seasonRows: seasonRows.map(r => ({ ...r, rateColor: rateColor(Number(r.winRate)) })),
      highlights: [
        { icon: '골', title: '최다 득점', name: hg ? hg.name : '-', sub: hg ? hg.goals + '골' : '' },
        { icon: '출', title: '최다 출장', name: hap ? hap.name : '-', sub: hap ? hap.ap + '경기' : '' },
        { icon: 'M', title: '최다 MVP', name: hm ? hm.name : '-', sub: hm ? hm.mvp + '회' : '' }
      ],
      allPlayers: [...A.players].sort((a, b) => b.goals - a.goals).map((p, i) => ({
        ...p, debut: p.debut || '-', rank: i + 1,
        rankBg: i === 0 ? '#F0D281' : i === 1 ? '#D9D9D9' : i === 2 ? '#CD9B6A' : '#F3F1EA',
        rankColor: i === 0 ? '#113C98' : i === 1 ? '#374151' : i === 2 ? '#5B3A1E' : '#8A8577'
      })),
      regionalChips: [['matches', '경기수 순'], ['winrate', '승률 순'], ['wins', '승수 순'], ['name', '지역명 순']].map(([k, l]) => chip(st.regionalSort === k, l, () => this.setState({ regionalSort: k }))),
      regionalGroups: regionalGroups
    };
  }
}

// ── 상태 관리 / 마운트 ──
Object.assign(WhistleApp.prototype, {
  setState(update) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    if (!patch) return;
    const next = { ...this.state, ...patch };
    const keys = new Set([...Object.keys(this.state), ...Object.keys(next)]);
    let changed = false;
    for (const k of keys) if (this.state[k] !== next[k]) { changed = true; break; }
    if (!changed) return;
    this.state = next;
    this.render();
  },

  mount(rootEl, templateEl) {
    this.root = rootEl;
    this.template = templateEl.content;
    this.render();
    if (this.componentDidMount) this.componentDidMount();
  },

  // ── 카카오지도: 일정 카드에 표시되는 주소(다음 경기 구장, 없으면 성불빌라)를 지오코딩해 마커 표시 ──
  loadKakao() {
    if (this._kakaoReady) return this._kakaoReady;
    this._kakaoReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_API_KEY}&autoload=false&libraries=services`;
      s.onload = () => window.kakao.maps.load(resolve);
      s.onerror = () => reject(new Error('kakao sdk load failed'));
      document.head.appendChild(s);
    });
    return this._kakaoReady;
  },

  afterRender() {
    const slot = document.getElementById('venueMap');
    if (!slot) return;
    const address = slot.dataset.address || '';
    const name = slot.dataset.name || '구장';
    if (!this._mapEl) {
      this._mapEl = document.createElement('div');
      this._mapEl.style.cssText = 'width:100%; height:100%; min-height:240px;';
    }
    slot.appendChild(this._mapEl);
    this.loadKakao().then(() => {
      const km = window.kakao.maps;
      if (!this._map) {
        this._map = new km.Map(this._mapEl, { center: new km.LatLng(DEFAULT_LAT, DEFAULT_LNG), level: 4 });
        this._marker = new km.Marker({ map: this._map });
        this._info = new km.InfoWindow({});
        this._geocoder = new km.services.Geocoder();
      }
      this._map.relayout();
      if (this._mapAddress === address) { this._map.setCenter(this._marker.getPosition()); return; }
      this._mapAddress = address;
      const place = (pos) => {
        this._map.setCenter(pos);
        this._marker.setPosition(pos);
        this._info.setContent(`<div style="padding:4px 8px; font-size:12px; font-weight:700; color:#113C98; white-space:nowrap;">${escapeHtml(name)}</div>`);
        this._info.open(this._map, this._marker);
      };
      if (!address) { place(new km.LatLng(DEFAULT_LAT, DEFAULT_LNG)); return; }
      this._geocoder.addressSearch(address, (result, status) => {
        if (this._mapAddress !== address) return;
        const ok = status === km.services.Status.OK && result.length > 0;
        place(ok ? new km.LatLng(result[0].y, result[0].x) : new km.LatLng(DEFAULT_LAT, DEFAULT_LNG));
      });
    }).catch(() => {
      slot.innerHTML = '<div style="padding:16px; font-size:12px; color:#B0AB9D;">지도를 불러올 수 없습니다.</div>';
    });
  },

  render() {
    if (this._rendering) { this._dirty = true; return; }
    this._rendering = true;
    try {
      const vals = this.renderVals();
      const frag = document.createDocumentFragment();
      renderNodes(frag, this.template.childNodes, vals);
      this.root.replaceChildren(frag);
      this.afterRender();
    } finally {
      this._rendering = false;
    }
    if (this._dirty) { this._dirty = false; this.render(); }
  }
});

const whistleApp = new WhistleApp();
whistleApp.mount(document.getElementById('app'), document.getElementById('dc-template'));
window.whistleApp = whistleApp;
