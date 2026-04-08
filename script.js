// ── Supabase 설정 ──
const SUPABASE_URL = "https://sgzanwxgdcyojcoskseo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tHW4O3rv3B0hk1p-v4s7gg_MLc2BeN4";

async function supabaseFetch(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        }
    });
    if (!res.ok) throw new Error(`Supabase 오류: ${res.status}`);
    return res.json();
}

// 연결 테스트 (콘솔에서 확인용)
supabaseFetch("matches?season=eq.2026&order=date.asc")
    .then(data => console.log("✅ Supabase 연결 성공:", data.length, "경기"))
    .catch(err => console.error("❌ 연결 실패:", err));

// 전역 상태 관리
const AppState = {
    map: {
        scriptLoaded: false,
        initialized: false,
        lastAddress: null,
        isLoading: false
    },
    network: {
        currentAbortController: null
    },
    ui: {
        currentFilter: 'all',
        currentRegionalFilter: 'winrate',
        currentTeamSort: 'season',
        currentMainTab: 'home',
        currentMatchSort: 'desc'
    },
    data: {
        currentSeason: '2026',
        isAllTimeView: false,
        matches: [],
        playerStats: {},
        regionalStats: []
    },
    charts: {
        winRateTrendChart: null
    },
    allTime: {
        loaded: false,
        loadingPromise: null,
        stats: {},
        matches: [],
        records: null,
        regional: []
    }
};

// 설정
const CONFIG = {
    AVAILABLE_SEASONS: ['2000','2001','2002','2003','2004','2005','2006','2007','2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
    DEFAULT_SEASON: '2026',
    KAKAO_MAP_API_KEY: '47eed652b004605d8a8e3e39df268f24',
    BASE_PATH: './',
    DATA_PATH: (season) => `${CONFIG.BASE_PATH}${season}_data.json`,
    VENUE: {
        name: '성불빌라',
        address: '서울 노원구 동일로231가길 7',
        info: '전화번호: 031-790-2022, 주차 아무데나'
    },
    PARALLEL_LOADING: {
        BATCH_SIZE: 5,
        MAX_CONCURRENT: 3
    }
};

const SEASON_DISPLAY_OVERRIDES = {
    '2025': {
        summary: {
            matches: 46,
            wins: 23,
            draws: 3,
            losses: 20,
            goalsFor: 216
        },
        mvp: {
            name: '신규환',
            count: 7,
            value: 7,
            appearances: 36
        }
    }
};

// 구글 시트 설정
const GOOGLE_SHEETS_CONFIG = {
    SHEET_ID: '13UOlG3FdqufeoW2uV3x7L4KFMOo9YrwrjkrExXSVGIg',
    SEASONS: {
        '2026': {
            matches: '1013896035',
            players: '882762798',
            schedule: '1750685299',
            regional: '1050217492'
        }
    }
};

const isGoogleSheetSeason = (season) => true; // 모든 시즌 Supabase로 처리

// 유틸리티
const koreanCollator = new Intl.Collator('ko', { numeric: true });
const seasonDataCache = new Map();

// 로깅 시스템
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function logError(message, error) {
    if (isDevelopment) {
        console.error(message, error);
    }
}

function logInfo(message, data) {
    if (isDevelopment) {
        console.log(message, data);
    }
}

// 상태 메시지 관리
function showStatusMessage(message, type = 'loading') {
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status-message status-${type}`;
        statusElement.style.display = 'block';
    }
}

function hideStatusMessage() {
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.style.display = 'none';
    }
}

function showLoadingProgress(current, total, message = '') {
    const progressContainer = document.getElementById('loadingProgress');
    const progressBar = document.getElementById('loadingProgressBar');
    const statsElement = document.getElementById('loadingStats');

    if (progressContainer && progressBar) {
        progressContainer.style.display = 'block';
        const percentage = Math.round((current / total) * 100);
        progressBar.style.width = `${percentage}%`;

        if (message && statsElement) {
            statsElement.textContent = `${message} (${current}/${total})`;
            statsElement.style.display = 'block';
        }
    }
}

function hideLoadingProgress() {
    const progressContainer = document.getElementById('loadingProgress');
    const statsElement = document.getElementById('loadingStats');
    
    if (progressContainer) progressContainer.style.display = 'none';
    if (statsElement) statsElement.style.display = 'none';
}

// CSV 파싱
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        if (values[0] && !values[0].includes('🔽') && !values[0].includes('새') && !values[0].includes('예시:')) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            data.push(row);
        }
    }
    
    return data;
}

function sanitizeTableData(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return value.toString();
    return String(value).replace(/<[^>]*>/g, '').trim();
}

function parseScore(scoreText = '0:0') {
    if (typeof scoreText !== 'string') return { goalsFor: 0, goalsAgainst: 0 };
    const [forStr, againstStr] = scoreText.split(':').map(part => parseInt(part, 10));
    return {
        goalsFor: Number.isFinite(forStr) ? forStr : 0,
        goalsAgainst: Number.isFinite(againstStr) ? againstStr : 0
    };
}

function extractMatchStats(match) {
    const { goalsFor, goalsAgainst } = parseScore(match?.score);
    return {
        goalsFor,
        goalsAgainst,
        goalDiff: goalsFor - goalsAgainst
    };
}

function calculateMatchStats(matches = []) {
    return matches.reduce((acc, match) => {
        const { goalsFor, goalsAgainst } = extractMatchStats(match);

        acc.total += 1;
        acc.goalsFor += goalsFor;
        acc.goalsAgainst += goalsAgainst;

        if (match.result === 'win') {
            acc.win += 1;
        } else if (match.result === 'draw') {
            acc.draw += 1;
        } else {
            acc.loss += 1;
        }

        return acc;
    }, { total: 0, win: 0, draw: 0, loss: 0, goalsFor: 0, goalsAgainst: 0 });
}

function validateSeasonData(rawData) {
    if (!rawData || typeof rawData !== 'object') {
        throw new Error('잘못된 시즌 데이터입니다.');
    }

    const matches = Array.isArray(rawData.matches) ? rawData.matches
        .filter(match => match && match.date && match.opponent)
        .map(match => ({
            date: sanitizeTableData(match.date),
            opponent: sanitizeTableData(match.opponent),
            result: ['win', 'draw', 'loss'].includes(match.result) ? match.result : 'draw',
            score: sanitizeTableData(match.score || '0:0'),
            mvp: sanitizeTableData(match.mvp || '')
        })) : [];

    const playersRaw = rawData.players && typeof rawData.players === 'object' ? rawData.players : {};
    const players = {};
    Object.entries(playersRaw).forEach(([name, stats]) => {
        if (!name) return;
        players[sanitizeTableData(name)] = {
            appearances: Number(stats?.appearances) || 0,
            goals: Number(stats?.goals) || 0,
            mvp: Number(stats?.mvp) || 0
        };
    });

    const regionalRaw = Array.isArray(rawData.regional) ? rawData.regional : [];
    const regional = regionalRaw
        .filter(row => row && row.region)
        .map(row => ({
            region: sanitizeTableData(row.region),
            matches: Number(row.matches) || 0,
            wins: Number(row.wins) || 0,
            draws: Number(row.draws) || 0,
            losses: Number(row.losses) || 0
        }));

    const schedules = Array.isArray(rawData.schedules) ? rawData.schedules : [];

    return {
        season: sanitizeTableData(rawData.season || ''),
        matches,
        players,
        schedules,
        regional
    };
}

// --- [ 데이터 처리/가공 관련 함수 ] ---

// 선수 통계에서 MVP를 계산하는 함수
function calculateSeasonMvp(playerStats) {
    if (!playerStats || Object.keys(playerStats).length === 0) {
        return null;
    }

    const playersArray = Object.entries(playerStats)
        .map(([name, stats]) => ({
            name,
            appearances: stats.totalAppearances ?? stats.appearances ?? 0,
            goals: stats.totalGoals ?? stats.goals ?? 0,
            mvp: stats.totalMvp ?? stats.mvp ?? 0
        }))
        .filter(player => player.appearances > 0);

    if (playersArray.length === 0) {
        return null;
    }

    playersArray.sort((a, b) => {
        if (b.mvp !== a.mvp) return b.mvp - a.mvp;
        if (b.appearances !== a.appearances) return b.appearances - a.appearances;
        return koreanCollator.compare(a.name, b.name);
    });

    return playersArray[0];
}

function validateMatches(matchesData) {
    // ... (matchesData 유효성 검사 로직)
    return matchesData
        .filter(row => row['날짜'] && row['상대팀'])
        .map(row => ({
            date: sanitizeTableData(row['날짜']),
            opponent: sanitizeTableData(row['상대팀']),
            result: row['결과'],
            score: row['스코어'],
            mvp: sanitizeTableData(row['MVP'] || '')
        }));
}

function processSheetData(matchesData, playersData, scheduleData, regionalData, season) {
    // ... (데이터 처리 로직)
    const matches = validateMatches(matchesData)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    const players = {};
    playersData
        .filter(row => row['이름'])
        .forEach(row => {
            players[row['이름']] = {
                appearances: parseInt(row['출장']) || 0,
                goals: parseInt(row['골']) || 0,
                mvp: parseInt(row['MVP']) || 0
            };
        });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const schedules = scheduleData
        .filter(row => {
            if (!row['날짜'] || !row['상대팀']) return false;
            
            const matchDate = new Date(row['날짜']);
            if (isNaN(matchDate.getTime())) return false;
            
            matchDate.setHours(0, 0, 0, 0);
            return matchDate >= today;
        })
        .map(row => ({
            date: row['날짜'],
            time: row['시간'] || '',
            venue: row['구장명'] || '',
            opponent: row['상대팀'],
            address: row['구장주소'] || '',
            note: row['비고'] || ''
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    const regional = regionalData
        .filter(row => row['지역'])
        .map(row => ({
            region: row['지역'],
            matches: parseInt(row['경기수']) || 0,
            wins: parseInt(row['승']) || 0,
            draws: parseInt(row['무']) || 0,
            losses: parseInt(row['패']) || 0
        }));

    logInfo(`구글 시트에서 ${season} 데이터 로드 완료`, { 
        경기수: matches.length, 
        선수수: Object.keys(players).length, 
        일정수: schedules.length, 
        지역수: regional.length 
    });

    return {
        season: season,
        matches: matches,
        players: players,
        schedules: schedules,
        regional: regional
    };
}

function calculateTeamRecords(allMatches = []) {
    if (!Array.isArray(allMatches) || allMatches.length === 0) {
        return null;
    }

    const overall = {
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0
    };
    const perSeason = {};
    let biggestWin = null;
    let toughestLoss = null;

    allMatches.forEach(match => {
        const seasonKey = match.season || AppState.data.currentSeason;
        const seasonStats = perSeason[seasonKey] || { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };

        const { goalsFor, goalsAgainst, goalDiff } = extractMatchStats(match);

        seasonStats.matches += 1;
        overall.matches += 1;
        seasonStats.goalsFor += goalsFor;
        seasonStats.goalsAgainst += goalsAgainst;
        overall.goalsFor += goalsFor;
        overall.goalsAgainst += goalsAgainst;

        if (match.result === 'win') {
            seasonStats.wins += 1;
            overall.wins += 1;
        } else if (match.result === 'draw') {
            seasonStats.draws += 1;
            overall.draws += 1;
        } else {
            seasonStats.losses += 1;
            overall.losses += 1;
        }

        perSeason[seasonKey] = seasonStats;

        if (!biggestWin || goalDiff > biggestWin.diff) {
            biggestWin = {
                diff: goalDiff,
                opponent: match.opponent,
                score: match.score,
                season: seasonKey,
                date: match.date
            };
        }
        if (!toughestLoss || goalDiff < toughestLoss.diff) {
            toughestLoss = {
                diff: goalDiff,
                opponent: match.opponent,
                score: match.score,
                season: seasonKey,
                date: match.date
            };
        }
    });

    const perSeasonArray = Object.entries(perSeason)
        .map(([season, stats]) => ({
            season,
            ...stats,
            winRate: stats.matches ? ((stats.wins / stats.matches) * 100).toFixed(1) : '0.0'
        }))
        .sort((a, b) => b.season.localeCompare(a.season));

    const overallWinRate = overall.matches ? ((overall.wins / overall.matches) * 100).toFixed(1) : '0.0';

    return {
        overall: { ...overall, winRate: overallWinRate },
        perSeason: perSeasonArray,
        biggestWin,
        toughestLoss
    };
}

// --- [ UI 렌더링 함수 ] ---

// 시즌 요약 카드 UI를 업데이트하는 함수 (에러 해결을 위해 정의 순서 올림)
function renderSeasonStatCards() {
    const statsOverview = document.querySelector('.stats-overview');
    if (!statsOverview) return;

    statsOverview.innerHTML = `
        <div class="stat-card">
            <div class="stat-title" id="matchesCardTitle">경기 수</div>
            <div class="stat-value" id="totalMatches">0</div>
            <div class="stat-subtitle">총 경기</div>
        </div>
        <div class="stat-card">
            <div class="stat-title" id="winRateCardTitle">승률</div>
            <div class="stat-value" id="winRate">0%</div>
            <div class="stat-subtitle" id="winRateSubtitle">0승 0무 0패</div>
        </div>
        <div class="stat-card">
            <div class="stat-title" id="goalsCardTitle">득점</div>
            <div class="stat-value" id="totalGoals">0</div>
            <div class="stat-subtitle" id="goalsPerMatch">경기당 0골</div>
        </div>
        <div class="stat-card">
            <div class="stat-title" id="mvpCardTitle">시즌 MVP</div>
            <div class="stat-value" id="seasonMvp">-</div>
            <div class="stat-subtitle" id="mvpStats">MVP 0회</div>
        </div>
    `;
}


// 메인 통계 값 (숫자)을 업데이트하는 함수 (loadData가 호출하므로 정의 순서 올림)
function updateStats() {
    const matchesCardTitle = document.getElementById('matchesCardTitle');
    const winRateCardTitle = document.getElementById('winRateCardTitle');
    const goalsCardTitle = document.getElementById('goalsCardTitle');
    const mvpCardTitle = document.getElementById('mvpCardTitle');

    const isAllTimeView = AppState.data.isAllTimeView && AppState.allTime.loaded && AppState.allTime.records?.overall;

    if (matchesCardTitle) matchesCardTitle.textContent = isAllTimeView ? '역대 경기 수' : '경기 수';
    if (winRateCardTitle) winRateCardTitle.textContent = isAllTimeView ? '역대 승률' : '승률';
    if (goalsCardTitle) goalsCardTitle.textContent = isAllTimeView ? '역대 득점' : '득점';
    if (mvpCardTitle) mvpCardTitle.textContent = isAllTimeView ? '역대 MVP' : '시즌 MVP';

    if (isAllTimeView) {
        const overall = AppState.allTime.records.overall;
        const totalMatches = overall.matches || 0;
        const wins = overall.wins || 0;
        const draws = overall.draws || 0;
        const losses = overall.losses || 0;
        const totalGoalsFor = overall.goalsFor || 0;
        const winRate = totalMatches > 0 ? (wins / totalMatches * 100).toFixed(1) : '0.0';
        const goalsPerMatch = totalMatches > 0 ? (totalGoalsFor / totalMatches).toFixed(1) : '0.0';

        const mvpPlayer = calculateSeasonMvp(AppState.allTime.stats);
        const mvpName = mvpPlayer ? mvpPlayer.name : '-';
        const mvpCount = mvpPlayer ? mvpPlayer.mvp : 0;
        const mvpAppearances = mvpPlayer ? mvpPlayer.appearances : 0;

        document.getElementById('totalMatches').textContent = totalMatches.toString();
        document.getElementById('winRate').textContent = `${winRate}%`;
        document.getElementById('winRateSubtitle').textContent = `${wins}승 ${draws}무 ${losses}패`;
        document.getElementById('totalGoals').textContent = totalGoalsFor.toString();
        document.getElementById('goalsPerMatch').textContent = `경기당 ${goalsPerMatch}골`;
        document.getElementById('seasonMvp').textContent = mvpName;
        document.getElementById('mvpStats').textContent = mvpCount > 0 ? `MVP ${mvpCount}회 (출전 ${mvpAppearances}회)` : 'MVP 0회';
        return;
    }

    if (AppState.data.matches.length === 0) {
        if (mvpHint) mvpHint.style.display = 'none';

        document.getElementById('totalMatches').textContent = '0';
        document.getElementById('winRate').textContent = '0%';
        document.getElementById('winRateSubtitle').textContent = '0승 0무 0패';
        document.getElementById('totalGoals').textContent = '0';
        document.getElementById('goalsPerMatch').textContent = '경기당 0골';
        document.getElementById('seasonMvp').textContent = '-';
        document.getElementById('mvpStats').textContent = 'MVP 0회';
        return;
    }

    const override = SEASON_DISPLAY_OVERRIDES[AppState.data.currentSeason];
    const hasMatchData = AppState.data.matches.length > 0;
    const hasPlayerData = Object.keys(AppState.data.playerStats || {}).length > 0;
    const matchStats = hasMatchData ? calculateMatchStats(AppState.data.matches) : null;

    const totalMatches = matchStats?.total ?? override?.summary?.matches ?? 0;
    const wins = matchStats?.win ?? override?.summary?.wins ?? 0;
    const draws = matchStats?.draw ?? override?.summary?.draws ?? 0;
    const losses = matchStats?.loss ?? override?.summary?.losses ?? 0;
    const totalGoalsFor = matchStats?.goalsFor ?? override?.summary?.goalsFor ?? 0;

    const winRate = totalMatches > 0 ? (wins / totalMatches * 100).toFixed(1) : 0;
    const goalsPerMatch = totalMatches > 0 ? (totalGoalsFor / totalMatches).toFixed(1) : 0;

    const seasonMvpPlayer = hasPlayerData
        ? calculateSeasonMvp(AppState.data.playerStats)
        : override?.mvp;
    const mvpName = seasonMvpPlayer ? seasonMvpPlayer.name : '-';
    const mvpCount = seasonMvpPlayer ? seasonMvpPlayer.count ?? seasonMvpPlayer.mvp : 0;
    const mvpAppearances = seasonMvpPlayer ? seasonMvpPlayer.appearances : 0;


    document.getElementById('totalMatches').textContent = totalMatches.toString();
    document.getElementById('winRate').textContent = winRate + '%';
    document.getElementById('winRateSubtitle').textContent = `${wins}승 ${draws}무 ${losses}패`;
    document.getElementById('totalGoals').textContent = totalGoalsFor.toString();
    document.getElementById('goalsPerMatch').textContent = `경기당 ${goalsPerMatch}골`;
    document.getElementById('seasonMvp').textContent = mvpName;
    document.getElementById('mvpStats').textContent = mvpCount > 0 ? `MVP ${mvpCount}회 (출전 ${mvpAppearances}회)` : 'MVP 0회';
}

// 테이블 업데이트 (부분 생략)
function updateMatchesTable(matches = AppState.data.matches) {
    const matchList = document.getElementById('matchesList');
    if (!matchList) return;

    matchList.innerHTML = '';

    if (!matches || matches.length === 0) {
        matchList.innerHTML = '<div class="no-data">경기 데이터가 없습니다.</div>';
        return;
    }

    const withMeta = matches.map((match, index) => ({
        ...match,
        originalIndex: index,
        timestamp: new Date(match.date).getTime()
    }));

    const chronological = [...withMeta].sort((a, b) => {
        const timeA = Number.isFinite(a.timestamp) ? a.timestamp : 0;
        const timeB = Number.isFinite(b.timestamp) ? b.timestamp : 0;
        return timeA - timeB || a.originalIndex - b.originalIndex;
    });

    const roundKeyMap = new Map();
    chronological.forEach((match, index) => {
        const key = `${match.date}|${match.opponent}|${match.score}|${match.mvp}|${match.originalIndex}`;
        roundKeyMap.set(key, index + 1);
    });

    const isAsc = AppState.ui.currentMatchSort === 'asc';
    const displayMatches = [...withMeta].sort((a, b) => {
        const timeA = Number.isFinite(a.timestamp) ? a.timestamp : 0;
        const timeB = Number.isFinite(b.timestamp) ? b.timestamp : 0;
        return isAsc ? (timeA - timeB || a.originalIndex - b.originalIndex) : (timeB - timeA || b.originalIndex - a.originalIndex);
    });

    document.querySelectorAll('.match-sort-controls .filter-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.matchSort === AppState.ui.currentMatchSort);
    });

    displayMatches.forEach(match => {
        const roundKey = `${match.date}|${match.opponent}|${match.score}|${match.mvp}|${match.originalIndex}`;
        const round = roundKeyMap.get(roundKey) || 1;
        const card = document.createElement('article');
        card.className = 'match-archive-item';
        card.innerHTML = `
            <div class="match-archive-top">
                <span class="match-date">${match.date}</span>
                <span class="match-competition">WHISTLE LEAGUE</span>
            </div>
            <div class="match-archive-main match-archive-grid">
                <div class="match-opponent-wrap match-zone-left">
                    <div class="match-opponent">${match.opponent}</div>
                    <div class="match-context">HOME · WHISTLE</div>
                </div>
                <div class="match-mid-meta match-zone-center">
                    <div class="match-meta-line">${round}라운드</div>
                    <div class="match-meta-line">시즌 ${AppState.data.currentSeason}</div>
                    <div class="match-meta-line">아카이브 경기</div>
                </div>
                <div class="match-score-wrap match-zone-right">
                    <div class="match-score">${match.score}</div>
                    <span class="result-badge result-${match.result}">
                        ${match.result === 'win' ? '승' : match.result === 'draw' ? '무' : '패'}
                    </span>
                </div>
            </div>
            <div class="match-archive-meta">
                <span class="match-meta-chip">${round}번째 기록</span>
                <span class="match-meta-chip">MVP ${match.mvp ? match.mvp : '-'}</span>
            </div>
        `;
        matchList.appendChild(card);
    });
}

function updatePlayersTable(playerStats = AppState.data.playerStats, sortBy = AppState.ui.currentFilter) {
    const listContainer = document.getElementById('playersRankList');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (!playerStats || Object.keys(playerStats).length === 0) {
        listContainer.innerHTML = '<div class="no-data">선수 데이터가 없습니다.</div>';
        return;
    }

    let playersArray = Object.entries(playerStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .filter(player => player.appearances > 0);

    switch (sortBy) {
        case 'goals':
            playersArray.sort((a, b) => b.goals - a.goals || b.appearances - a.appearances || koreanCollator.compare(a.name, b.name));
            break;
        case 'attendance':
            playersArray.sort((a, b) => b.appearances - a.appearances || b.goals - a.goals || koreanCollator.compare(a.name, b.name));
            break;
        case 'mvp':
            playersArray.sort((a, b) => b.mvp - a.mvp || b.goals - a.goals || koreanCollator.compare(a.name, b.name));
            break;
        default:
            playersArray.sort((a, b) => koreanCollator.compare(a.name, b.name));
    }

    const totalMatches = AppState.data.matches.length;

    playersArray.forEach((player, index) => {
        const attendanceRate = totalMatches > 0 ? Math.round((player.appearances / totalMatches) * 100) : 0;

        const card = document.createElement('article');
        card.className = 'player-rank-item';
        card.innerHTML = `
            <div class="player-rank-order">${index + 1}</div>
            <div class="player-rank-main player-zone-left">
                <div class="player-name">${player.name}</div>
                <div class="player-support">
                    <span class="player-chip">출전 ${player.appearances}</span>
                    <span class="player-chip">골 ${player.goals}</span>
                    <span class="player-chip">MVP ${player.mvp}회</span>
                </div>
            </div>
            <div class="player-rank-meta player-zone-center">
                <span class="player-chip">포지션 미등록</span>
                <span class="player-chip">경기 ${AppState.data.matches.length || 0}</span>
            </div>
            <div class="player-rank-stats player-zone-right">
                <span class="attendance-rate ${
                attendanceRate >= 70 ? 'rate-high' :
                attendanceRate >= 40 ? 'rate-medium' : 'rate-low'
            }">참석률 ${attendanceRate}%</span>
                <span class="mvp-badge">MVP ${player.mvp}회</span>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

function setMatchSort(sortOrder) {
    AppState.ui.currentMatchSort = sortOrder;
    updateMatchesTable(AppState.data.matches);
}

function updateTable(data, matches, tableBodyId, type) {
    if (type === 'players') {
        updatePlayersTable(data, AppState.ui.currentFilter);
    } else if (type === 'matches') {
        updateMatchesTable(data, document.getElementById(tableBodyId));
    }
}

// 일정 및 지도 관련 함수
function updateSchedule(schedules = []) {
    const scheduleContainer = document.querySelector('.schedule-container');
    const venueInfo = document.querySelector('.venue-info');
    if (!scheduleContainer || !venueInfo) return;

    const hasSchedules = Array.isArray(schedules) && schedules.length > 0;
    scheduleContainer.innerHTML = '<h3 style="color: #1e40af; margin-bottom: 15px;">다음 경기 일정</h3>';

    if (!hasSchedules) {
        scheduleContainer.innerHTML += '<div class="no-data">등록된 다음 경기 일정이 없습니다.</div>';
    } else {
        const list = document.createElement('ul');
        list.className = 'schedule-list';
        schedules.slice(0, 3).forEach(schedule => {
            const item = document.createElement('li');
            item.innerHTML = `
                <strong>${sanitizeTableData(schedule.date)} ${schedule.time ? '(' + sanitizeTableData(schedule.time) + ')' : ''}</strong><br>
                ${sanitizeTableData(schedule.opponent)}전 - ${sanitizeTableData(schedule.venue || '미정')}
            `;
            list.appendChild(item);
        });
        scheduleContainer.appendChild(list);
    }

    const fallbackVenue = {
        name: (CONFIG.VENUE && CONFIG.VENUE.name) || '성불빌라',
        address: (CONFIG.VENUE && CONFIG.VENUE.address) || '서울 노원구 동일로231가길 75',
        info: (CONFIG.VENUE && CONFIG.VENUE.info) || '전화번호: 031-790-2022, 주차 편함'
    };

    const nextVenue = hasSchedules
        ? (schedules.find(schedule => schedule.address) || schedules[0])
        : null;

    const updatedVenue = {
        name: sanitizeTableData((nextVenue && (nextVenue.venue || nextVenue.name)) || fallbackVenue.name),
        address: sanitizeTableData((nextVenue && nextVenue.address) || fallbackVenue.address),
        info: sanitizeTableData((nextVenue && (nextVenue.note || nextVenue.info)) || fallbackVenue.info)
    };

    CONFIG.VENUE = {
        name: updatedVenue.name || fallbackVenue.name,
        address: updatedVenue.address || fallbackVenue.address,
        info: updatedVenue.info || fallbackVenue.info
    };

    if (CONFIG.VENUE.address && CONFIG.VENUE.address !== AppState.map.lastAddress) {
        AppState.map.initialized = false;
    }

    venueInfo.innerHTML = `
        <div class="venue-name">${CONFIG.VENUE.name}</div>
        <div class="venue-address">📍 ${CONFIG.VENUE.address}</div>
        <div class="venue-phone">📞 ${CONFIG.VENUE.info}</div>
    `;

    loadKakaoMap();
}

function loadKakaoMap() {
    const mapPlaceholder = document.getElementById('map-placeholder');
    if (!mapPlaceholder) return;

    if (!CONFIG.VENUE.address) {
        mapPlaceholder.innerHTML = '<div class="map-placeholder">주소 정보가 없어 지도를 표시할 수 없습니다.</div>';
        return;
    }

    const existingScript = document.getElementById('kakao-maps-sdk');
    if (existingScript) {
        if (AppState.map.scriptLoaded) {
            initializeMap();
        } else if (!AppState.map.isLoading) {
            AppState.map.isLoading = true;
            existingScript.addEventListener('load', () => {
                AppState.map.scriptLoaded = true;
                AppState.map.isLoading = false;
                kakao.maps.load(initializeMap);
            }, { once: true });
            existingScript.addEventListener('error', () => {
                AppState.map.isLoading = false;
                logError('카카오맵 API 로드 실패');
                mapPlaceholder.innerHTML = `
                    <div class="map-placeholder">
                        🗺️<br>
                        ${CONFIG.VENUE.name}<br>
                        <small>지도를 불러올 수 없습니다.</small>
                    </div>
                `;
            }, { once: true });
        }
        return;
    }

    if (AppState.map.scriptLoaded) {
        initializeMap();
        return;
    }

    if (AppState.map.isLoading) {
        return;
    }

    AppState.map.isLoading = true;

    const script = document.createElement('script');
    script.id = 'kakao-maps-sdk';
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CONFIG.KAKAO_MAP_API_KEY}&autoload=false&libraries=services`;
    script.onload = function () {
        AppState.map.scriptLoaded = true;
        AppState.map.isLoading = false;
        kakao.maps.load(initializeMap);
    };
    script.onerror = function () {
        AppState.map.isLoading = false;
        logError('카카오맵 API 로드 실패');
        mapPlaceholder.innerHTML = `
            <div class="map-placeholder">
                🗺️<br>
                ${CONFIG.VENUE.name}<br>
                <small>지도를 불러올 수 없습니다.</small>
            </div>
        `;
    };

    document.head.appendChild(script);
}

function initializeMap() {
    const mapPlaceholder = document.getElementById('map-placeholder');
    if (!mapPlaceholder) return;

    const searchAddress = CONFIG.VENUE.address;
    if (!searchAddress) {
        mapPlaceholder.innerHTML = '<div class="map-placeholder">주소 정보가 없어 지도를 표시할 수 없습니다.</div>';
        return;
    }

    if (AppState.map.initialized && AppState.map.lastAddress === searchAddress) {
        return;
    }

    if (typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.services) {
        logError('카카오맵 SDK가 초기화되지 않았습니다.');
        mapPlaceholder.innerHTML = '<div class="map-placeholder">지도를 불러올 수 없습니다.</div>';
        return;
    }

    mapPlaceholder.innerHTML = '<div id="map" style="width:100%;height:300px;border-radius:8px;border:2px solid #1e40af;"></div>';
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    const defaultCenter = new kakao.maps.LatLng(37.4656, 127.0347);
    const map = new kakao.maps.Map(mapContainer, {
        center: defaultCenter,
        level: 3
    });

    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(searchAddress, function (result, status) {
        if (status === kakao.maps.services.Status.OK && result.length > 0) {
            const coords = new kakao.maps.LatLng(result[0].y, result[0].x);
            map.setCenter(coords);

            const marker = new kakao.maps.Marker({
                map,
                position: coords
            });

            const infowindow = new kakao.maps.InfoWindow({
                content: `<div style="padding:5px;font-size:12px;text-align:center;">${CONFIG.VENUE.name || '구장'}</div>`
            });
            infowindow.open(map, marker);
        } else {
            logInfo(`주소 검색 실패: ${searchAddress}. 기본 위치로 설정.`);
            const marker = new kakao.maps.Marker({
                map,
                position: defaultCenter
            });

            const infowindow = new kakao.maps.InfoWindow({
                content: `<div style="padding:5px;font-size:12px;text-align:center;">${CONFIG.VENUE.name || '구장'}</div>`
            });
            infowindow.open(map, marker);
        }

        AppState.map.initialized = true;
        AppState.map.lastAddress = searchAddress;
    });
}

// --- [ 데이터 로드 함수 ] ---

async function loadFromGoogleSheets(season) {
    const season2026plus = parseInt(season) >= 2026;

    // 1단계: 경기 ID 목록 먼저
    const matchIdList = await supabaseFetch(
        `matches?season=eq.${season}&select=id`
    );
    const matchIds = matchIdList.map(m => m.id).join(",") || "0";

    // 2단계: 나머지 병렬 로드
    const [matchesRaw, playersRaw, mvpRaw] = await Promise.all([
        supabaseFetch(
            `matches_with_result?season=eq.${season}&order=date.desc`
        ),
        season2026plus
            ? supabaseFetch(
                `season_player_stats?season=eq.${season}&select=name,appearances,goals&order=goals.desc`
              )
            : supabaseFetch(
                `legacy_stats?season=eq.${season}&select=appearances,goals,mvp,players(name)&order=goals.desc`
              ),
        supabaseFetch(
            `match_mvps?select=raw_name,match_id&match_id=in.(${matchIds})`
        )
    ]);
    
    // MVP를 match_id 기준으로 매핑
    const mvpMap = {};
    mvpRaw.forEach(row => {
        if (!mvpMap[row.match_id]) mvpMap[row.match_id] = [];
        mvpMap[row.match_id].push(row.raw_name);
    });

    const matches = matchesRaw.map(m => ({
        date: m.date,
        opponent: m.opponent,
        result: m.result === "W" ? "win" : m.result === "D" ? "draw" : "loss",
        score: `${m.our_score}:${m.opp_score}`,
        venue: m.venue || "",
        mvp: (mvpMap[m.id] || []).join(", ")
    }));

    // players 포맷 변환
    const players = {};
    playersRaw.forEach(row => {
        const name = season2026plus ? row.name : row.players?.name;
        if (!name) return;
        players[name] = {
            appearances: row.appearances || 0,
            goals: row.goals || 0,
            mvp: row.mvp || 0
        };
    });

    return {
        season: season,
        matches: matches,
        players: players,
        schedules: [],
        regional: []
    };
}
// JSON 경로를 명확히 지정하여 로드
async function loadData() {
    AppState.data.matches = [];
    AppState.data.playerStats = {};
    AppState.data.regionalStats = [];

    try {
        showStatusMessage(`${AppState.data.currentSeason} 시즌 데이터를 불러오는 중...`, 'loading');
        
        if (AppState.network.currentAbortController) {
            AppState.network.currentAbortController.abort();
        }
        AppState.network.currentAbortController = new AbortController();

        let data, dataSource = 'JSON 파일';
        const currentSeasonKey = AppState.data.currentSeason;

        if (seasonDataCache.has(currentSeasonKey)) {
            data = seasonDataCache.get(currentSeasonKey);
            dataSource = '캐시';
        } else {
            const fetchJsonSeason = async () => {
                const response = await fetch(CONFIG.DATA_PATH(currentSeasonKey), {
                    signal: AppState.network.currentAbortController.signal,
                    headers: { 'Cache-Control': 'no-cache' }
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}: 파일을 찾을 수 없습니다.`);
                const rawData = await response.json();
                return validateSeasonData(rawData);
            };

            try {
                data = await loadFromGoogleSheets(currentSeasonKey);
                dataSource = 'Supabase';
            } catch (sbError) {
                logInfo('Supabase 로딩 실패, JSON 파일로 대체:', sbError.message);
                data = await fetchJsonSeason();
                dataSource = 'JSON 파일 (대체)';
            }

            seasonDataCache.set(currentSeasonKey, data);
        }

        // 데이터 할당 후 즉시 통계 카드 업데이트
        AppState.data.matches = data.matches || [];
        AppState.data.playerStats = data.players || {};
        AppState.data.regionalStats = data.regional || [];
        updateStats(); // 이 함수가 위에 정의되어 있으므로 이제 안전함

        updateTable(AppState.data.playerStats, AppState.data.matches, 'playersRankList', 'players');
        updateTable(AppState.data.matches, [], 'matchesList', 'matches');
        updateSchedule(data.schedules || []);
        updateRegionalTable(AppState.data.regionalStats, AppState.ui.currentRegionalFilter);
        createRegionalHeatmap(AppState.data.regionalStats);

        if (data.schedules && data.schedules.length > 0) {
             loadKakaoMap();
        }

        hideStatusMessage();
        logInfo(`${AppState.data.currentSeason} 시즌 데이터 로드 완료 (${dataSource})`, {
            경기수: AppState.data.matches.length,
            선수수: Object.keys(AppState.data.playerStats).length
        });

    } catch (error) {
        if (error.name === 'AbortError') {
            logInfo('데이터 로딩이 취소되었습니다.');
            return;
        }

        logError('데이터 로딩 실패:', error);
        showStatusMessage(`${AppState.data.currentSeason} 시즌 데이터를 불러올 수 없습니다.`, 'error');
        
        // 기본값으로 UI 업데이트
        updateStats();
        const playersRankList = document.getElementById('playersRankList');
        const matchesList = document.getElementById('matchesList');

        if (playersRankList) {
            playersRankList.innerHTML = '<div class="no-data">데이터를 불러올 수 없습니다.</div>';
        }
        if (matchesList) {
            matchesList.innerHTML = '<div class="no-data">데이터를 불러올 수 없습니다.</div>';
        }
    }
}

async function loadSeasonDataWithRetry(season, retries = 2) {
    const seasonKey = season.toString();
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (seasonDataCache.has(seasonKey)) {
                return { success: true, season: seasonKey, data: seasonDataCache.get(seasonKey) };
            }

            const fetchJsonSeason = async () => {
                const response = await fetch(CONFIG.DATA_PATH(seasonKey), { headers: { 'Cache-Control': 'no-cache' } });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const rawData = await response.json();
                return validateSeasonData(rawData);
            };

            let data;
            try {
                data = await loadFromGoogleSheets(seasonKey);
            } catch (sbError) {
                logError(`시즌 ${seasonKey} Supabase 로드 실패, JSON으로 대체`, sbError);
                data = await fetchJsonSeason();
            }

            seasonDataCache.set(seasonKey, data);
            return { success: true, season: seasonKey, data };
        } catch (error) {
            logError(`시즌 ${seasonKey} 데이터 로드 실패 (시도 ${attempt + 1})`, error);
            if (attempt === retries) {
                return { success: false, season: seasonKey, error };
            }
            await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        }
    }

    return { success: false, season: seasonKey };
}

// 병렬 데이터 로딩 (전체 기록)
async function loadAllTimeSeasonsParallel() {
    const allTimeStats = {};
    const allMatches = [];
    const allRegionalStats = new Map();
    const seasonData = {};
    let successCount = 0;
    let totalSeasons = CONFIG.AVAILABLE_SEASONS.length;

    showStatusMessage('역대 기록을 불러오는 중...', 'loading');
    showLoadingProgress(0, totalSeasons, '시즌 로딩 중');

    const batches = [];
    for (let i = 0; i < CONFIG.AVAILABLE_SEASONS.length; i += CONFIG.PARALLEL_LOADING.BATCH_SIZE) {
        batches.push(CONFIG.AVAILABLE_SEASONS.slice(i, i + CONFIG.PARALLEL_LOADING.BATCH_SIZE));
    }

    for (const batch of batches) {
        const batchPromises = batch.map(season => loadSeasonDataWithRetry(season));

        try {
            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value.success) {
                    const { season, data } = result.value;
                    successCount++;
                    seasonData[season] = data;

                    allMatches.push(...data.matches.map(match => ({ ...match, season: season })));

                    // 선수 통계 초기화 최적화
                    Object.entries(data.players).forEach(([name, stats]) => {
                        if (!allTimeStats[name]) {
                            allTimeStats[name] = { totalAppearances: 0, totalGoals: 0, totalMvp: 0 };
                        }
                        allTimeStats[name].totalAppearances += stats.appearances;
                        allTimeStats[name].totalGoals += stats.goals;
                        allTimeStats[name].totalMvp += stats.mvp;
                    });

                    // 지역별 데이터 누적 (모든 시즌)
                    if (data.regional && data.regional.length > 0) {
                        data.regional.forEach(region => {
                            const key = region.region;
                            const existing = allRegionalStats.get(key) || {
                                region: key,
                                matches: 0,
                                wins: 0,
                                draws: 0,
                                losses: 0
                            };

                            existing.matches += Number(region.matches) || 0;
                            existing.wins += Number(region.wins) || 0;
                            existing.draws += Number(region.draws) || 0;
                            existing.losses += Number(region.losses) || 0;

                            allRegionalStats.set(key, existing);
                        });
                    }
                }

                showLoadingProgress(successCount, totalSeasons, `${successCount}개 시즌 로딩 완료`);
            });

        } catch (error) {
            logError('배치 처리 중 오류:', error);
        }

        if (batches.indexOf(batch) < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    hideLoadingProgress();

    if (successCount === 0) {
        showStatusMessage('데이터를 불러올 수 없습니다. 인터넷 연결을 확인해주세요.', 'error');
        return { stats: {}, matches: [], records: null, regional: [] };
    } else if (successCount < totalSeasons) {
        showStatusMessage(`${successCount}/${totalSeasons} 시즌 데이터 로딩 완료`, 'success');
        setTimeout(hideStatusMessage, 3000);
    } else {
        hideStatusMessage();
    }

    const teamRecords = calculateTeamRecords(allMatches);
    const aggregatedRegional = Array.from(allRegionalStats.values());

    return {
        stats: allTimeStats,
        matches: allMatches,
        records: teamRecords,
        regional: aggregatedRegional
    };
}


// UI/Event Handler 함수
function filterPlayers(filter) {
    AppState.ui.currentFilter = filter;

    document.querySelectorAll('.player-filter-controls .filter-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.filter === filter);
    });

    if (AppState.data.isAllTimeView) {
        if (AppState.allTime.loaded) {
            updateAllTimeTable(AppState.allTime.stats, filter);
        }
    } else {
        updatePlayersTable(AppState.data.playerStats, filter);
    }
}

function filterRegional(filter) {
    AppState.ui.currentRegionalFilter = filter;

    document.querySelectorAll('.regional-filter-controls .filter-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.filter === filter);
    });

    const dataSource = AppState.data.isAllTimeView && AppState.allTime.loaded
        ? AppState.allTime.regional
        : AppState.data.regionalStats;

    updateRegionalTable(dataSource, filter);
    createRegionalHeatmap(dataSource);
}

function filterTeamRecords(sortBy) {
    AppState.ui.currentTeamSort = sortBy;

    if (AppState.data.isAllTimeView && AppState.allTime.loaded) {
        updateTeamRecords(AppState.allTime.records, sortBy);
    }
}

function updateRegionalTable(regionalData = AppState.data.regionalStats, sortBy = AppState.ui.currentRegionalFilter) {
    const tbody = document.getElementById('regionalTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!regionalData || regionalData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">지역별 데이터가 없습니다.</td></tr>';
        updateRegionalSortIndicators(sortBy);
        return;
    }

    const sorted = [...regionalData].map(region => {
        const matches = Number(region.matches) || 0;
        const wins = Number(region.wins) || 0;
        const draws = Number(region.draws) || 0;
        const losses = Number(region.losses) || 0;
        const winRate = matches ? (wins / matches) * 100 : 0;
        return {
            ...region,
            matches,
            wins,
            draws,
            losses,
            winRate
        };
    });

    sorted.sort((a, b) => {
        switch (sortBy) {
            case 'matches':
                return b.matches - a.matches;
            case 'wins':
                return b.wins - a.wins;
            case 'draws':
                return b.draws - a.draws;
            case 'losses':
                return b.losses - a.losses;
            case 'name':
                return koreanCollator.compare(a.region, b.region);
            case 'winrate':
            default:
                return b.winRate - a.winRate;
        }
    });

    sorted.forEach(region => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${region.region}</td>
            <td>${region.matches}</td>
            <td>${region.wins}</td>
            <td>${region.draws ?? 0}</td>
            <td>${region.losses ?? 0}</td>
            <td>${region.winRate.toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    });

    updateRegionalSortIndicators(sortBy);
}

function updateRegionalSortIndicators(activeSort) {
    const indicators = {
        name: document.getElementById('regionNameSort'),
        matches: document.getElementById('regionMatchesSort'),
        wins: document.getElementById('regionWinsSort'),
        draws: document.getElementById('regionDrawsSort'),
        losses: document.getElementById('regionLossesSort'),
        winrate: document.getElementById('regionWinrateSort')
    };

    Object.entries(indicators).forEach(([key, element]) => {
        if (!element) return;
        element.textContent = key === activeSort ? '↓' : '';
    });
}

function createRegionalHeatmap(regionalData = AppState.data.regionalStats) {
    const mapElement = document.getElementById('seoulMap');
    if (!mapElement) return;

    if (!regionalData || regionalData.length === 0) {
        mapElement.innerHTML = '<text x="20" y="40" fill="#6b7280">지역 데이터가 없습니다.</text>';
        return;
    }

    const enriched = regionalData.map(region => ({
        ...region,
        matches: Number(region.matches) || 0,
        wins: Number(region.wins) || 0,
        winRate: region.matches ? (region.wins / region.matches) * 100 : 0
    }));

    const getColorByWinRate = (winRate) => {
        if (winRate >= 60) return '#10b981';
        if (winRate >= 40) return '#f59e0b';
        return '#ef4444';
    };

    const columns = Math.min(4, enriched.length);
    const cellWidth = 90;
    const cellHeight = 70;
    const gap = 12;
    const padding = 20;
    const rows = Math.ceil(enriched.length / columns);
    const width = columns * cellWidth + (columns - 1) * gap + padding * 2;
    const height = rows * cellHeight + (rows - 1) * gap + padding * 2;

    mapElement.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const cells = enriched.map((region, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = padding + col * (cellWidth + gap);
        const y = padding + row * (cellHeight + gap);

        const fillColor = getColorByWinRate(region.winRate);

        return `
            <g transform="translate(${x}, ${y})">
                <rect width="${cellWidth}" height="${cellHeight}" rx="10" fill="${fillColor}" opacity="0.9"></rect>
                <text x="10" y="22" fill="#0f172a" font-size="13" font-weight="bold">${region.region}</text>
                <text x="10" y="42" fill="#0f172a" font-size="12">승률 ${region.winRate.toFixed(1)}%</text>
                <text x="10" y="60" fill="#111827" font-size="11">${region.matches}경기 · ${region.wins}승</text>
            </g>
        `;
    }).join('');

    mapElement.innerHTML = `
        <rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" rx="12"></rect>
        ${cells}
    `;
}

function updateAllTimeRankings(allTimeStats) {
    const highlightsContainer = document.getElementById('allTimeHighlights');
    if (!highlightsContainer) return;

    if (!allTimeStats || Object.keys(allTimeStats).length === 0) {
        highlightsContainer.innerHTML = '<div class="no-data">역대 선수 데이터가 없습니다.</div>';
        return;
    }

    const playersArray = Object.entries(allTimeStats).map(([name, stats]) => ({
        name,
        appearances: stats.totalAppearances ?? stats.appearances ?? 0,
        goals: stats.totalGoals ?? stats.goals ?? 0,
        mvp: stats.totalMvp ?? stats.mvp ?? 0
    }));

    if (playersArray.length === 0) {
        highlightsContainer.innerHTML = '<div class="no-data">역대 선수 데이터가 없습니다.</div>';
        return;
    }

    const topGoals = [...playersArray].sort((a, b) => b.goals - a.goals)[0];
    const topAppearances = [...playersArray].sort((a, b) => b.appearances - a.appearances)[0];
    const topMvp = [...playersArray].sort((a, b) => b.mvp - a.mvp)[0];

    const highlights = [
        { title: '최다 득점', value: `${topGoals.name} (${topGoals.goals}골)` },
        { title: '최다 출장', value: `${topAppearances.name} (${topAppearances.appearances}경기)` },
        { title: '최다 MVP', value: `${topMvp.name} (${topMvp.mvp}회)` }
    ];

    highlightsContainer.innerHTML = highlights.map(highlight => `
        <div class="highlight-card">
            <div class="highlight-title">${highlight.title}</div>
            <div class="highlight-value">${highlight.value}</div>
        </div>
    `).join('');
}

function updateTeamRecords(teamRecords, sortBy = AppState.ui.currentTeamSort) {
    const container = document.getElementById('teamRecordsContainer');
    if (!container) return;

    if (!teamRecords) {
        container.innerHTML = '<div class="no-data">팀 기록을 계산할 데이터가 없습니다.</div>';
        return;
    }

    const { overall, perSeason, biggestWin, toughestLoss } = teamRecords;
    const overallRecordText = `${overall.matches}경기 (${overall.wins}승 ${overall.draws}무 ${overall.losses}패)`;

    const sortedPerSeason = [...perSeason];
    sortedPerSeason.sort((a, b) => {
        switch (sortBy) {
            case 'matches':
                return b.matches - a.matches || b.winRate - a.winRate;
            case 'wins':
                return b.wins - a.wins || b.winRate - a.winRate;
            case 'winrate':
                return b.winRate - a.winRate || b.matches - a.matches;
            case 'losses':
                return b.losses - a.losses || b.matches - a.matches;
            case 'draws':
                return b.draws - a.draws || b.matches - a.matches;
            case 'season':
            default:
                return b.season.localeCompare(a.season);
        }
    });

    const seasonRows = sortedPerSeason.length > 0 ? sortedPerSeason.map(stats => `
        <tr>
            <td>${stats.season}</td>
            <td>${stats.matches}</td>
            <td>${stats.wins}</td>
            <td>${stats.draws}</td>
            <td>${stats.losses}</td>
            <td>${stats.winRate}%</td>
        </tr>
    `).join('') : '<tr><td colspan="6" class="no-data">시즌별 기록이 없습니다.</td></tr>';

    container.innerHTML = `
        <div class="team-overview">
            <div><span>총 경기</span><strong>${overallRecordText}</strong></div>
            <div><span>통산 승률</span><strong>${overall.winRate}%</strong></div>
            <div><span>득점 / 실점</span><strong>${overall.goalsFor} / ${overall.goalsAgainst}</strong></div>
        </div>
        <div class="team-highlights">
            <div>
                <span>최대 승리</span>
                <strong>${biggestWin ? `${biggestWin.season} ${biggestWin.score} vs ${biggestWin.opponent}` : '-'}</strong>
            </div>
            <div>
                <span>최대 패배</span>
                <strong>${toughestLoss ? `${toughestLoss.season} ${toughestLoss.score} vs ${toughestLoss.opponent}` : '-'}</strong>
            </div>
        </div>
        <div class="filter-controls team-sort-controls">
            <button class="filter-btn ${sortBy === 'season' ? 'active' : ''}" onclick="filterTeamRecords('season')">시즌 순</button>
            <button class="filter-btn ${sortBy === 'winrate' ? 'active' : ''}" onclick="filterTeamRecords('winrate')">승률 순</button>
            <button class="filter-btn ${sortBy === 'wins' ? 'active' : ''}" onclick="filterTeamRecords('wins')">승수 순</button>
            <button class="filter-btn ${sortBy === 'matches' ? 'active' : ''}" onclick="filterTeamRecords('matches')">경기수 순</button>
        </div>
        <div class="table-container">
            <table class="players-table">
                <thead>
                    <tr>
                        <th>시즌</th>
                        <th>경기수</th>
                        <th>승</th>
                        <th>무</th>
                        <th>패</th>
                        <th>승률</th>
                    </tr>
                </thead>
                <tbody>
                    ${seasonRows}
                </tbody>
            </table>
        </div>
    `;
}

function updateAllTimeTable(allTimeStats, sortBy = 'goals') {
    const tbody = document.getElementById('allTimePlayersTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!allTimeStats || Object.keys(allTimeStats).length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">역대 선수 데이터가 없습니다.</td></tr>';
        return;
    }

    let playersArray = Object.entries(allTimeStats).map(([name, stats]) => ({
        name,
        appearances: stats.totalAppearances ?? stats.appearances ?? 0,
        goals: stats.totalGoals ?? stats.goals ?? 0,
        mvp: stats.totalMvp ?? stats.mvp ?? 0
    }));

    switch (sortBy) {
        case 'attendance':
            playersArray.sort((a, b) => b.appearances - a.appearances || b.goals - a.goals || koreanCollator.compare(a.name, b.name));
            break;
        case 'mvp':
            playersArray.sort((a, b) => b.mvp - a.mvp || b.appearances - a.appearances || koreanCollator.compare(a.name, b.name));
            break;
        case 'goals':
            playersArray.sort((a, b) => b.goals - a.goals || b.appearances - a.appearances || koreanCollator.compare(a.name, b.name));
            break;
        default:
            playersArray.sort((a, b) => koreanCollator.compare(a.name, b.name));
    }

    playersArray.forEach(player => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${player.name}</td>
            <td>${player.appearances}</td>
            <td>${player.goals}</td>
            <td>${player.mvp}</td>
        `;
        tbody.appendChild(row);
    });
}

function updateButtonStates() {
    const allTimeButton = document.getElementById('allTimeButton');
    if (allTimeButton) {
        allTimeButton.classList.toggle('active', AppState.data.isAllTimeView);
        allTimeButton.innerHTML = AppState.data.isAllTimeView ? '🔙 시즌 보기' : '📊 역대 기록';
        allTimeButton.setAttribute('aria-pressed', AppState.data.isAllTimeView.toString());
        allTimeButton.setAttribute('aria-label', AppState.data.isAllTimeView ? '시즌 보기로 전환' : '역대 기록 보기');
    }
}

function updateViewVisibility() {
    document.body.classList.remove(
        'page-mode-home',
        'page-mode-seasons',
        'page-mode-matches',
        'page-mode-players',
        'page-mode-records'
    );
    document.body.classList.add(`page-mode-${AppState.ui.currentMainTab}`);

    document.querySelectorAll('.top-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === AppState.ui.currentMainTab);
    });
    document.querySelectorAll('.bottom-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === AppState.ui.currentMainTab);
    });
}

function onSeasonSelectClick() {
    if (AppState.data.isAllTimeView) {
        AppState.data.isAllTimeView = false;
        updateViewVisibility();
        updateButtonStates();
    }
}

function changeSeason() {
    const select = document.getElementById('seasonSelect');
    if (!select) return;

    const selectedSeason = select.value;
    if (selectedSeason === AppState.data.currentSeason && !AppState.data.isAllTimeView) {
        return;
    }

    AppState.data.currentSeason = selectedSeason;
    AppState.data.isAllTimeView = false;

    updateViewVisibility();

    updateButtonStates();
    loadData();
}

async function toggleAllTimeView() {
    AppState.data.isAllTimeView = !AppState.data.isAllTimeView;
    updateViewVisibility();

    if (AppState.data.isAllTimeView) {

        if (!AppState.allTime.loaded) {
            const allTimeTableBody = document.getElementById('allTimePlayersTableBody');
            if (allTimeTableBody) {
                allTimeTableBody.innerHTML = '<tr><td colspan="4" class="no-data">역대 기록을 불러오는 중...</td></tr>';
            }

            if (!AppState.allTime.loadingPromise) {
                AppState.allTime.loadingPromise = loadAllTimeSeasonsParallel().finally(() => {
                    AppState.allTime.loadingPromise = null;
                });
            }

            const result = await AppState.allTime.loadingPromise;
            if (result) {
                AppState.allTime.loaded = true;
                AppState.allTime.stats = result.stats;
                AppState.allTime.matches = result.matches;
                AppState.allTime.records = result.records;
                AppState.allTime.regional = result.regional;
            }
        }

        if (AppState.allTime.loaded) {
            updateAllTimeRankings(AppState.allTime.stats);
            updateAllTimeTable(AppState.allTime.stats, AppState.ui.currentFilter);
            updateTeamRecords(AppState.allTime.records, AppState.ui.currentTeamSort);
            updateRegionalTable(AppState.allTime.regional, AppState.ui.currentRegionalFilter);
            createRegionalHeatmap(AppState.allTime.regional);
        }
    }

    updateStats();
    updateButtonStates();
    filterPlayers(AppState.ui.currentFilter);
    filterRegional(AppState.ui.currentRegionalFilter);
}

async function switchMainTab(tab) {
    AppState.ui.currentMainTab = tab;

    if (tab === 'records') {
        if (!AppState.data.isAllTimeView) {
            await toggleAllTimeView();
            return;
        }
    } else if (AppState.data.isAllTimeView) {
        await toggleAllTimeView();
        return;
    }

    updateViewVisibility();
}

// 초기화/진입점 함수
function initializeApp() {
    AppState.data.currentSeason = CONFIG.DEFAULT_SEASON;
    AppState.ui.currentMainTab = 'home';
    
    // 초기 로드 시 시즌 통계 카드 구조를 먼저 그림
    renderSeasonStatCards();

    updateButtonStates();
    updateViewVisibility();

    // 초기 데이터 로드
    loadData().catch(error => {
        logError('초기 데이터 로드 실패:', error);
    });
}


// 페이지 로드 시 초기화 (DOMContentLoaded가defer속성으로 인해 안정적으로 실행)
document.addEventListener('DOMContentLoaded', initializeApp);

// 전역 함수 노출 (HTML에서 호출 가능하도록 window 객체에 등록)
window.changeSeason = changeSeason;
window.toggleAllTimeView = toggleAllTimeView;
window.onSeasonSelectClick = onSeasonSelectClick;
window.filterPlayers = filterPlayers;
window.filterRegional = filterRegional;
window.filterTeamRecords = filterTeamRecords;
window.switchMainTab = switchMainTab;
window.setMatchSort = setMatchSort;
