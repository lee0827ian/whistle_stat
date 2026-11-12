/* 선수 카드(피파 느낌) — 선수 탭에서 선수 줄을 누르면 카드가 가운데로 날아와 돌며 펼쳐진다.
   능력치는 경기 기록으로 처음 열 때 한 번 계산해 두고 다시 쓴다.
     득점 = 최근 3시즌 경기당 골, 출석 = 최근 3시즌 팀 경기 중 출전 비율, 승리 = 최근 3시즌 뛴 경기 승률(무 0.5),
     MVP = 가림 시즌(시상식 전)을 뺀 최근 3시즌 경기당 MVP, 경험 = 통산 출전, 꾸준 = 출전한 시즌 수
   최근 3시즌 10경기 이상 뛴 선수끼리 순위로 60~99점(꼴찌 60). 승리는 실제 승률로 환산(40%=60, 80%=99).
   경기 수가 적으면 비율이 튀지 않게 평균 쪽으로 당긴다(20경기분). 종합 = 득점·출석 20%, 나머지 15%씩.
   그 밖의 선수는 점수 없이 통산 기록 카드. */
(function () {
  const ORDER = ['득점', '출석', '승리', 'MVP', '경험', '꾸준'];
  const W = { 득점: .2, 출석: .2, 승리: .15, MVP: .15, 경험: .15, 꾸준: .15 };
  const MIN_APPS = 10, SHRINK = 20;
  const SIL = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="34" r="20" fill="currentColor"/><path d="M10 100c2-26 18-38 40-38s38 12 40 38z" fill="currentColor"/></svg>';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tier = o => o == null ? 'plain' : o >= 86 ? 'special' : o >= 82 ? 'gold' : o >= 76 ? 'silver' : 'bronze';

  let cache = null, loading = null, stage = null, lastFocus = null;

  async function load(app, hidden) {
    const seasonsRows = await app.supaAll('season_player_stats?select=season,name,appearances,goals,mvp');
    const Y = Math.max(...seasonsRows.map(r => r.season));
    const REC = [Y - 2, Y - 1, Y];
    const [roster, matches, lineups] = await Promise.all([
      app.supaAll('players?select=id,name,number&order=id.asc'),
      app.supaAll(`matches_with_result?select=id,season,result&season=gte.${Y - 2}&order=id.asc`),
      app.supaAll(`match_lineups?select=match_id,player_id,matches!inner(season)&matches.season=gte.${Y - 2}&player_id=not.is.null&is_mercenary=eq.false&order=id.asc`)
    ]);
    const idName = {}, number = {};
    roster.forEach(p => { idName[p.id] = p.name; if (p.number != null) number[p.name] = p.number; });
    const result = {}; matches.forEach(m => { result[m.id] = m.result; });
    const teamGames = matches.length || 1;

    // 시즌별 기록 → 선수별 합계
    const mvpSeasons = [...new Set(seasonsRows.map(r => r.season))].filter(s => !hidden.includes(s)).sort((a, b) => b - a).slice(0, 3);
    const P = {};
    const get = n => P[n] || (P[n] = { name: n, ap: 0, goals: 0, seasons: 0, mvpAll: 0, recAp: 0, recGoals: 0, mvpAp: 0, mvp: 0, win: 0, winAp: 0 });
    seasonsRows.forEach(r => {
      const p = get(r.name), ap = r.appearances || 0;
      p.ap += ap; p.goals += r.goals || 0; if (ap > 0) p.seasons++;
      if (!hidden.includes(r.season)) p.mvpAll += r.mvp || 0;
      if (REC.includes(r.season)) { p.recAp += ap; p.recGoals += r.goals || 0; }
      if (mvpSeasons.includes(r.season)) { p.mvpAp += ap; p.mvp += r.mvp || 0; }
    });
    lineups.forEach(l => {
      const n = idName[l.player_id], r = result[l.match_id]; if (!n || !r) return;
      const p = get(n); p.winAp++; p.win += r === 'W' ? 1 : r === 'D' ? .5 : 0;
    });

    const pool = Object.values(P).filter(p => p.recAp >= MIN_APPS);
    const shrink = (x, n, mu) => (x * n + mu * SHRINK) / (n + SHRINK);
    const mean = (f, nf) => { let s = 0, n = 0; pool.forEach(p => { s += f(p) * nf(p); n += nf(p); }); return n ? s / n : 0; };
    const muG = mean(p => p.recGoals / p.recAp, p => p.recAp);
    const muM = mean(p => p.mvpAp ? p.mvp / p.mvpAp : 0, p => p.mvpAp);
    const muW = mean(p => p.winAp ? p.win / p.winAp : 0, p => p.winAp);
    const raw = {};
    pool.forEach(p => {
      raw[p.name] = {
        득점: shrink(p.recGoals / p.recAp, p.recAp, muG),
        출석: p.recAp / teamGames,
        MVP: shrink(p.mvpAp ? p.mvp / p.mvpAp : muM, p.mvpAp, muM),
        경험: p.ap, 꾸준: p.seasons,
        승리: shrink(p.winAp ? p.win / p.winAp : muW, p.winAp, muW)
      };
    });
    const sorted = {};
    ['득점', '출석', 'MVP', '경험', '꾸준'].forEach(k => { sorted[k] = pool.map(p => raw[p.name][k]).sort((a, b) => a - b); });
    const pct = (k, v) => { const a = sorted[k]; let lo = 0, eq = 0; a.forEach(x => { if (x < v) lo++; else if (x === v) eq++; }); return (lo + eq / 2) / a.length; };
    const cards = {};
    Object.values(P).forEach(p => {
      const base = { name: p.name, num: number[p.name], ap: p.ap, goals: p.goals, seasons: p.seasons, mvpAll: p.mvpAll, recAp: p.recAp, recGoals: p.recGoals,
        winPct: p.winAp ? Math.round(p.win / p.winAp * 100) : null };
      if (!raw[p.name]) { cards[p.name] = { ...base, ovr: null }; return; }
      const r = raw[p.name], s = {};
      ['득점', '출석', 'MVP', '경험', '꾸준'].forEach(k => { s[k] = Math.round(60 + 39 * pct(k, r[k])); });
      s.승리 = Math.round(Math.min(99, Math.max(60, 60 + (r.승리 - .4) / .4 * 39)));
      cards[p.name] = { ...base, stats: s, ovr: Math.round(ORDER.reduce((t, k) => t + s[k] * W[k], 0)) };
    });
    return { cards, Y };
  }

  function cardHTML(c) {
    const t = tier(c.ovr);
    const top = c.ovr == null
      ? `<div class="pc-ovr pc-ovr-none">${c.ap}<small>경기</small></div>`
      : `<div class="pc-ovr">${c.ovr}<small>OVR</small></div>`;
    const stats = c.ovr == null
      ? [['통산 출전', c.ap], ['통산 골', c.goals], ['시즌', c.seasons], ['MVP', c.mvpAll]].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('')
      : ORDER.map(k => `<div><b>${c.stats[k]}</b>${k}</div>`).join('');
    return `<div class="pc-card pc-${t}">
      <div class="pc-in">
        <div class="pc-top">${top}<div class="pc-club"><img src="whistle_logo.svg" alt=""><span>${c.num == null ? '' : esc(c.num)}</span></div></div>
        <div class="pc-photo">${SIL}</div>
        <div class="pc-name">${esc(c.name)}</div>
        <div class="pc-stats">${stats}</div>
      </div>
    </div>`;
  }

  function close() {
    if (!stage) return;
    stage.remove(); stage = null; document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function show(c, fromEl, Y) {
    close();
    lastFocus = fromEl;
    const r = fromEl ? fromEl.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const w = Math.min(innerWidth * 0.78, (innerHeight - 170) / 1.44, 340);
    stage = document.createElement('div');
    stage.className = 'pc-stage';
    stage.setAttribute('role', 'dialog'); stage.setAttribute('aria-modal', 'true'); stage.setAttribute('aria-label', c.name + ' 선수 카드');
    const sub = c.ovr == null
      ? `통산 ${c.ap}경기 ${c.goals}골 · ${c.seasons}시즌<br>최근 3시즌 ${MIN_APPS}경기 이상이면 능력치 카드가 됩니다`
      : `통산 ${c.ap}경기 ${c.goals}골 · ${c.seasons}시즌<br>최근 3시즌(${Y - 2}~${Y}) ${c.recAp}경기 ${c.recGoals}골${c.winPct == null ? '' : ' · 승률 ' + c.winPct + '%'}`;
    stage.innerHTML = cardHTML(c) + `<div class="pc-sub">${sub}</div><button type="button" class="pc-close">닫기</button>`;
    const big = stage.querySelector('.pc-card');
    big.style.setProperty('--w', w + 'px');
    const cx = innerWidth / 2, cy = innerHeight / 2 - 40;
    big.style.setProperty('--dx', (r.left + r.width / 2 - cx) + 'px');
    big.style.setProperty('--dy', (r.top + r.height / 2 - cy) + 'px');
    stage.querySelector('.pc-close').onclick = close;
    stage.addEventListener('click', e => { if (e.target === stage) close(); });
    document.body.appendChild(stage);
    document.documentElement.style.overflow = 'hidden';
    stage.querySelector('.pc-close').focus({ preventScroll: true });
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  window.WhistleCard = {
    async open(name, fromEl, app, hiddenSeasons) {
      try {
        if (!cache) {
          if (!loading) loading = load(app, (hiddenSeasons || []).map(Number));
          if (fromEl) fromEl.style.opacity = '.6';
          cache = await loading;
        }
      } catch (e) {
        loading = null;
        if (app && app.flash) app.flash('카드 기록을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.');
        return;
      } finally { if (fromEl) fromEl.style.opacity = ''; }
      const c = cache.cards[name] || { name, ap: 0, goals: 0, seasons: 0, mvpAll: 0, recAp: 0, recGoals: 0, ovr: null };
      show(c, fromEl, cache.Y);
    },
    reset() { cache = null; loading = null; }
  };
})();
