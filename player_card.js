/* 선수 카드(피파 느낌) — 선수 탭에서 선수 줄을 누르면 카드가 가운데로 날아와 돌며 펼쳐진다.
   능력치는 경기 기록으로 처음 열 때 한 번 계산해 두고 다시 쓴다.
     득점 = 최근 3시즌 경기당 골, 출석 = 최근 3시즌 팀 경기 중 출전 비율, 승리 = 최근 3시즌 뛴 경기 승률(무 0.5),
     MVP = 가림 시즌(시상식 전)을 뺀 최근 3시즌 경기당 MVP, 경험 = 통산 출전, 꾸준 = 출전한 시즌 수
   최근 3시즌 10경기 이상 뛴 선수끼리 순위로 60~99점(꼴찌 60). 승리는 실제 승률로 환산(40%=60, 80%=99).
   경기 수가 적으면 비율이 튀지 않게 평균 쪽으로 당긴다(20경기분). 종합 = 득점·출석 20%, 나머지 15%씩.
   그 밖의 선수는 점수 없이 통산 기록 카드.
   사진: Supabase player_photos 표 → Storage player-photos(본인이 카드에서 직접 올림, 선수당 2장까지).
   표를 못 읽으면 예전 저장소 사진(photos/index.json). 없으면 실루엣. */
(function () {
  const ORDER = ['득점', '출석', '승리', 'MVP', '경험', '꾸준'];
  const W = { 득점: .2, 출석: .2, 승리: .15, MVP: .15, 경험: .15, 꾸준: .15 };
  const MIN_APPS = 10, SHRINK = 20;
  const SIL = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="34" r="20" fill="currentColor"/><path d="M10 100c2-26 18-38 40-38s38 12 40 38z" fill="currentColor"/></svg>';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 등급 색 = 점수 카드 대상 안에서 OVR 순위 비율(같은 점수는 가운데 순위): 상위 15% 스페셜 · 다음 25% 골드 · 다음 35% 실버 · 나머지 브론즈
  const tier = c => c.ovr == null ? 'plain' : (c.tier || 'silver');

  let cache = null, loading = null, stage = null, lastFocus = null;

  async function load(app, hidden) {
    const seasonsRows = await app.supaAll('season_player_stats?select=season,name,appearances,goals,mvp&order=season.asc,name.asc');
    const Y = Math.max(...seasonsRows.map(r => r.season));
    const REC = [Y - 2, Y - 1, Y];
    let photoRows = null;
    try { photoRows = await app.supa('player_photos?select=player_id,path'); } catch (e) {}
    const photoIds = photoRows ? [] : await fetch('photos/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).catch(() => []);
    const photoPath = {}; (photoRows || []).forEach(r => { photoPath[r.player_id] = r.path; });
    const [roster, matches, lineups] = await Promise.all([
      app.supaAll('players?select=id,name,number&order=id.asc'),
      app.supaAll(`matches_with_result?select=id,season,result&season=gte.${Y - 2}&order=id.asc`),
      app.supaAll(`match_lineups?select=match_id,player_id,matches!inner(season)&matches.season=gte.${Y - 2}&player_id=not.is.null&is_mercenary=eq.false&order=id.asc`)
    ]);
    const idName = {}, number = {}, photo = {}, pidOf = {};
    roster.forEach(p => { idName[p.id] = p.name; if (p.number != null) number[p.name] = p.number; if (photoPath[p.id]) photo[p.name] = photoURL(photoPath[p.id]); else if (photoIds.includes(p.id)) photo[p.name] = `photos/${p.id}.webp`; pidOf[p.name] = p.id; });
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
      const base = { name: p.name, id: pidOf[p.name], num: number[p.name], photo: photo[p.name], ap: p.ap, goals: p.goals, seasons: p.seasons, mvpAll: p.mvpAll, recAp: p.recAp, recGoals: p.recGoals,
        winPct: p.winAp ? Math.round(p.win / p.winAp * 100) : null };
      if (!raw[p.name]) { cards[p.name] = { ...base, ovr: null }; return; }
      const r = raw[p.name], s = {};
      ['득점', '출석', 'MVP', '경험', '꾸준'].forEach(k => { s[k] = Math.round(60 + 39 * pct(k, r[k])); });
      s.승리 = Math.round(Math.min(99, Math.max(60, 60 + (r.승리 - .4) / .4 * 39)));
      cards[p.name] = { ...base, stats: s, ovr: Math.round(ORDER.reduce((t, k) => t + s[k] * W[k], 0)) };
    });
    const ovrs = Object.values(cards).filter(c => c.ovr != null).map(c => c.ovr);
    Object.values(cards).forEach(c => {
      if (c.ovr == null) return;
      const above = ovrs.filter(o => o > c.ovr).length, same = ovrs.filter(o => o === c.ovr).length, q = (above + same / 2) / ovrs.length;
      c.tier = q < .15 ? 'special' : q < .40 ? 'gold' : q < .75 ? 'silver' : 'bronze';
    });
    return { cards, Y };
  }

  function cardHTML(c) {
    const t = tier(c);
    const top = c.ovr == null
      ? `<div class="pc-ovr pc-ovr-none">${c.ap}<small>경기</small></div>`
      : `<div class="pc-ovr">${c.ovr}<small>OVR</small></div>`;
    const stats = c.ovr == null
      ? [['통산 출전', c.ap], ['통산 골', c.goals], ['시즌', c.seasons], ['MVP', c.mvpAll]].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('')
      : ORDER.map(k => `<div><b>${c.stats[k]}</b>${k}</div>`).join('');
    return `<div class="pc-card pc-${t}"><div class="pc-in">${frontIn(c, top, stats)}</div></div>`;
  }
  const topRow = (c, top) => `<div class="pc-top">${top}<div class="pc-club"><img src="whistle_logo.svg" alt=""><span>${c.num == null ? '' : esc(c.num)}</span></div></div>`;
  function frontIn(c, top, stats) {
    return `${topRow(c, top)}
        <div class="pc-photo${c.photo ? ' pc-cut' : ''}">${c.photo ? `<img src="${esc(c.photo)}" alt="" onerror="this.parentNode.classList.remove('pc-cut');this.outerHTML=window.WhistleCard.SIL">` : SIL}</div>
        <div class="pc-name">${esc(c.name)}</div>
        <div class="pc-stats">${stats}</div>`;
  }
  // 뒷면: 육각형 능력치(위 득점부터 시계 방향). 가운데 40점 ~ 끝 99점, 안쪽 선 60·80점
  const HEX_AX = ['득점', '승리', 'MVP', '경험', '꾸준', '출석'], HEX_LO = 40, HEX_HI = 99;
  const hexR = v => Math.max(0, Math.min(1, (v - HEX_LO) / (HEX_HI - HEX_LO)));
  const hexPt = (cx, cy, R, i, r) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r]; };
  function hexSVG(s) {
    const cx = 120, cy = 78, R = 54, f = n => n.toFixed(1);
    const poly = r => HEX_AX.map((_, i) => hexPt(cx, cy, R, i, r).map(f).join(',')).join(' ');
    const rings = [60, 80, 99].map(v => `<polygon class="pc-hg" points="${poly(hexR(v))}"/>`).join('');
    const axes = HEX_AX.map((_, i) => { const [x, y] = hexPt(cx, cy, R, i, 1); return `<line class="pc-ha" x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}"/>`; }).join('');
    const area = HEX_AX.map((k, i) => hexPt(cx, cy, R, i, hexR(s[k])).map(f).join(',')).join(' ');
    const dots = HEX_AX.map((k, i) => { const [x, y] = hexPt(cx, cy, R, i, hexR(s[k])); return `<circle class="pc-hd" cx="${f(x)}" cy="${f(y)}" r="2.6"/>`; }).join('');
    const labels = HEX_AX.map((k, i) => {
      const [x0, y] = hexPt(cx, cy, R, i, 1), side = Math.abs(x0 - cx) < 2 ? 0 : x0 > cx ? 1 : -1;
      const dy = i === 0 ? -9 : i === 3 ? 20 : 5;
      return `<text text-anchor="${side === 0 ? 'middle' : side > 0 ? 'start' : 'end'}" x="${f(x0 + side * 8)}" y="${f(y + dy)}"><tspan class="pc-hv">${s[k]}</tspan> ${k}</text>`;
    }).join('');
    return `<svg class="pc-hex" viewBox="0 0 240 160" role="img" aria-label="${HEX_AX.map(k => k + ' ' + s[k]).join(', ')}">${rings}${axes}<polygon class="pc-har" points="${area}"/>${dots}${labels}</svg>`;
  }
  function backIn(c, Y) {
    return `${topRow(c, `<div class="pc-ovr">${c.ovr}<small>OVR</small></div>`)}
        <div class="pc-name pc-name-b">${esc(c.name)}</div>
        <div class="pc-hexwrap">${hexSVG(c.stats)}</div>
        <div class="pc-rec">통산 ${c.ap}경기 ${c.goals}골 · ${c.seasons}시즌<br>최근 3시즌 ${c.recAp}경기 ${c.recGoals}골${c.winPct == null ? '' : ' · 승률 ' + c.winPct + '%'}</div>`;
  }

  // ── 카드 이미지 만들기(캔버스에 직접 그림) → 복사·공유·저장 ──
  const TIER_COLORS = {
    gold: ['#F7E3A1', '#D9A93F', '#8A6114', '#3A2806'], silver: ['#F2F4F7', '#B9C0CB', '#6C7480', '#1E2530'],
    bronze: ['#F0C9A3', '#B9773F', '#6A3A14', '#2B1607'], plain: ['#E9ECF2', '#A9B3C4', '#5D6880', '#1B2333'],
    special: ['#2A5FD6', '#113C98', '#071A45', '#FFFFFF']
  };
  const loadImg = src => new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  async function renderCard(c, face) {
    const W = 600, H = 864, t = tier(c), [c1, c2, c3, ink] = TIER_COLORS[t];
    try { await Promise.all(['700 100px Oswald', '900 40px Pretendard', '500 20px Pretendard'].map(f => document.fonts.load(f))); } catch (e) {}
    const [logo, photo] = await Promise.all([loadImg('whistle_logo.svg'), c.photo ? loadImg(c.photo) : null]);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    // 카드 모양(위아래 뾰족한 방패)
    x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W, H * .06); x.lineTo(W, H * .86); x.lineTo(W / 2, H); x.lineTo(0, H * .86); x.lineTo(0, H * .06); x.closePath(); x.clip();
    const ang = 155 * Math.PI / 180, dx = Math.sin(ang) * W / 2, dy = -Math.cos(ang) * H / 2;
    const g = x.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    g.addColorStop(0, c1); g.addColorStop(.48, c2); g.addColorStop(1, c3); x.fillStyle = g; x.fillRect(0, 0, W, H);
    // 빗살·윗빛
    x.save(); x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 2;
    for (let k = -H; k < W + H; k += 26) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k - H * .47, H); x.stroke(); }
    const rg = x.createRadialGradient(W * .2, 0, 0, W * .2, 0, W * 1.1);
    rg.addColorStop(0, t === 'special' ? 'rgba(255,215,90,.5)' : 'rgba(255,255,255,.5)'); rg.addColorStop(.55, 'rgba(255,255,255,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H); x.restore();
    const L = W * .08, R = W - L;
    // 사진(아래로 갈수록 흐려짐) 또는 실루엣 — 뒷면은 육각형
    const pTop = H * .17, pBot = H * .58, pH = pBot - pTop;
    const back = face === 'back' && c.ovr != null;
    if (back) { /* 아래에서 그림 */ } else if (photo) {
      const s = Math.min((R - L) / photo.width, pH / photo.height), pw = photo.width * s, ph = photo.height * s;
      const o = document.createElement('canvas'); o.width = W; o.height = H; const ox = o.getContext('2d');
      ox.shadowColor = 'rgba(0,0,0,.35)'; ox.shadowBlur = 16; ox.shadowOffsetY = 10;
      ox.drawImage(photo, (W - pw) / 2, pBot - ph, pw, ph);
      ox.shadowColor = 'transparent'; ox.globalCompositeOperation = 'destination-in';
      const fg = ox.createLinearGradient(0, 0, 0, H);
      fg.addColorStop(0, '#000'); fg.addColorStop((pBot - ph * .14) / H, '#000'); fg.addColorStop(pBot / H, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      ox.fillStyle = fg; ox.fillRect(0, 0, W, H);
      x.drawImage(o, 0, 0);
    } else {
      x.save(); x.globalAlpha = .38; x.fillStyle = ink; const sh = pH * .92, sx = W / 2, sy = pBot - sh;
      x.beginPath(); x.arc(sx, sy + sh * .34, sh * .2, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.moveTo(sx - sh * .4, pBot); x.bezierCurveTo(sx - sh * .38, sy + sh * .62, sx - sh * .2, sy + sh * .62, sx, sy + sh * .62);
      x.bezierCurveTo(sx + sh * .2, sy + sh * .62, sx + sh * .38, sy + sh * .62, sx + sh * .4, pBot); x.closePath(); x.fill(); x.restore();
    }
    // 위: 점수 / 로고·등번호
    x.fillStyle = ink; x.textBaseline = 'alphabetic';
    if (c.ovr == null) { x.font = '700 92px Oswald, sans-serif'; x.fillText(String(c.ap), L, H * .06 + 92); x.font = '700 26px Oswald, sans-serif'; x.fillText('경기', L + 2, H * .06 + 128); }
    else { x.font = '700 124px Oswald, sans-serif'; x.fillText(String(c.ovr), L - 4, H * .06 + 112); x.font = '700 30px Oswald, sans-serif'; x.fillText('O V R', L, H * .06 + 150); }
    const ls = W * .12;
    if (logo) { x.save(); x.translate(R, H * .07); x.scale(-1, 1); x.drawImage(logo, 0, 0, ls, ls); x.restore(); }
    x.textAlign = 'right'; x.font = '700 58px Oswald, sans-serif'; if (c.num != null) x.fillText(String(c.num), R, H * .07 + ls + 58);
    if (back) {
      x.textAlign = 'center'; x.font = '900 52px Pretendard, sans-serif'; x.fillText(c.name, W / 2, H * .30);
      x.fillRect(L, H * .322, R - L, 2);
      const cx = W / 2, cy = H * .54, RR = W * .19;
      const path = r => { x.beginPath(); HEX_AX.forEach((_, i) => { const [px, py] = hexPt(cx, cy, RR, i, r); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); };
      x.save(); x.strokeStyle = ink; x.globalAlpha = .22; x.lineWidth = 2; [60, 80, 99].forEach(v => { path(hexR(v)); x.stroke(); });
      x.globalAlpha = .18; HEX_AX.forEach((_, i) => { const [px, py] = hexPt(cx, cy, RR, i, 1); x.beginPath(); x.moveTo(cx, cy); x.lineTo(px, py); x.stroke(); }); x.restore();
      x.beginPath(); HEX_AX.forEach((k, i) => { const [px, py] = hexPt(cx, cy, RR, i, hexR(c.stats[k])); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath();
      x.save(); x.globalAlpha = .28; x.fillStyle = ink; x.fill(); x.restore(); x.strokeStyle = ink; x.lineWidth = 4; x.lineJoin = 'round'; x.stroke();
      x.fillStyle = ink; HEX_AX.forEach((k, i) => { const [px, py] = hexPt(cx, cy, RR, i, hexR(c.stats[k])); x.beginPath(); x.arc(px, py, 6, 0, Math.PI * 2); x.fill(); });
      HEX_AX.forEach((k, i) => {
        const [x0, y0] = hexPt(cx, cy, RR, i, 1), side = Math.abs(x0 - cx) < 2 ? 0 : x0 > cx ? 1 : -1, lx = x0 + side * 18, ly = y0 + (i === 0 ? -20 : i === 3 ? 44 : 12);
        x.font = '700 40px Oswald, sans-serif'; const nv = String(c.stats[k]), nw = x.measureText(nv).width; x.font = '700 26px Pretendard, sans-serif'; const kw = x.measureText(' ' + k).width;
        const start = side === 0 ? lx - (nw + kw) / 2 : side > 0 ? lx : lx - nw - kw;
        x.textAlign = 'left'; x.font = '700 40px Oswald, sans-serif'; x.fillText(nv, start, ly); x.font = '700 26px Pretendard, sans-serif'; x.fillText(' ' + k, start + nw, ly);
      });
      x.textAlign = 'center'; x.font = '500 24px Pretendard, sans-serif'; x.globalAlpha = .85;
      x.fillText(`통산 ${c.ap}경기 ${c.goals}골 · ${c.seasons}시즌`, W / 2, H * .78);
      x.fillText(`최근 3시즌 ${c.recAp}경기 ${c.recGoals}골${c.winPct == null ? '' : ' · 승률 ' + c.winPct + '%'}`, W / 2, H * .815); x.globalAlpha = 1;
      const out = document.createElement('canvas'); out.width = W + 48; out.height = H + 48; out.getContext('2d').drawImage(cv, 24, 24);
      return new Promise(res => out.toBlob(res, 'image/png'));
    }
    // 이름·줄
    x.textAlign = 'center'; x.font = '900 52px Pretendard, sans-serif'; x.fillText(c.name, W / 2, H * .645);
    x.fillRect(L, H * .667, R - L, 2);
    // 능력치 2열(가운데 맞춤)
    const rows = c.ovr == null ? [['통산 출전', c.ap], ['통산 골', c.goals], ['시즌', c.seasons], ['MVP', c.mvpAll]] : ORDER.map(k => [k, c.stats[k]]);
    x.font = '500 30px Pretendard, sans-serif'; const lw = Math.max(...rows.map(r => x.measureText(r[0]).width));
    const numW = 62, gap = 12, colW = numW + gap + lw, cg = 36, x0 = W / 2 - (colW * 2 + cg * 2) / 2;
    rows.forEach(([k, v], i) => {
      const col = i % 2, row = Math.floor(i / 2), bx = x0 + col * (colW + cg * 2), by = H * .725 + row * 52;
      x.textAlign = 'right'; x.font = '700 44px Oswald, sans-serif'; x.fillText(String(v), bx + numW, by);
      x.textAlign = 'left'; x.font = '500 30px Pretendard, sans-serif'; x.fillText(k, bx + numW + gap, by);
    });
    x.globalAlpha = .35; x.fillRect(W / 2 - 1, H * .69, 2, Math.ceil(rows.length / 2) * 52); x.globalAlpha = 1;
    // 바깥 여백(투명) 붙여 저장
    const out = document.createElement('canvas'); out.width = W + 48; out.height = H + 48;
    out.getContext('2d').drawImage(cv, 24, 24);
    return new Promise(res => out.toBlob(res, 'image/png'));
  }

  async function copyCard(c, face, note) {
    const say = (m) => { note.textContent = m; };
    const blobP = renderCard(c, face);
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
      say('카드 이미지를 복사했습니다. 카톡 대화창에 붙여넣기 하세요.');
      return;
    } catch (e) {}
    const blob = await blobP;
    const file = new File([blob], `휘슬카드_${c.name}${face === 'back' ? '_능력치' : ''}.png`, { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); say('공유 창을 열었습니다.'); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('이 브라우저는 복사가 안 돼서 이미지 파일로 저장했습니다.');
  }

  // ── 내 사진 바꾸기: 휴대폰 사진 → (HEIC면 변환) → 줄이기 → 배경 지우기 → 머리부터 정사각형 → 올리기 ──
  // 선수당 사진은 최대 2장(지금 + 바로 전). 저장 공간 규칙이 3장째를 막고, 올리기 전에 오래된 것을 지운다.
  const SB = 'https://sgzanwxgdcyojcoskseo.supabase.co', SBK = 'sb_publishable_tHW4O3rv3B0hk1p-v4s7gg_MLc2BeN4';
  const SBH = { apikey: SBK, Authorization: 'Bearer ' + SBK };
  const photoURL = path => `${SB}/storage/v1/object/public/player-photos/${path}`;
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const isHeic = f => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '');

  async function decodeImage(file) {
    // 아이폰은 사진 고르기에서 보통 JPEG로 바꿔 주지만, HEIC 그대로 오면(갤럭시 고효율 사진 등) 변환
    const tryDecode = async blob => {
      if (window.createImageBitmap) { try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) {} }
      const url = URL.createObjectURL(blob);
      try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    };
    try { return await tryDecode(file); } catch (e) {
      if (!isHeic(file)) throw new Error('이 사진 형식은 열 수 없습니다. JPG나 PNG 사진으로 다시 골라 주세요.');
    }
    if (!window.heic2any) await loadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
    const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return tryDecode(Array.isArray(out) ? out[0] : out);
  }
  const toBlob = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q));

  async function makePhoto(file, say) {
    say('사진 여는 중...');
    const img = await decodeImage(file);
    const w0 = img.width, h0 = img.height, k = Math.min(1, 1600 / Math.max(w0, h0));
    const c1 = document.createElement('canvas'); c1.width = Math.round(w0 * k); c1.height = Math.round(h0 * k);
    c1.getContext('2d').drawImage(img, 0, 0, c1.width, c1.height);
    const small = await toBlob(c1, 'image/jpeg', 0.92);
    say('배경 지우는 중... 처음 한 번은 준비 파일을 받느라 20~30초 걸립니다.');
    const lib = await import('https://esm.sh/@imgly/background-removal@1.4.5');
    const removeBackground = lib.removeBackground || lib.default;
    let lastPct = -1;
    const cut = await removeBackground(small, {
      model: 'small', output: { format: 'image/png' },
      progress: (key, cur, total) => { if (/fetch/.test(key) && total) { const p = Math.round(cur / total * 100); if (p !== lastPct && p % 10 === 0) { lastPct = p; say(`배경 지우기 준비 중... ${p}%`); } } }
    });
    say('카드에 맞게 자르는 중...');
    const ci = await decodeImage(cut);
    const c2 = document.createElement('canvas'); c2.width = ci.width; c2.height = ci.height;
    const x2 = c2.getContext('2d'); x2.drawImage(ci, 0, 0);
    const a = x2.getImageData(0, 0, c2.width, c2.height).data;
    let top = -1, left = c2.width, right = -1;
    for (let y = 0; y < c2.height; y++) for (let x = 0; x < c2.width; x++) {
      if (a[(y * c2.width + x) * 4 + 3] > 80) { if (top < 0) top = y; if (x < left) left = x; if (x > right) right = x; }
    }
    if (top < 0) throw new Error('사람을 찾지 못했습니다. 얼굴과 상반신이 잘 보이는 사진으로 골라 주세요.');
    left = Math.max(0, left - 10); right = Math.min(c2.width - 1, right + 10); top = Math.max(0, top - 10);
    const w = right - left + 1, h = Math.min(c2.height - top, Math.round(w * 1.05));
    const s = Math.min(1, 480 / w), c3 = document.createElement('canvas'); c3.width = Math.round(w * s); c3.height = Math.round(h * s);
    c3.getContext('2d').drawImage(c2, left, top, w, h, 0, 0, c3.width, c3.height);
    let out = await toBlob(c3, 'image/webp', 0.84);
    if (!out || out.type !== 'image/webp') out = await toBlob(c3, 'image/png');   // 사파리는 webp로 못 만들면 png
    return out;
  }

  async function uploadPhoto(pid, blob, say) {
    say('올리는 중...');
    const json = { ...SBH, 'Content-Type': 'application/json' };
    // 2장 제한: 이미 2장이면 오래된 것부터 지움(지금 쓰는 사진·최신은 규칙상 안 지워짐)
    const list = await fetch(`${SB}/storage/v1/object/list/player-photos`, { method: 'POST', headers: json,
      body: JSON.stringify({ prefix: pid + '/', sortBy: { column: 'created_at', order: 'asc' } }) }).then(r => r.ok ? r.json() : []);
    const files = (list || []).filter(f => f.name && f.id);
    for (const f of files.slice(0, Math.max(0, files.length - 1))) {
      await fetch(`${SB}/storage/v1/object/player-photos`, { method: 'DELETE', headers: json, body: JSON.stringify({ prefixes: [`${pid}/${f.name}`] }) });
    }
    const ext = blob.type === 'image/webp' ? 'webp' : 'png', path = `${pid}/${Date.now()}.${ext}`;
    const up = await fetch(`${SB}/storage/v1/object/player-photos/${path}`, { method: 'POST', headers: { ...SBH, 'Content-Type': blob.type }, body: blob });
    if (!up.ok) throw new Error('사진을 올리지 못했습니다. 잠시 후 다시 해 주세요.');
    const row = await fetch(`${SB}/rest/v1/player_photos?on_conflict=player_id`, { method: 'POST',
      headers: { ...json, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ player_id: pid, path, updated_at: new Date().toISOString() }) });
    if (!row.ok) throw new Error('사진 정보를 저장하지 못했습니다. 잠시 후 다시 해 주세요.');
    return photoURL(path);
  }

  function close() {
    if (!stage) return;
    stage.remove(); stage = null; document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function show(c, fromEl, Y, app) {
    close();
    window.WhistleCard.last = c;
    lastFocus = fromEl;
    const r = fromEl ? fromEl.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const w = Math.min(innerWidth * 0.78, (innerHeight - 170) / 1.44, 340);
    // 사진 바꾸기는 이 기기에서 고른 '내 이름'(참석 응답용) 카드에서만
    const myId = app && app.state ? Number(app.state.me) || null : null;
    stage = document.createElement('div');
    stage.className = 'pc-stage';
    stage.setAttribute('role', 'dialog'); stage.setAttribute('aria-modal', 'true'); stage.setAttribute('aria-label', c.name + ' 선수 카드');
    const sub = c.ovr == null
      ? `통산 ${c.ap}경기 ${c.goals}골 · ${c.seasons}시즌<br>최근 3시즌 ${MIN_APPS}경기 이상이면 능력치 카드가 됩니다`
      : `통산 ${c.ap}경기 ${c.goals}골 · ${c.seasons}시즌<br>최근 3시즌(${Y - 2}~${Y}) ${c.recAp}경기 ${c.recGoals}골${c.winPct == null ? '' : ' · 승률 ' + c.winPct + '%'}`;
    stage.innerHTML = cardHTML(c) + `<div class="pc-sub">${sub}</div><div class="pc-btns">${c.ovr == null ? '' : '<button type="button" class="pc-flipb">뒤집기</button>'}<button type="button" class="pc-copy">이미지 복사</button><button type="button" class="pc-close">닫기</button></div><div class="pc-note" aria-live="polite"></div>${!c.id ? '' : !myId ? '<div class="pc-uphint">홈에서 “내 이름 선택하기”를 하면 내 카드 사진을 바꿀 수 있어요</div>' : myId !== c.id ? '' : '<button type="button" class="pc-upb">내 사진 바꾸기</button><div class="pc-uphint">혼자 나온 상반신 사진이 잘 나와요 · 배경은 자동으로 지워져요</div><input type="file" class="pc-file" accept="image/*" hidden>'}`;
    const big = stage.querySelector('.pc-card');
    big.style.setProperty('--w', w + 'px');
    const cx = innerWidth / 2, cy = innerHeight / 2 - 40;
    big.style.setProperty('--dx', (r.left + r.width / 2 - cx) + 'px');
    big.style.setProperty('--dy', (r.top + r.height / 2 - cy) + 'px');
    stage.querySelector('.pc-close').onclick = close;
    const cb = stage.querySelector('.pc-copy');
    let face = 'front', busy = true;
    setTimeout(() => { busy = false; }, 1250);   // 날아오는 동안은 뒤집기 막음
    const inner = big.querySelector('.pc-in'); let frontHTML = inner.innerHTML;
    const flip = () => {
      if (busy || c.ovr == null) return; busy = true;
      big.classList.remove('pc-turn-b'); big.classList.add('pc-turn-a');
      setTimeout(() => {
        face = face === 'front' ? 'back' : 'front';
        inner.innerHTML = face === 'back' ? backIn(c, Y) : frontHTML; big.classList.toggle('pc-back', face === 'back');
        big.classList.remove('pc-turn-a'); big.classList.add('pc-turn-b');
        setTimeout(() => { busy = false; }, 240);
      }, 180);
    };
    big.addEventListener('click', flip);
    const fb = stage.querySelector('.pc-flipb'); if (fb) fb.onclick = flip;
    const upb = stage.querySelector('.pc-upb'), fin = stage.querySelector('.pc-file'), note = stage.querySelector('.pc-note');
    if (upb) {
      upb.onclick = () => { if (busy) return; fin.value = ''; fin.click(); };
      fin.onchange = async () => {
        const f = fin.files && fin.files[0]; if (!f) return;
        upb.disabled = true; const say = m => { note.textContent = m; };
        try {
          const blob = await makePhoto(f, say);
          const url = await uploadPhoto(c.id, blob, say);
          c.photo = url; if (cache && cache.cards[c.name]) cache.cards[c.name].photo = url;
          const html = `<img src="${esc(url)}" alt="">`;
          const tmp = document.createElement('div'); tmp.innerHTML = frontHTML; const ph = tmp.querySelector('.pc-photo'); ph.className = 'pc-photo pc-cut'; ph.innerHTML = html; frontHTML = tmp.innerHTML;
          if (face === 'front') inner.innerHTML = frontHTML;
          say('사진을 바꿨습니다. 다른 사람 화면에는 새로고침 후 보입니다.');
        } catch (e) { say((e && e.message && /[가-힣]/.test(e.message)) ? e.message : '사진을 바꾸지 못했습니다. 다른 사진으로 다시 해 주세요.'); }
        finally { upb.disabled = false; }
      };
    }
    cb.onclick = () => { cb.disabled = true; copyCard(c, face, stage.querySelector('.pc-note')).finally(() => { cb.disabled = false; }); };
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
      show(c, fromEl, cache.Y, app);
    },
    reset() { cache = null; loading = null; },
    SIL,
    renderCard,   // 확인용
    makePhoto
  };
})();
