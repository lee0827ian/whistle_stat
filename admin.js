// WHISTLE FC 운영진 관리 — admin.js
// Claude Design "Admin.dc.html"(프로젝트 7704b360)의 로직을 옮기고, 견본 데이터 자리를 Supabase 조회·저장으로 바꿨다.
// 화면은 메인 사이트(script.js)와 같은 소형 템플릿 렌더러로 그린다. 상태가 바뀌면 renderVals() → 전체 다시 그림.
// 글자 입력칸은 칠 때마다 다시 그리지 않는다(한글 조합·저장 버튼 클릭 보호). 입력값은 상태에 조용히 담고 저장 때 쓴다.

// ── 템플릿 렌더러(script.js와 같음) ──
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
const interpolate = (str, scope) => str.replace(HOLE, (_, path) => { const v = lookup(scope, path); return v == null ? '' : String(v); });
const pathOf = attr => (attr || '').replace(/[{}\s]/g, '');
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
      list.forEach((item, index) => { const inner = Object.create(scope); inner[as] = item; inner.$index = index; renderNodes(parent, node.childNodes, inner); });
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
      if (name.startsWith('hint-') || name.startsWith('style-')) continue;
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
    if (pendingValue !== undefined) el.value = pendingValue == null ? '' : pendingValue;
    parent.appendChild(el);
  }
}

// ── 설정 ──
const SB_URL = 'https://sgzanwxgdcyojcoskseo.supabase.co';
const SB_KEY = 'sb_publishable_tHW4O3rv3B0hk1p-v4s7gg_MLc2BeN4';
// 운영진 계정 이메일 — 화면엔 PIN 칸만 있고, 실제 로그인은 이 이메일 + PIN(=계정 비밀번호)으로 Supabase에 한다
const ADMIN_EMAIL = 'whistle@naver.com';
const KAKAO_KEY = '47eed652b004605d8a8e3e39df268f24';
const RT_KEY = 'whistle_admin_rt';
const REGION_SEP = ' | ';   // 경기 장소는 지금처럼 '지역 | 장소' 한 칸으로 저장
const REGIONS = ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구',
  '고양시','광명시','구리시','군포시','김포시','남양주시','부천시','성남시','수원시','시흥시','안양시','양주시','양평군','용인시','의왕시','의정부시','파주시','평택시','하남시'];

// ── 도우미(디자인과 같음) ──
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const cho = s => [...s].map(ch => { const c = ch.charCodeAt(0) - 44032; return c > -1 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join('');
const matchName = (name, q) => { if (!q) return true; const n = name.replace(/\s/g, '').toLowerCase(), k = q.replace(/\s/g, '').toLowerCase(); return n.includes(k) || cho(n).includes(k); };
const DOW = ['일','월','화','수','목','금','토'];
const d = s => new Date(s + 'T00:00:00');
const fmtShort = s => { const x = d(s); return String(x.getMonth() + 1).padStart(2, '0') + '.' + String(x.getDate()).padStart(2, '0') + ' (' + DOW[x.getDay()] + ')'; };
const fmtLong = s => { const x = d(s); return x.getFullYear() + '년 ' + (x.getMonth() + 1) + '월 ' + x.getDate() + '일 ' + DOW[x.getDay()] + '요일'; };
const nowHM = () => { const t = new Date(); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
const localDate = () => { const n = new Date(); return new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// 킥오프가 지났는지(메인 사이트와 같은 기준) — 시간이 비어 있으면 그날 하루는 다가오는 경기로 본다
const isPast = s => s.date < localDate() || (s.date === localDate() && !!s.time && s.time.slice(0, 5) <= nowHM());
const RES = { win: ['승', '#E4F5EA', '#15803D'], draw: ['무', '#FAF3DC', '#A5841B'], loss: ['패', '#FBE9E9', '#C0392B'] };
const sw = on => ({ bg: on ? '#113C98' : '#D9D5CA', knob: on ? '23px' : '3px' });
const regionOf = text => REGIONS.find(r => (text || '').includes(r)) || '';
const splitVenue = v => {
  const s = (v || '').trim();
  if (s.includes(REGION_SEP)) { const [r, ...rest] = s.split(REGION_SEP); return { region: r.trim(), venue: rest.join(REGION_SEP).trim() }; }
  return { region: '', venue: s };
};
const joinVenue = (region, venue) => (region && venue ? region + REGION_SEP + venue : venue || region || '');
const isTyping = () => { const a = document.activeElement; return !!a && /INPUT|TEXTAREA/.test(a.tagName) && a.type !== 'checkbox'; };

class AdminApp {
  constructor() {
    this.state = {
      booting: true, tab: 'games', view: null, loggedOut: false, byLogout: false,
      pin: '', keep: true, pinErr: '', fails: 0, lockUntil: 0,
      players: [], matches: [], schedules: [], next: null, mgrs: [], apps3: {},
      form: null, sched: null, dirty: false, save: 'idle', savedAt: '', q: '', pq: '',
      rowMsg: {}, mvpHidden: null, seasonMsg: {}, toast: null, sheet: false, newNum: '', newName: '', sheetErr: '', sheetBusy: false
    };
    this.token = null; this.rt = null; this.exp = 0;
  }

  // ── 화면 갱신 ──
  setState(update) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    if (!patch) return;
    this.state = { ...this.state, ...patch };
    this.render();
  }
  quiet(patch) { this.state = { ...this.state, ...patch }; }   // 다시 그리지 않고 상태만(글자 입력)
  render() {
    if (this._composing) { this._dirtyRender = true; return; }   // 한글 조합 중엔 미룸
    const a = document.activeElement;
    const keep = a && this.root.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) ? this.pathTo(a) : null;
    const sel = keep && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    const frag = document.createDocumentFragment();
    renderNodes(frag, this.template.childNodes, this.renderVals());
    this.root.replaceChildren(frag);
    if (keep) {   // 다시 그린 뒤에도 쓰던 입력칸에 커서를 돌려놓음
      const el = this.nodeAt(keep);
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    }
    this.afterRender();
  }
  pathTo(el) { const p = []; while (el && el !== this.root) { p.unshift([...el.parentNode.children].indexOf(el)); el = el.parentNode; } return p; }
  nodeAt(p) { let el = this.root; for (const i of p) { el = el && el.children[i]; } return el; }
  mount(root, tpl) {
    this.root = root; this.template = tpl.content;
    document.addEventListener('compositionstart', () => { this._composing = true; });
    document.addEventListener('compositionend', () => { this._composing = false; if (this._dirtyRender) { this._dirtyRender = false; setTimeout(() => this.render(), 0); } });
    const dl = document.getElementById('regionOptions');
    if (dl) dl.innerHTML = REGIONS.map(r => `<option value="${r}"></option>`).join('');
    this.render();
    this.boot();
  }

  toast(type, msg, sub) {
    clearTimeout(this._tt);
    this.setState({ toast: { type, msg, sub } });
    if (type === 'ok') this._tt = setTimeout(() => this.setState({ toast: null }), 2600);
  }

  // ── 로그인(겉은 PIN, 속은 Supabase 계정 로그인) ──
  async authCall(grant, body) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error_description || data.msg || 'auth ' + res.status); e.status = res.status; throw e; }
    return data;
  }
  setSession(data, keep) {
    this.token = data.access_token; this.rt = data.refresh_token; this.exp = Date.now() + (data.expires_in || 3600) * 1000;
    try {
      localStorage.removeItem(RT_KEY); sessionStorage.removeItem(RT_KEY);
      (keep ? localStorage : sessionStorage).setItem(RT_KEY, this.rt);
      this._keep = keep;
    } catch (e) {}
    clearTimeout(this._rtTimer);   // 만료 1분 전에 미리 연장(관리자 화면을 오래 켜 둬도 저장이 실패하지 않게)
    this._rtTimer = setTimeout(() => this.refresh(), Math.max(10000, this.exp - Date.now() - 60000));
  }
  async refresh() {
    let rt = this.rt;
    try { rt = rt || localStorage.getItem(RT_KEY) || sessionStorage.getItem(RT_KEY); this._keep = this._keep ?? !!localStorage.getItem(RT_KEY); } catch (e) {}
    if (!rt) return false;
    try { this.setSession(await this.authCall('refresh_token', { refresh_token: rt }), this._keep !== false); return true; }
    catch (e) { if (e.status === 400 || e.status === 401) this.clearSession(); return false; }
  }
  clearSession() {
    this.token = null; this.rt = null; this.exp = 0; clearTimeout(this._rtTimer);
    try { localStorage.removeItem(RT_KEY); sessionStorage.removeItem(RT_KEY); } catch (e) {}
  }
  async boot() {
    const ok = await this.refresh();
    if (ok) { this.setState({ booting: false, loggedOut: false }); this.loadAll(); }
    else this.setState({ booting: false, loggedOut: true });
  }
  async tryLogin() {
    const s = this.state;
    const input = document.getElementById('pinInput');
    const pin = ((input && input.value) || s.pin).replace(/\D/g, '');
    if (Date.now() < s.lockUntil) { this.setState({ pinErr: '잠시 후 다시 시도해주세요' }); return; }
    if (pin.length < 6) { this.setState({ pin, pinErr: 'PIN은 6~8자리 숫자예요' }); return; }
    if (!ADMIN_EMAIL) { this.setState({ pin: '', pinErr: '운영진 계정이 아직 설정되지 않았어요' }); return; }
    try {
      const data = await this.authCall('password', { email: ADMIN_EMAIL, password: pin });
      this.setSession(data, s.keep);
      const resume = !!s.view;   // 저장 중 로그인이 풀렸던 경우 쓰던 화면으로 돌아감
      this.setState({ loggedOut: false, byLogout: false, pin: '', pinErr: '', fails: 0 });
      if (resume) this.toast('ok', '다시 로그인했어요', '저장 버튼을 다시 눌러주세요.');
      this.loadAll();
    } catch (e) {
      if (e.status === 429) { this.setState({ pin: '', lockUntil: Date.now() + 30000, pinErr: '잠시 후 다시 시도해주세요' }); return; }
      if (e.status && e.status < 500) {
        const fails = s.fails + 1;
        if (fails >= 5) { this.setState({ fails: 0, pin: '', lockUntil: Date.now() + 30000, pinErr: '잠시 후 다시 시도해주세요' }); clearTimeout(this._lt); this._lt = setTimeout(() => this.setState({ pinErr: '' }), 30000); }
        else this.setState({ fails, pin: '', pinErr: 'PIN이 맞지 않아요' });
      } else this.setState({ pin: '', pinErr: '연결이 원활하지 않아요. 잠시 후 다시 시도해주세요' });
    }
  }
  logout() {
    if (!window.confirm('로그아웃할까요?')) return;
    const rt = this.rt, token = this.token;
    this.clearSession();
    if (token) fetch(`${SB_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token } }).catch(() => {});
    this.setState({ loggedOut: true, byLogout: true, pin: '', pinErr: '', view: null, form: null, sched: null, dirty: false, toast: null });
    void rt;
  }
  // 저장 중 로그인이 풀리면: 입력은 그대로 두고 PIN 화면을 띄움
  sessionLost() {
    this.clearSession();
    this.setState({ loggedOut: true, byLogout: false, save: 'idle' });
    this.toast('err', '다시 로그인해주세요', '입력한 내용은 남아 있어요.');
  }

  // ── DB ──
  async api(method, path, body, prefer) {
    if (!this.token || Date.now() > this.exp - 30000) await this.refresh();
    const go = () => fetch(`${SB_URL}/rest/v1/${path}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + (this.token || SB_KEY), 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' }
    });
    let res = await go();
    if (res.status === 401 && await this.refresh()) res = await go();
    if (res.status === 401) { this.sessionLost(); const e = new Error('auth'); e.auth = true; throw e; }
    if (!res.ok) { const e = new Error(await res.text()); e.status = res.status; throw e; }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async apiAll(path) {
    const rows = [], sep = path.includes('?') ? '&' : '?';
    for (let off = 0; ; off += 1000) {
      const b = await this.api('GET', `${path}${sep}limit=1000&offset=${off}`);
      rows.push(...b);
      if (b.length < 1000) return rows;
    }
  }
  // id 하나를 고치는 요청은 실제로 1건이 바뀌었는지 확인(0건이면 '완료'라고 하지 않음)
  async apiOne(method, path, body) {
    const r = await this.api(method, path, body);
    if (!Array.isArray(r) || r.length !== 1) throw new Error('바뀐 기록이 없어요');
    return r[0];
  }

  async loadAll() {
    try {
      const year = Number(localDate().slice(0, 4));
      const [players, mgrs, schedules, matches, apps] = await Promise.all([
        this.apiAll('players?select=id,name,number,active&order=id.asc'),
        this.api('GET', 'rsvp_managers?select=player_id'),
        this.api('GET', 'schedules?select=id,date,time,opponent,venue,address,note&order=date.asc'),
        this.api('GET', 'matches?select=id,date,opponent,venue,our_score,opp_score&order=date.desc,id.desc&limit=120'),
        this.apiAll(`match_lineups?select=player_id,matches!inner(season,date)&matches.season=gte.${year - 2}&player_id=not.is.null&order=id.asc`)
      ]);
      const apps3 = {}, recent = {};
      const since2y = String(year - 2) + localDate().slice(4);   // 오늘로부터 2년 전
      apps.forEach(l => {
        apps3[l.player_id] = (apps3[l.player_id] || 0) + 1;
        if (l.matches && l.matches.date >= since2y) recent[l.player_id] = true;
      });
      const mgrSet = new Set(mgrs.map(m => m.player_id));
      this.setState({
        players: players.map(p => ({ id: p.id, num: p.number == null ? '' : String(p.number), name: p.name, active: p.active !== false, mgr: mgrSet.has(p.id), apps3: apps3[p.id] || 0, recent: !!recent[p.id] })),
        schedules, matches
      });
      this.loadNext();
      this.loadMvpHidden();
    } catch (e) { if (!e.auth) this.toast('err', '목록을 불러오지 못했어요', '새로고침해 주세요.'); }
  }
  async loadNext() {
    const n = this.state.schedules.find(s => !isPast(s));
    if (!n) { this.setState({ next: null }); return; }
    try {
      const rows = await this.api('GET', `schedule_rsvps?schedule_id=eq.${n.id}&select=player_id,status,guests`);
      this.setState({ next: { ...n, rsvp: rows } });
    } catch (e) { this.setState({ next: { ...n, rsvp: [] } }); }
  }
  async loadMvpHidden() {
    try { const r = await this.api('GET', 'mvp_hidden_seasons?select=season'); this.setState({ mvpHidden: r.map(x => x.season) }); }
    catch (e) { if (!e.auth) this.setState({ mvpHidden: 'missing' }); }
  }

  // 지난 경기 목록 = 저장된 경기 + 킥오프가 지났는데 같은 날짜 경기 기록이 없는 일정(결과 입력 필요)
  pastList() {
    const s = this.state, have = new Set(s.matches.map(m => m.date));
    const pending = s.schedules.filter(x => isPast(x) && !have.has(x.date)).map(x => ({ kind: 'pending', date: x.date, opp: x.opponent || '', venue: x.venue || '', sched: x }));
    const saved = s.matches.map(m => ({ kind: 'match', date: m.date, opp: m.opponent, venue: splitVenue(m.venue).venue, our: m.our_score, their: m.opp_score, match: m }));
    return [...pending, ...saved].sort((a, b) => b.date.localeCompare(a.date));
  }

  // ── 경기 기록 화면 ──
  async openMatch(row) {
    this.quiet({ q: '' });
    if (row.kind === 'pending') {
      const x = row.sched;
      let rsvp = [];
      try { rsvp = await this.api('GET', `schedule_rsvps?schedule_id=eq.${x.id}&select=player_id,status,guests`); } catch (e) { if (e.auth) return; }
      const attend = rsvp.filter(r => r.status === 'attend').map(r => r.player_id);
      const guests = rsvp.reduce((a, r) => a + (r.guests || 0), 0);
      let region = regionOf(x.address);
      if (!region && x.venue) region = await this.venueRegion(x.venue);
      const lineup = {}; attend.forEach(i => { lineup[i] = true; });
      this.setState({ view: 'match', dirty: false, save: 'idle', toast: null, form: {
        id: null, date: x.date, opp: x.opponent || '', our: 0, their: 0, merc: guests, region, venue: x.venue || '',
        lineup, goals: [], mvp: null, pre: attend.length, isNew: true, schedId: x.id
      } });
    } else {
      const m = row.match;
      let lu = [], gl = [], mv = [];
      try {
        [lu, gl, mv] = await Promise.all([
          this.api('GET', `match_lineups?match_id=eq.${m.id}&select=player_id,is_mercenary`),
          this.api('GET', `match_goals?match_id=eq.${m.id}&select=player_id,is_mercenary,goal_type&order=id.asc`),
          this.api('GET', `match_mvps?match_id=eq.${m.id}&select=player_id,raw_name`)
        ]);
      } catch (e) { if (!e.auth) this.toast('err', '경기 기록을 불러오지 못했어요'); return; }
      const lineup = {}; lu.filter(l => !l.is_mercenary && l.player_id).forEach(l => { lineup[l.player_id] = true; });
      const counts = new Map();
      gl.forEach(g => { const k = g.goal_type === 'own_goal' ? 'og' : g.player_id ? String(g.player_id) : 'merc'; counts.set(k, (counts.get(k) || 0) + 1); });
      const mvRow = mv[0];
      const mvp = mvRow ? (mvRow.player_id || (this.state.players.find(p => p.name === mvRow.raw_name) || {}).id || null) : null;
      const { region, venue } = splitVenue(m.venue);
      this.setState({ view: 'match', dirty: false, save: 'idle', toast: null, form: {
        id: m.id, date: m.date, opp: m.opponent, our: m.our_score ?? 0, their: m.opp_score ?? 0, merc: lu.filter(l => l.is_mercenary).length,
        region, venue, lineup, goals: [...counts].map(([pid, n]) => ({ pid, n })), mvp, pre: 0, isNew: false
      } });
    }
    window.scrollTo(0, 0);
  }
  async venueRegion(venue) {
    try { const r = await this.api('GET', `venue_regions?venue=eq.${encodeURIComponent(venue)}&select=region&limit=1`); return (r[0] && r[0].region) || ''; }
    catch (e) { return ''; }
  }
  // edit: false=새 일정, true=다음 경기, 일정 객체=그 일정(이후 일정 목록에서)
  openSchedule(edit) {
    const n = edit && typeof edit === 'object' ? edit : edit ? this.state.next : null;
    this.setState({ view: 'schedule', dirty: false, save: 'idle', toast: null, sched: n
      ? { id: n.id, date: n.date, time: (n.time || '').slice(0, 5), opp: n.opponent || '', venue: n.venue || '', address: n.address || '', note: n.note || '', isEdit: true, tried: false }
      : { id: null, date: '', time: '12:00', opp: '', venue: '', address: '', note: '', isEdit: false, tried: false } });
    window.scrollTo(0, 0);
  }
  editF(patch) { this.setState(s => ({ form: { ...s.form, ...patch }, dirty: true, save: s.save === 'saving' ? 'saving' : 'idle' })); }
  // 글자 입력칸: 다시 그리지 않고 담기만(저장 막대 문구는 다음에 그릴 때 반영)
  typeF(patch) { this.quiet({ form: { ...this.state.form, ...patch }, dirty: true }); }
  typeS(patch) { this.quiet({ sched: { ...this.state.sched, ...patch }, dirty: true }); }
  back() {
    if (this.state.dirty && !window.confirm('저장하지 않은 변경 사항이 있어요. 나가면 사라져요. 나갈까요?')) return;
    this.setState({ view: null, form: null, sched: null, dirty: false, save: 'idle', toast: null });
  }

  async save() {
    const s = this.state;
    if (s.save === 'saving') return;
    if (s.view === 'schedule') {
      const f = s.sched;
      if (!f.date || !f.opp.trim()) { this.setState({ sched: { ...f, tried: true } }); this.toast('err', '날짜와 상대팀을 입력해주세요', '빨간 칸을 채운 뒤 다시 저장해주세요.'); return; }
    }
    if (s.view === 'match' && (!s.form.date || !s.form.opp.trim())) { this.toast('err', '날짜와 상대팀을 입력해주세요'); return; }
    if (s.view === 'match') {
      // 득점자 합계와 우리 점수가 다르면 저장 전에 알림(득점자를 모르는 경우도 있어 확인 후 저장은 허용)
      const f = s.form, sum = f.goals.reduce((a, g) => a + (g.pid ? g.n : 0), 0);
      const blank = f.goals.some(g => !g.pid);
      if (sum !== f.our || blank) {
        const msg = (sum !== f.our ? '득점자 합계(' + sum + '골)와 우리 점수(' + f.our + '점)가 일치하지 않아요.' : '')
          + (blank ? (sum !== f.our ? '\n' : '') + '득점자를 고르지 않은 줄이 있어요(저장되지 않아요).' : '')
          + '\n\n그래도 저장할까요?';
        if (!window.confirm(msg)) return;
      }
    }
    this.setState({ save: 'saving', toast: null });
    try {
      if (s.view === 'match') {
        await this.saveMatch(s.form);
        // 경기 기록은 저장하면 관리자 첫 화면(경기 목록)으로
        this.setState({ view: null, form: null, save: 'idle', dirty: false, savedAt: nowHM() });
        window.scrollTo(0, 0);
        return;
      }
      await this.saveSchedule(s.sched);
      this.setState({ save: 'ok', dirty: false, savedAt: nowHM() });
    } catch (e) {
      if (e.auth) return;
      this.setState({ save: 'err' });
      this.toast('err', '저장하지 못했어요', '인터넷 연결을 확인하고 다시 시도해주세요. 입력한 내용은 그대로 남아 있어요.');
    }
  }
  async saveMatch(f) {
    const lineup = this.state.players.filter(p => f.lineup[p.id]);
    const row = { season: Number(f.date.slice(0, 4)), date: f.date, opponent: f.opp.trim(), venue: joinVenue((f.region || '').trim(), (f.venue || '').trim()), our_score: f.our, opp_score: f.their };
    let id = f.id;
    if (id) {
      await this.apiOne('PATCH', `matches?id=eq.${id}`, row);
      await this.api('DELETE', `match_goals?match_id=eq.${id}`, undefined, 'return=minimal');
      await this.api('DELETE', `match_mvps?match_id=eq.${id}`, undefined, 'return=minimal');
      await this.api('DELETE', `match_lineups?match_id=eq.${id}`, undefined, 'return=minimal');
    } else {
      id = (await this.apiOne('POST', 'matches', row)).id;
      this.quiet({ form: { ...this.state.form, id, isNew: false } });   // 다시 저장하면 수정으로
    }
    // 출전·득점은 한 번에 묶어서 보냄(요청 수를 줄여 빠르고, 중간에 끊길 틈이 작음)
    const lu = [...lineup.map(p => ({ match_id: id, player_id: p.id, is_mercenary: false })),
      ...Array.from({ length: f.merc || 0 }, () => ({ match_id: id, player_id: null, is_mercenary: true }))];
    if (lu.length) await this.api('POST', 'match_lineups', lu, 'return=minimal');
    const goals = [];
    f.goals.filter(g => g.pid).forEach(g => {
      for (let i = 0; i < g.n; i++) {
        if (g.pid === 'og') goals.push({ match_id: id, player_id: null, is_mercenary: false, goal_type: 'own_goal' });
        else if (g.pid === 'merc') goals.push({ match_id: id, player_id: null, is_mercenary: true, goal_type: 'normal' });
        else goals.push({ match_id: id, player_id: Number(g.pid), is_mercenary: false, goal_type: 'normal' });
      }
    });
    if (goals.length) await this.api('POST', 'match_goals', goals, 'return=minimal');
    const mvp = f.mvp && this.state.players.find(p => p.id === f.mvp);
    if (mvp) await this.api('POST', 'match_mvps', [{ match_id: id, player_id: mvp.id, raw_name: mvp.name }], 'return=minimal');
    const fresh = await this.api('GET', 'matches?select=id,date,opponent,venue,our_score,opp_score&order=date.desc,id.desc&limit=120');
    this.setState({ matches: fresh, form: { ...this.state.form, id, isNew: false } });
    this.toast('ok', '경기 기록을 저장했어요', 'vs ' + f.opp.trim() + ' ' + f.our + ' : ' + f.their + ' · 메인 사이트에 바로 반영돼요.');
  }
  async saveSchedule(f) {
    const row = { season: Number(f.date.slice(0, 4)), date: f.date, time: f.time || null, opponent: f.opp.trim(), venue: f.venue.trim() || null, address: f.address.trim() || null, note: f.note.trim() || null };
    if (f.id) await this.apiOne('PATCH', `schedules?id=eq.${f.id}`, row);
    else { const r = await this.apiOne('POST', 'schedules', row); this.quiet({ sched: { ...this.state.sched, id: r.id, isEdit: true } }); }
    const schedules = await this.api('GET', 'schedules?select=id,date,time,opponent,venue,address,note&order=date.asc');
    this.setState({ schedules });
    this.loadNext();
    this.toast('ok', f.isEdit ? '일정을 수정했어요' : '일정을 등록했어요', '메인 사이트 참석 투표에 바로 반영돼요.');
  }
  async deleteSchedule(schedId) {
    if (!window.confirm('이 일정을 삭제할까요? 참석 응답도 함께 지워져요.')) return;
    const id = schedId || (this.state.sched && this.state.sched.id);
    try {
      await this.apiOne('DELETE', `schedules?id=eq.${id}`);
      const schedules = await this.api('GET', 'schedules?select=id,date,time,opponent,venue,address,note&order=date.asc');
      this.setState({ schedules, view: null, sched: null, form: null, dirty: false, save: 'idle' });
      this.loadNext();
      this.toast('ok', '일정을 삭제했어요');
    } catch (e) { if (!e.auth) this.toast('err', '삭제하지 못했어요', '잠시 후 다시 시도해주세요.'); }
  }
  async deleteMatch() {
    if (!window.confirm('이 경기 기록을 삭제할까요?\n출전·득점·MVP 기록이 함께 지워지고 되돌릴 수 없어요.')) return;
    const id = this.state.form.id;
    this.setState({ save: 'saving' });
    try {
      await this.api('DELETE', `match_goals?match_id=eq.${id}`, undefined, 'return=minimal');
      await this.api('DELETE', `match_mvps?match_id=eq.${id}`, undefined, 'return=minimal');
      await this.api('DELETE', `match_lineups?match_id=eq.${id}`, undefined, 'return=minimal');
      await this.apiOne('DELETE', `matches?id=eq.${id}`);
      this.setState(s => ({ matches: s.matches.filter(m => m.id !== id), view: null, form: null, dirty: false, save: 'idle' }));
      this.toast('ok', '경기 기록을 삭제했어요');
    } catch (e) { if (!e.auth) { this.setState({ save: 'idle' }); this.toast('err', '삭제하지 못했어요', '인터넷 연결을 확인하고 다시 시도해주세요.'); } }
  }

  // ── 선수 ──
  async playerWrite(id, patch, revert) {
    this.setState(s => ({ players: s.players.map(p => p.id === id ? { ...p, ...patch } : p), rowMsg: { ...s.rowMsg, [id]: 'saving' } }));
    try {
      if ('mgr' in patch) {
        if (patch.mgr) await this.api('POST', 'rsvp_managers', [{ player_id: id }], 'return=representation');
        else await this.apiOne('DELETE', `rsvp_managers?player_id=eq.${id}`);
      } else {
        const body = {};
        if ('num' in patch) body.number = patch.num === '' ? null : Number(patch.num);
        if ('name' in patch) body.name = patch.name;
        if ('active' in patch) body.active = patch.active;
        await this.apiOne('PATCH', `players?id=eq.${id}`, body);
      }
      this.setState(s => ({ rowMsg: { ...s.rowMsg, [id]: 'ok' } }));
      setTimeout(() => this.setState(s => s.rowMsg[id] === 'ok' ? { rowMsg: { ...s.rowMsg, [id]: null } } : null), 1800);
    } catch (e) {
      if (e.auth) return;
      this.setState(s => ({ players: s.players.map(p => p.id === id ? { ...p, ...revert } : p), rowMsg: { ...s.rowMsg, [id]: 'err' } }));
      this.toast('err', '변경 내용을 저장하지 못했어요', '원래 값으로 되돌렸어요. 다시 시도해주세요.');
    }
  }
  async addPlayer() {
    const s = this.state;
    if (s.sheetBusy) return;
    const num = (document.querySelector('[data-new="num"]') || {}).value ?? s.newNum;
    const name = ((document.querySelector('[data-new="name"]') || {}).value ?? s.newName).trim();
    if (!name) { this.setState({ newNum: num, newName: name, sheetErr: '이름을 입력해주세요.' }); return; }
    if (num && s.players.some(p => p.num === num.trim())) { this.setState({ newNum: num, newName: name, sheetErr: num + '번은 이미 사용 중이에요.' }); return; }
    this.setState({ sheetBusy: true, sheetErr: '', newNum: num, newName: name });
    try {
      const r = await this.apiOne('POST', 'players', { name, number: num ? Number(num) : null, active: true });
      this.setState(st => ({ players: [...st.players, { id: r.id, num: num.trim(), name, active: true, mgr: false, apps3: 0, recent: true }], sheet: false, sheetBusy: false, newNum: '', newName: '', rowMsg: { ...st.rowMsg, [r.id]: 'ok' } }));
      this.toast('ok', name + ' 선수를 추가했어요');
      setTimeout(() => this.setState(st => ({ rowMsg: { ...st.rowMsg, [r.id]: null } })), 2200);
    } catch (e) { if (!e.auth) this.setState({ sheetBusy: false, sheetErr: '저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러주세요.' }); else this.setState({ sheetBusy: false }); }
  }

  // ── 설정: 시즌 MVP 공개(mvp_hidden_seasons 표에 있으면 가림) ──
  async toggleSeason(y) {
    const hidden = this.state.mvpHidden;
    if (!Array.isArray(hidden)) { this.toast('err', '설정 표가 아직 없어요', 'Supabase에서 설정 SQL을 먼저 실행해주세요.'); return; }
    const wasHidden = hidden.includes(y);
    this.setState(s => ({ mvpHidden: wasHidden ? hidden.filter(x => x !== y) : [...hidden, y], seasonMsg: { ...s.seasonMsg, [y]: 'saving' } }));
    try {
      if (wasHidden) await this.apiOne('DELETE', `mvp_hidden_seasons?season=eq.${y}`);
      else await this.apiOne('POST', 'mvp_hidden_seasons', { season: y });
      this.setState(s => ({ seasonMsg: { ...s.seasonMsg, [y]: 'ok' } }));
      this.toast('ok', y + ' 시즌 MVP ' + (wasHidden ? '공개' : '비공개') + '로 저장했어요');
      setTimeout(() => this.setState(s => ({ seasonMsg: { ...s.seasonMsg, [y]: null } })), 1800);
    } catch (e) {
      if (e.auth) return;
      this.setState(s => ({ mvpHidden: hidden, seasonMsg: { ...s.seasonMsg, [y]: 'err' } }));
      this.toast('err', y + ' 시즌 설정을 저장하지 못했어요', '원래 상태로 되돌렸어요.');
    }
  }

  // ── 검색: 다시 그리지 않고 목록만 거름 ──
  filterDom(kind, q) {
    let shown = 0;
    if (kind === 'lineup') {
      // 검색어가 없으면 기본 표시(최근 2년 출전·체크됨)만, 검색하면 전체 선수에서 찾음
      document.querySelectorAll('[data-nm]').forEach(el => { const on = q ? matchName(el.dataset.nm, q) : el.dataset.def === '1'; el.style.display = on ? 'flex' : 'none'; if (on) shown++; });
      const nh = document.getElementById('lineupNoHit'); if (nh) nh.style.display = q && !shown ? 'block' : 'none';
      const hn = document.getElementById('lineupHiddenNote'); if (hn) hn.style.display = !q && hn.textContent.trim() ? 'block' : 'none';
    } else {
      document.querySelectorAll('[data-pnm]').forEach(el => { const on = matchName(el.dataset.pnm, q); el.style.display = on ? 'grid' : 'none'; if (on) shown++; });
      const nh = document.getElementById('playerNoHit'); if (nh) nh.style.display = !shown ? 'block' : 'none';
    }
  }

  // ── 일정 지도 미리보기 ──
  afterRender() {
    const box = document.getElementById('schedMap');
    if (!box) return;
    const address = box.dataset.address || '';
    if (address.trim().length < 4) return;
    if (this._mapEl && this._mapKey === address) { box.replaceChildren(this._mapEl); return; }
    if (this._mapFail === address) return;
    this.loadKakao().then(() => {
      const km = window.kakao.maps;
      new km.services.Geocoder().addressSearch(address, (res, status) => {
        const cur = document.getElementById('schedMap');
        if (status !== km.services.Status.OK || !res[0]) { this._mapFail = address; return; }
        if (!cur) return;
        const pos = new km.LatLng(res[0].y, res[0].x);
        const el = document.createElement('div'); el.style.cssText = 'width:100%; height:100%;';
        cur.replaceChildren(el); cur.style.padding = '0';
        const map = new km.Map(el, { center: pos, level: 4 });
        new km.Marker({ map, position: pos });
        this._mapEl = el; this._mapKey = address;
      });
    }).catch(() => { this._mapFail = address; });
  }
  loadKakao() {
    if (this._kakao) return this._kakao;
    this._kakao = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`;
      sc.onload = () => window.kakao.maps.load(resolve);
      sc.onerror = reject;
      document.head.appendChild(sc);
    });
    return this._kakao;
  }

  renderVals() {
    const s = this.state, P = s.players;
    const byId = id => P.find(p => p.id === id);
    const past = this.pastList();
    const pending = past.filter(r => r.kind === 'pending').length;
    const tabs = [['games', '경기'], ['players', '선수'], ['settings', '설정']].map(([k, l]) => ({
      label: l, badge: k === 'games' && pending ? pending : 0, hasBadge: k === 'games' && pending > 0,
      onClick: () => this.setState({ tab: k, view: null, q: '', pq: '' }), color: s.tab === k ? '#113C98' : '#8A8577', bd: s.tab === k ? '#113C98' : 'transparent'
    }));
    const ready = !s.loggedOut && !s.booting;
    const inList = ready && !s.view;

    // 다가오는 경기 · 참석 현황(메인 사이트와 같은 기본 명단 기준)
    let next = null;
    if (s.next) {
      const n = s.next, today = d(localDate()), diff = Math.round((d(n.date) - today) / 864e5);
      const rs = n.rsvp || [];
      const ids = st => rs.filter(r => r.status === st).map(r => r.player_id);
      const attend = ids('attend'), maybe = ids('maybe'), absent = ids('absent');
      const names = list => list.map(i => byId(i)?.name).filter(Boolean);
      const guestRows = rs.filter(r => r.guests > 0);
      const guestN = guestRows.reduce((a, r) => a + r.guests, 0);
      const answered = new Set(rs.filter(r => r.status).map(r => r.player_id));
      const base = P.filter(p => p.apps3 >= 2);
      const noAnswer = base.filter(p => !answered.has(p.id));
      const outside = [...answered].filter(id => !base.some(p => p.id === id)).length;
      const g = (label, list, color, bg, fg) => ({ label, names: list, color, bg, fg, empty: !list.length });
      next = {
        dday: diff === 0 ? 'D-DAY' : 'D-' + diff, dateShort: String(d(n.date).getMonth() + 1).padStart(2, '0') + '.' + String(d(n.date).getDate()).padStart(2, '0'),
        when: DOW[d(n.date).getDay()] + '요일 ' + ((n.time || '').slice(0, 5) || '시간 미정'), opp: n.opponent || '', venue: n.venue || '구장 미정', address: n.address || '',
        sub: '총 ' + (attend.length + guestN) + '명 · 기본 명단 ' + base.length + '명' + (outside ? ' 외 ' + outside + '명' : '') + ' · 미응답 ' + noAnswer.length,
        counts: [
          { label: '참석', n: attend.length, bg: '#E4F5EA', fg: '#15803D' },
          { label: '미정', n: maybe.length, bg: '#FAF3DC', fg: '#A5841B' },
          { label: '불참', n: absent.length, bg: '#FBE9E9', fg: '#C0392B' },
          { label: '용병', n: guestN, bg: '#EEF2FB', fg: '#113C98' }
        ],
        groups: [
          g('참석', names(attend), '#15803D', '#E4F5EA', '#15803D'),
          g('미정', names(maybe), '#A5841B', '#FAF3DC', '#A5841B'),
          g('불참', names(absent), '#C0392B', '#FBE9E9', '#C0392B'),
          g('용병', guestRows.map(r => (byId(r.player_id)?.name || '?') + ' +' + r.guests), '#113C98', '#EEF2FB', '#113C98'),
          g('미응답', noAnswer.map(p => p.name), '#6B675C', '#F3F1EA', '#6B675C')
        ]
      };
    }

    const pastRows = past.map(r => {
      const needs = r.kind === 'pending';
      const res = needs ? null : RES[r.our > r.their ? 'win' : r.our === r.their ? 'draw' : 'loss'];
      return { opp: r.opp, dateLabel: fmtShort(r.date), venue: r.venue, needs, hasRes: !needs, score: needs ? '' : r.our + ' : ' + r.their,
        resLabel: res ? res[0] : '', resBg: res ? res[1] : '', resColor: res ? res[2] : '', bd: needs ? '#F2C4C4' : 'transparent', onClick: () => this.openMatch(r) };
    });

    // 다음 경기 뒤로 미리 등록해 둔 일정(눌러서 수정·삭제)
    const laterRows = s.schedules.filter(x => !isPast(x) && (!s.next || x.id !== s.next.id)).map(x => ({
      opp: x.opponent || '', dateLabel: fmtShort(x.date), time: (x.time || '').slice(0, 5), venue: x.venue || '구장 미정', onClick: () => this.openSchedule(x)
    }));

    let hiddenCount = 0, mf = {}, lineupChips = [], goalRows = [], goalOpts = [], mvpChips = [], noLineupHit = false, mvpEmpty = false;
    if (s.view === 'match' && s.form) {
      const f = s.form;
      const inLine = P.filter(p => f.lineup[p.id]);
      const sum = f.goals.reduce((a, g) => a + (g.pid ? g.n : 0), 0);
      const sumOk = sum === f.our;
      mf = {
        ...f, dateLabel: f.date ? fmtLong(f.date) : '날짜 미입력', lineupCount: inLine.length, canDelete: !!f.id, canCancel: !f.id && !!f.schedId,
        hasPre: !!f.pre, preNote: f.pre ? '참석 응답한 ' + f.pre + '명을 미리 체크했어요. 안 온 사람은 눌러서 빼주세요.' : '',
        mercHint: f.merc ? '출전 ' + inLine.length + '명 + 용병 ' + f.merc + '명' : '팀원 외 참가 인원',
        sumLabel: '득점 합계 ' + sum + ' / 우리 점수 ' + f.our, sumColor: sumOk ? '#15803D' : '#A5841B',
        onDate: e => this.editF({ date: e.target.value }), onOpp: e => this.typeF({ opp: e.target.value }),
        onRegion: e => this.typeF({ region: e.target.value }), onVenue: e => this.typeF({ venue: e.target.value })
      };
      // 기본으로는 최근 2년 안에 출전한 활성 선수 + 이미 체크된 선수만. 나머지(오래 안 나온·비활성)는 검색하면 나옴
      const isDef = p => (p.active && p.recent) || !!f.lineup[p.id];
      const visible = P;
      hiddenCount = P.filter(p => !isDef(p)).length;
      lineupChips = visible.map(p => {
        const on = !!f.lineup[p.id], def = isDef(p);
        return { name: p.name, num: p.num, def: def ? '1' : '0', disp: (s.q ? matchName(p.name, s.q) : def) ? 'flex' : 'none', weight: on ? 800 : 600,
          bg: on ? '#113C98' : '#FFFFFF', fg: on ? '#FFFFFF' : '#1A1A1A', bd: on ? '#113C98' : '#E7E4DB', numFg: on ? '#F0D281' : '#8A8577',
          onClick: () => this.editF({ lineup: { ...f.lineup, [p.id]: !on }, mvp: on && f.mvp === p.id ? null : f.mvp }) };
      });
      noLineupHit = !!s.q && !visible.some(p => matchName(p.name, s.q));
      goalOpts = [{ v: '', l: '득점자 선택' }, ...inLine.map(p => ({ v: String(p.id), l: (p.num ? p.num + ' ' : '') + p.name })), { v: 'merc', l: '용병' }, { v: 'og', l: '상대 자책골' }];
      const setGoals = goals => this.editF({ goals });
      goalRows = f.goals.map((g, i) => ({
        pid: g.pid, n: g.n, bd: g.pid ? '#E7E4DB' : '#E0B94B',
        onPick: e => setGoals(f.goals.map((x, j) => j === i ? { ...x, pid: e.target.value } : x)),
        inc: () => setGoals(f.goals.map((x, j) => j === i ? { ...x, n: Math.min(20, x.n + 1) } : x)),
        dec: () => setGoals(f.goals.map((x, j) => j === i ? { ...x, n: Math.max(1, x.n - 1) } : x)),
        remove: () => setGoals(f.goals.filter((_, j) => j !== i))
      }));
      mvpChips = inLine.map(p => {
        const on = f.mvp === p.id;
        return { name: p.name, mark: on ? '★ ' : '', bg: on ? '#F0D281' : '#FFFFFF', fg: on ? '#113C98' : '#1A1A1A', bd: on ? '#F0D281' : '#E7E4DB', onClick: () => this.editF({ mvp: on ? null : p.id }) };
      });
      mvpEmpty = !inLine.length;
    }

    let sf = {};
    if (s.view === 'schedule' && s.sched) {
      const f = s.sched, hasMap = f.address.trim().length >= 4;
      const bad = '#C0392B', ok = '#E7E4DB';
      sf = { ...f, title: f.isEdit ? '일정 수정' : '새 일정 추가', hasMap, noMap: !hasMap, mapBg: hasMap ? '#0E3182' : '#F3F1EA',
        venueOrAddr: f.venue ? f.venue + ' · ' + f.address : f.address,
        dateBd: f.tried && !f.date ? bad : ok, oppBd: f.tried && !f.opp.trim() ? bad : ok,
        onDate: e => this.typeS({ date: e.target.value }), onTime: e => this.typeS({ time: e.target.value }), onOpp: e => this.typeS({ opp: e.target.value }),
        onVenue: e => this.typeS({ venue: e.target.value }), onAddress: e => { this.typeS({ address: e.target.value }); const box = document.getElementById('schedMap'); if (box) { box.dataset.address = e.target.value; this.afterRender(); } }, onNote: e => this.typeS({ note: e.target.value }) };
    }

    const SB = {
      saving: { label: '저장 중…', bg: '#113C98', opacity: 0.6, dot: '#3A66C9', color: '#113C98', status: '서버에 저장하고 있어요' },
      ok: { label: '✓ 저장됨', bg: '#15803D', opacity: 1, dot: '#15803D', color: '#15803D', status: s.savedAt + ' 저장 완료' },
      err: { label: '다시 시도', bg: '#C0392B', opacity: 1, dot: '#C0392B', color: '#C0392B', status: '저장 실패 · 입력 내용은 유지됨' }
    };
    const sb = SB[s.save] || (s.dirty
      ? { label: '저장', bg: '#113C98', opacity: 1, dot: '#E0B94B', color: '#A5841B', status: '저장 안 된 변경 사항 있음' }
      : { label: '저장', bg: '#113C98', opacity: 1, dot: '#D9D5CA', color: '#8A8577', status: '변경 사항 없음' });

    const MSG = { saving: ['저장 중…', '#6B675C'], ok: ['✓ 저장됨', '#15803D'], err: ['저장 실패 · 되돌림', '#C0392B'] };
    // 선수 표: 번호 있는 선수 먼저(번호순), 그다음 이름순
    const sorted = [...P].sort((a, b) => (a.num === '') - (b.num === '') || Number(a.num) - Number(b.num) || a.name.localeCompare(b.name, 'ko'));
    const shownCount = sorted.filter(p => matchName(p.name, s.pq)).length;
    const playerRows = sorted.map(p => {
      const m = MSG[s.rowMsg[p.id]] || ['', ''];
      const a = sw(p.active), g = sw(p.mgr);
      const orig = { num: p.num, name: p.name };
      return {
        num: p.num, name: p.name, disp: matchName(p.name, s.pq) ? 'grid' : 'none', nameColor: p.active ? '#1A1A1A' : '#8A8577', rowBg: s.rowMsg[p.id] === 'err' ? '#FDF3F3' : '#FFFFFF',
        msg: m[0], hasMsg: !!m[0], msgColor: m[1], aBg: a.bg, aKnob: a.knob, mBg: g.bg, mKnob: g.knob,
        onNum: e => { this._orig = this._orig || {}; this._orig[p.id] = this._orig[p.id] || orig; const v = e.target.value.replace(/\D/g, ''); e.target.value = v; this.quiet({ players: this.state.players.map(x => x.id === p.id ? { ...x, num: v } : x) }); },
        onName: e => { this._orig = this._orig || {}; this._orig[p.id] = this._orig[p.id] || orig; const v = e.target.value; this.quiet({ players: this.state.players.map(x => x.id === p.id ? { ...x, name: v } : x) }); },
        onBlur: () => {
          const o = this._orig && this._orig[p.id]; if (!o) return;
          delete this._orig[p.id];
          const cur = this.state.players.find(x => x.id === p.id);
          if (!cur.name.trim()) { this.setState(st => ({ players: st.players.map(x => x.id === p.id ? { ...x, ...o } : x) })); this.toast('err', '이름은 비워둘 수 없어요', '원래 이름으로 되돌렸어요.'); return; }
          if (cur.num && cur.num !== o.num && this.state.players.some(x => x.id !== p.id && x.num === cur.num)) {
            this.setState(st => ({ players: st.players.map(x => x.id === p.id ? { ...x, ...o } : x) })); this.toast('err', cur.num + '번은 이미 사용 중이에요', '원래 번호로 되돌렸어요.'); return;
          }
          if (cur.num !== o.num || cur.name !== o.name) this.playerWrite(p.id, { num: cur.num, name: cur.name.trim() }, o);
        },
        onActive: () => this.playerWrite(p.id, { active: !p.active }, { active: p.active }),
        onMgr: () => this.playerWrite(p.id, { mgr: !p.mgr }, { mgr: p.mgr })
      };
    });

    const year = Number(localDate().slice(0, 4));
    const hidden = Array.isArray(s.mvpHidden) ? s.mvpHidden : [];
    const seasonRows = Array.from({ length: 6 }, (_, i) => year - i).map(y => {
      const on = !hidden.includes(y), k = sw(on), m = MSG[s.seasonMsg[y]] || ['', ''];
      const missing = s.mvpHidden === 'missing';
      return { season: y, st: missing ? '설정 표 없음 (SQL 실행 필요)' : on ? '공개' : '비공개 (가려짐)', stColor: on && !missing ? '#113C98' : '#8A8577', bg: missing ? '#D9D5CA' : k.bg, knob: k.knob, msg: m[0], hasMsg: !!m[0], msgColor: m[1], onClick: () => this.toggleSeason(y) };
    });

    const t = s.toast;
    return {
      loggedOut: s.loggedOut, byLogout: s.byLogout, hasPinErr: !!s.pinErr, pinErr: s.pinErr, hasSheetErr: !!s.sheetErr, login: () => this.tryLogin(),
      pin: s.pin, onPin: e => { const v = e.target.value.replace(/\D/g, '').slice(0, 8); if (v !== e.target.value) e.target.value = v; this.quiet({ pin: v }); },
      onPinKey: e => { if (e.key === 'Enter' && !e.isComposing) this.tryLogin(); },
      pinBd: s.pinErr ? '#C0392B' : '#E7E4DB', loginOp: Date.now() >= s.lockUntil ? 1 : 0.45,
      toggleKeep: () => this.setState({ keep: !s.keep }), keepBg: s.keep ? '#113C98' : '#FFFFFF', keepBd: s.keep ? '#113C98' : '#C9C4B5', keepMark: s.keep ? '✓' : '',
      accountLabel: '운영진 PIN으로 로그인 중' + (this._keep ? ' · 이 기기에서 유지' : ''),
      deleteMatch: () => this.deleteMatch(),
      vGames: inList && s.tab === 'games', vPlayers: inList && s.tab === 'players', vSettings: inList && s.tab === 'settings',
      vMatch: ready && s.view === 'match', vSchedule: ready && s.view === 'schedule',
      showNav: inList, showSaveBar: ready && !!s.view, tabs,
      hasNext: !!next, noNext: !next && !s.booting, next: next || {}, pendingCount: pending, hasPending: pending > 0, pastRows,
      newSchedule: () => this.openSchedule(false), editSchedule: () => this.openSchedule(true), deleteSchedule: () => this.deleteSchedule(),
      laterRows, hasLater: inList && laterRows.length > 0, cancelSchedule: () => this.deleteSchedule(s.form && s.form.schedId),
      back: () => this.back(), save: () => this.save(),
      mf, lineupChips, noLineupHitDisp: noLineupHit ? 'block' : 'none',
      hiddenNote: hiddenCount ? '최근 2년 출전 기록이 없는 ' + hiddenCount + '명은 숨겼어요. 이름을 검색하면 나와요.' : '', hiddenNoteDisp: hiddenCount && !s.q ? 'block' : 'none', goalRows, goalOpts, mvpChips, mvpEmpty, sf, sb,
      q: s.q, onQ: e => { this.quiet({ q: e.target.value }); this.filterDom('lineup', e.target.value); },
      addGoal: () => this.editF({ goals: [...s.form.goals, { pid: '', n: 1 }] }),
      incOur: () => this.editF({ our: Math.min(30, s.form.our + 1) }), decOur: () => this.editF({ our: Math.max(0, s.form.our - 1) }),
      incTheir: () => this.editF({ their: Math.min(30, s.form.their + 1) }), decTheir: () => this.editF({ their: Math.max(0, s.form.their - 1) }),
      incMerc: () => this.editF({ merc: Math.min(15, s.form.merc + 1) }), decMerc: () => this.editF({ merc: Math.max(0, s.form.merc - 1) }),
      pq: s.pq, onPq: e => { this.quiet({ pq: e.target.value }); this.filterDom('players', e.target.value); }, playerRows, noPlayerHitDisp: shownCount ? 'none' : 'block',
      playerSummary: '활성 ' + P.filter(p => p.active).length + ' / 전체 ' + P.length,
      seasonRows, logout: () => this.logout(),
      toastOn: !!t, toast: t ? { msg: t.msg, sub: t.sub || '', hasSub: !!t.sub, bg: t.type === 'ok' ? '#15803D' : '#C0392B', icon: t.type === 'ok' ? '✓' : '!' } : {},
      closeToast: () => this.setState({ toast: null }),
      sheetOpen: s.sheet, openSheet: () => this.setState({ sheet: true, sheetErr: '' }), closeSheet: () => this.setState({ sheet: false }), stop: e => e.stopPropagation(),
      newNum: s.newNum, newName: s.newName,
      onNewNum: e => { const v = e.target.value.replace(/\D/g, ''); if (v !== e.target.value) e.target.value = v; this.quiet({ newNum: v }); },
      onNewName: e => this.quiet({ newName: e.target.value }),
      addPlayer: () => this.addPlayer(), sheetErr: s.sheetErr, sheetBtnLabel: s.sheetBusy ? '저장 중…' : '추가', sheetBtnOp: s.sheetBusy ? 0.6 : 1, sheetBtnBg: s.sheetErr && !s.sheetBusy ? '#C0392B' : '#113C98'
    };
  }
}
AdminApp.prototype.editS = function (patch) { this.setState(s => ({ sched: { ...s.sched, ...patch }, dirty: true, save: s.save === 'saving' ? 'saving' : 'idle' })); };

const adminApp = new AdminApp();
adminApp.mount(document.getElementById('app'), document.getElementById('dc-template'));
window.adminApp = adminApp;
void isTyping;
