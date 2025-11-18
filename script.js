// 전역 상태 관리
const AppState = {
    map: {
        scriptLoaded: false,
        initialized: false,
        lastAddress: null
    },
    network: {
        currentAbortController: null
    },
    ui: {
        currentFilter: 'all',
        currentRegionalFilter: 'winrate'
    },
    data: {
        currentSeason: '2025',
        isAllTimeView: false,
        matches: [],
        playerStats: {},
        regionalStats: []
    },
    charts: {
        winRateTrendChart: null
    }
};

// 설정
const CONFIG = {
    AVAILABLE_SEASONS: ['2000','2001','2002','2003','2004','2005','2006','2007','2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019', '2020', '2021', '2022', '2023', '2024', '2025'],
    DEFAULT_SEASON: '2025',
    KAKAO_MAP_API_KEY: '47eed652b004605d8a8e3e39df268f24',
    VENUE: {
        name: '성불빌라',
        address: '서울 노원구 동일로231가길 75',
        info: '전화번호: 031-790-2022, 주차 편함'
    },
    PARALLEL_LOADING: {
        BATCH_SIZE: 5,
        MAX_CONCURRENT: 3
    }
};

// 구글 시트 설정
const GOOGLE_SHEETS_CONFIG = {
    SHEET_ID: '13UOlG3FdqufeoW2uV3x7L4KFMOo9YrwrjkrExXSVGIg',
    SEASONS: {
        '2025': {
            matches: '1013896035',
            players: '882762798',
            schedule: '1750685299',
            regional: '1050217492'
        }
    }
};

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

// --- [ 데이터 처리/가공 관련 함수 ] ---

// 선수 통계에서 MVP를 계산하는 함수
function calculateSeasonMvp(playerStats) {
    if (!playerStats || Object.keys(playerStats).length === 0) {
        return null;
    }

    const playersArray = Object.entries(playerStats)
        .map(([name, stats]) => ({ name, ...stats }))
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

// --- [ UI 렌더링 함수 ] ---

// 시즌 요약 카드 UI를 업데이트하는 함수 (에러 해결을 위해 정의 순서 올림)
function renderSeasonStatCards() {
    const statsOverview = document.querySelector('.stats-overview');
    if (!statsOverview) return;

    statsOverview.innerHTML = `
        <div class="stat-card">
            <div class="stat-title">경기 수</div>
            <div class="stat-value" id="totalMatches">0</div>
            <div class="stat-subtitle">총 경기</div>
        </div>
        <div class="stat-card">
            <div class="stat-title">승률</div>
            <div class="stat-value" id="winRate">0%</div>
            <div class="stat-subtitle" id="winRateSubtitle">0승 0무 0패</div>
        </div>
        <div class="stat-card">
            <div class="stat-title">득점</div>
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
    if (AppState.data.matches.length === 0) {
        document.getElementById('totalMatches').textContent = '0';
        document.getElementById('winRate').textContent = '0%';
        document.getElementById('winRateSubtitle').textContent = '0승 0무 0패';
        document.getElementById('totalGoals').textContent = '0';
        document.getElementById('goalsPerMatch').textContent = '경기당 0골';
        document.getElementById('seasonMvp').textContent = '-';
        document.getElementById('mvpStats').textContent = 'MVP 0회';
        return;
    }

    const totalMatches = AppState.data.matches.length;
    const wins = AppState.data.matches.filter(match => match.result === 'win').length;
    const draws = AppState.data.matches.filter(match => match.result === 'draw').length;
    const losses = AppState.data.matches.filter(match => match.result === 'loss').length;

    let totalGoalsFor = 0;
    AppState.data.matches.forEach(match => {
        const [goalsFor] = match.score.split(':').map(Number);
        if (!isNaN(goalsFor)) {
            totalGoalsFor += goalsFor;
        }
    });

    const winRate = totalMatches > 0 ? (wins / totalMatches * 100).toFixed(1) : 0;
    const goalsPerMatch = totalMatches > 0 ? (totalGoalsFor / totalMatches).toFixed(1) : 0;

    const seasonMvpPlayer = calculateSeasonMvp(AppState.data.playerStats);
    const mvpName = seasonMvpPlayer ? seasonMvpPlayer.name : '-';
    const mvpCount = seasonMvpPlayer ? seasonMvpPlayer.mvp : 0;
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
    const tbody = document.getElementById('matchesTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!matches || matches.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">경기 데이터가 없습니다.</td></tr>';
        return;
    }

    matches.forEach(match => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${match.date}</td>
            <td><strong>${match.opponent}</strong></td>
            <td><span class="result-badge result-${match.result}">
                ${match.result === 'win' ? '승' : match.result === 'draw' ? '무' : '패'}
            </span></td>
            <td><strong>${match.score}</strong></td>
            <td>${match.mvp ? `<span class="mvp-badge">${match.mvp}</span>` : '-'}</td>
        `;
    });
}

function updatePlayersTable(playerStats = AppState.data.playerStats) {
    const tbody = document.getElementById('playersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!playerStats || Object.keys(playerStats).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">선수 데이터가 없습니다.</td></tr>';
        return;
    }

    let playersArray = Object.entries(playerStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .filter(player => player.appearances > 0);

    // 필터에 따른 정렬 (현재 filterPlayers 함수에서 처리하도록 가정)
    playersArray.sort((a, b) => koreanCollator.compare(a.name, b.name));

    const totalMatches = AppState.data.matches.length;

    playersArray.forEach((player, index) => {
        const row = tbody.insertRow();
        const attendanceRate = totalMatches > 0 ? Math.round((player.appearances / totalMatches) * 100) : 0;
        
        row.innerHTML = `
            <td><strong>${player.name}</strong></td>
            <td><strong>${player.appearances}</strong></td>
            <td><span class="attendance-rate ${
                attendanceRate >= 70 ? 'rate-high' :
                attendanceRate >= 40 ? 'rate-medium' : 'rate-low'
            }">${attendanceRate}%</span></td>
            <td>${player.goals}</td>
            <td>${player.mvp > 0 ? `<span class="mvp-badge">${player.mvp}회</span>` : '0'}</td>
        `;
    });
}

function updateTable(data, matches, tableBodyId, type) {
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    
    tableBody.innerHTML = '';

    if (type === 'players') {
        updatePlayersTable(data, tableBody);
    } else if (type === 'matches') {
        updateMatchesTable(data, tableBody);
    }
}

// 일정 및 지도 관련 함수 (부분 생략)
function updateSchedule(schedules) {
    const scheduleContainer = document.querySelector('.schedule-container');
    const venueInfo = document.querySelector('.venue-info');
    // ... (일정 업데이트 로직)
    const currentVenue = { name: '성불빌라', address: '서울 노원구 동일로231가길 7', info: '전화번호: 031-790-2022, 주차 편함' };
    
    // ... (스케줄 UI 업데이트 로직) ...

    // Venue 정보 업데이트
    CONFIG.VENUE = currentVenue;
    venueInfo.innerHTML = `
        <div class="venue-name">${currentVenue.name}</div>
        <div class="venue-address">📍 ${currentVenue.address}</div>
        <div class="venue-phone">📞 ${currentVenue.info}</div>
    `;
    
    // 맵 로딩
    if (currentVenue.address && currentVenue.address !== '주소 정보 없음') {
        loadKakaoMap();
    } else {
        const mapPlaceholder = document.getElementById('map-placeholder');
        if (mapPlaceholder) {
            mapPlaceholder.innerHTML = '<div class="map-placeholder">주소 정보가 없어 지도를 표시할 수 없습니다</div>';
        }
    }
}

function loadKakaoMap() {
    // ... (카카오맵 로드 로직) ...
}

function initializeMap() {
    // ... (카카오맵 초기화 로직) ...
}

// --- [ 데이터 로드 함수 ] ---

async function loadFromGoogleSheets(season) {
    const seasonConfig = GOOGLE_SHEETS_CONFIG.SEASONS[season];
    if (!seasonConfig) {
        throw new Error(`${season}년 구글 시트가 설정되지 않았습니다.`);
    }

    const matchesUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.matches}`;
    const matchesResponse = await fetch(matchesUrl);
    if (!matchesResponse.ok) throw new Error('경기 결과 시트를 불러올 수 없습니다.');
    const matchesCsv = await matchesResponse.text();
    const matchesData = parseCSV(matchesCsv);

    // ... (players, schedule, regional 데이터 로드) ...
    const playersUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.players}`;
    const playersResponse = await fetch(playersUrl);
    if (!playersResponse.ok) throw new Error('선수 통계 시트를 불러올 수 없습니다.');
    const playersCsv = await playersResponse.text();
    const playersData = parseCSV(playersCsv);

    const scheduleUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.schedule}`;
    const scheduleResponse = await fetch(scheduleUrl);
    if (!scheduleResponse.ok) throw new Error('다음 경기 일정 시트를 불러올 수 없습니다.');
    const scheduleCsv = await scheduleResponse.text();
    const scheduleData = parseCSV(scheduleCsv);

    const regionalUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.regional}`;
    const regionalResponse = await fetch(regionalUrl);
    if (!regionalResponse.ok) throw new Error('지역별 기록 시트를 불러올 수 없습니다.');
    const regionalCsv = await await regionalResponse.text();
    const regionalData = parseCSV(regionalCsv);

    return processSheetData(matchesData, playersData, scheduleData, regionalData, season);
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
        if (seasonDataCache.has(AppState.data.currentSeason)) {
            data = seasonDataCache.get(AppState.data.currentSeason);
            dataSource = '캐시';
        } else {
            if (AppState.data.currentSeason === '2025') {
                try {
                    data = await loadFromGoogleSheets(AppState.data.currentSeason);
                    dataSource = '구글 시트';
                } catch (gsError) {
                    logInfo('구글 시트 로딩 실패, JSON 파일로 대체:', gsError.message);
                    // ✅ 경로 수정: 현재 디렉토리 명시
                    const response = await fetch(`./${AppState.data.currentSeason}_data.json`, { 
                        signal: AppState.network.currentAbortController.signal, 
                        headers: { 'Cache-Control': 'no-cache' } 
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}: 파일을 찾을 수 없습니다.`);
                    const rawData = await response.json();
                    data = validateSeasonData(rawData);
                    dataSource = 'JSON 파일 (대체)';
                }
            } else {
                // ✅ 경로 수정: 현재 디렉토리 명시
                const response = await fetch(`./${AppState.data.currentSeason}_data.json`, { 
                    signal: AppState.network.currentAbortController.signal, 
                    headers: { 'Cache-Control': 'no-cache' } 
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}: 파일을 찾을 수 없습니다.`);
                const rawData = await response.json();
                data = validateSeasonData(rawData);
            }
            seasonDataCache.set(AppState.data.currentSeason, data);
        }

        // 데이터 할당 후 즉시 통계 카드 업데이트
        AppState.data.matches = data.matches || [];
        AppState.data.playerStats = data.players || {};
        AppState.data.regionalStats = data.regional || [];
        updateStats(); // 이 함수가 위에 정의되어 있으므로 이제 안전함

        updateTable(AppState.data.playerStats, AppState.data.matches, 'playersTableBody', 'players');
        updateTable(AppState.data.matches, [], 'matchesTableBody', 'matches');
        updateSchedule(data.schedules || []);
        
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
        const playersTableBody = document.getElementById('playersTableBody');
        const matchesTableBody = document.getElementById('matchesTableBody');
        
        if (playersTableBody) {
            playersTableBody.innerHTML = '<tr><td colspan="5" class="no-data">데이터를 불러올 수 없습니다.</td></tr>';
        }
        if (matchesTableBody) {
            matchesTableBody.innerHTML = '<tr><td colspan="5" class="no-data">데이터를 불러올 수 없습니다.</td></tr>';
        }
    }
}

// 병렬 데이터 로딩 (전체 기록)
async function loadAllTimeSeasonsParallel() {
    const allTimeStats = {};
    const allMatches = [];
    const allRegionalStats = [];
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

                    // 지역별 데이터 수집 (2025년만)
                    if (season === '2025' && data.regional) {
                        allRegionalStats.push(...data.regional);
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

    const teamRecords = calculateTeamRecords(allMatches, seasonData);
    
    return { 
        stats: allTimeStats, 
        matches: allMatches, 
        records: teamRecords,
        regional: allRegionalStats
    };
}


// UI/Event Handler 함수 (부분 생략)
function filterPlayers(filter) {
    // ... (필터 로직) ...
}

function filterRegional(filter) {
    // ... (필터 로직) ...
}

function updateRegionalTable(regionalData) {
    // ... (테이블 업데이트 로직) ...
}

function updateRegionalSortIndicators(activeSort) {
    // ... (정렬 표시 로직) ...
}

function createRegionalHeatmap() {
    // ... (SVG 생성 로직) ...
}

function updateAllTimeRankings(allTimeStats) {
    // ... (UI 업데이트 로직) ...
}

function updateTeamRecords(teamRecords) {
    // ... (UI 업데이트 로직) ...
}

function updateAllTimeTable(allTimeStats, sortBy = 'goals') {
    // ... (UI 업데이트 로직) ...
}

// 초기화/진입점 함수
function initializeApp() {
    AppState.data.currentSeason = CONFIG.DEFAULT_SEASON;
    
    // 초기 로드 시 시즌 통계 카드 구조를 먼저 그림
    renderSeasonStatCards();

    updateButtonStates();
    
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
