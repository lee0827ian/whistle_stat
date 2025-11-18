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

// 구글 시트에서 데이터 로드
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
    const regionalCsv = await regionalResponse.text();
    const regionalData = parseCSV(regionalCsv);

    return processSheetData(matchesData, playersData, scheduleData, regionalData, season);
}

// 데이터 처리
function processSheetData(matchesData, playersData, scheduleData, regionalData, season) {
    const matches = matchesData
        .filter(row => row['날짜'] && row['상대팀'])
        .map(row => ({
            date: row['날짜'],
            opponent: row['상대팀'],
            result: row['결과'],
            score: row['스코어'],
            mvp: row['MVP'] || ''
        }))
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

function validateMatches(matchesData) {
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

// DOM 요소 생성 (부분 생략)
function createStatsCard(title, value, subtitle, className = '') {
    const card = document.createElement('div');
    card.className = `stat-card ${className}`;
    
    // ... (DOM 생성 로직) ...
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'stat-title';
    titleDiv.textContent = title;
    
    const valueDiv = document.createElement('div');
    valueDiv.className = 'stat-value';
    valueDiv.textContent = value;
    
    const subtitleDiv = document.createElement('div');
    subtitleDiv.className = 'stat-subtitle';
    subtitleDiv.textContent = subtitle;
    
    card.appendChild(titleDiv);
    card.appendChild(valueDiv);
    card.appendChild(subtitleDiv);
    
    return card;
}

// 차트 메모리 관리 (부분 생략)
function destroyChart(chartInstance) {
    if (chartInstance) {
        chartInstance.destroy();
        return null;
    }
    return chartInstance;
}

function createWinRateTrendChart() {
    const canvas = document.getElementById('winRateTrendChart');
    if (!canvas) return;
    
    // ... (차트 생성 로직) ...
}

// MVP 선정
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

// UI 상태 관리
function updateButtonStates() {
    const allTimeButton = document.getElementById('allTimeButton');
    const seasonSelect = document.getElementById('seasonSelect');
    const container = document.querySelector('.container');

    if (AppState.data.isAllTimeView) {
        allTimeButton?.classList.add('active');
        if (seasonSelect) seasonSelect.style.opacity = '0.6';
        container?.classList.add('all-time-view');
    } else {
        allTimeButton?.classList.remove('active');
        if (seasonSelect) seasonSelect.style.opacity = '1';
        container?.classList.remove('all-time-view');
    }
}

function onSeasonSelectClick() {
    if (AppState.data.isAllTimeView) {
        setTimeout(() => {
            changeSeason();
        }, 10);
    }
}

// 시즌 데이터 로딩 (캐싱 포함)
async function loadSeasonDataWithRetry(season, retries = 2) {
    // 캐시 확인
    if (seasonDataCache.has(season)) {
        logInfo(`캐시에서 ${season} 시즌 데이터 로드`);
        return { season, data: seasonDataCache.get(season), success: true };
    }

    let lastError = null;

    for (let i = 0; i <= retries; i++) {
        try {
            // 2025년인 경우만 구글 시트 시도
            if (season === '2025') {
                try {
                    const data = await loadFromGoogleSheets(season);
                    seasonDataCache.set(season, data);
                    return { season, data, success: true };
                } catch (gsError) {
                    logInfo(`구글 시트 로딩 실패, JSON 시도: ${gsError.message}`);
                }
            }

            // JSON 파일 로드
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            // ✅ 경로 수정: 현재 디렉토리 명시
            const response = await fetch(`./${season}_data.json`, {
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'no-cache',
                    'Accept': 'application/json'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const rawData = await response.json();
            const validatedData = validateSeasonData(rawData);
            seasonDataCache.set(season, validatedData);
            return { season, data: validatedData, success: true };

        } catch (error) {
            lastError = error;
            if (error.name === 'AbortError') {
                logInfo(`${season} 로딩 타임아웃 (시도 ${i + 1}/${retries + 1})`);
            } else {
                logInfo(`${season} 로딩 실패 (시도 ${i + 1}/${retries + 1}):`, error.message);
            }

            if (i < retries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }

    return { season, data: null, success: false, error: lastError };
}

// 병렬 데이터 로딩 (부분 생략)
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

// 팀 기록 계산 (부분 생략)
function calculateTeamRecords(matches, seasonData) {
    // ... (계산 로직) ...
    let maxWinStreak = 0;
    let currentWinStreak = 0;
    let winStreakStart = null;
    let winStreakEnd = null;
    let maxWinStreakStart = null;
    let maxWinStreakEnd = null;

    let maxLossStreak = 0;
    let currentLossStreak = 0;
    let lossStreakStart = null;
    let lossStreakEnd = null;
    let maxLossStreakStart = null;
    let maxLossStreakEnd = null;

    let maxGoalsMatch = null;
    let maxConcededMatch = null;

    let totalMatches = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;

    const seasonStats = {};

    // 시즌별 통계 계산
    Object.entries(seasonData).forEach(([season, data]) => {
        if (!data || !data.matches || data.matches.length === 0) return;

        let seasonWins = 0;
        let seasonDraws = 0;
        let seasonLosses = 0;
        let seasonGoalsFor = 0;
        let seasonGoalsAgainst = 0;

        data.matches.forEach(match => {
            const [gf, ga] = match.score.split(':').map(Number);
            seasonGoalsFor += gf;
            seasonGoalsAgainst += ga;

            if (match.result === 'win') seasonWins++;
            else if (match.result === 'draw') seasonDraws++;
            else seasonLosses++;
        });

        const seasonTotalMatches = data.matches.length;
        const winRate = seasonTotalMatches > 0 ? (seasonWins / seasonTotalMatches) * 100 : 0;

        seasonStats[season] = {
            matches: seasonTotalMatches,
            wins: seasonWins,
            draws: seasonDraws,
            losses: seasonLosses,
            goalsFor: seasonGoalsFor,
            goalsAgainst: seasonGoalsAgainst,
            winRate: winRate
        };
    });

    let bestSeason = null;
    let worstSeason = null;
    let highestWinRate = -1;
    let lowestWinRate = 101;

    Object.entries(seasonStats).forEach(([season, stats]) => {
        if (stats.matches >= 5) {
            if (stats.winRate > highestWinRate) {
                highestWinRate = stats.winRate;
                bestSeason = { season, ...stats };
            }
            if (stats.winRate < lowestWinRate) {
                lowestWinRate = stats.winRate;
                worstSeason = { season, ...stats };
            }
        }
    });

    const sortedMatches = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedMatches.forEach(match => {
        const [gf, ga] = match.score.split(':').map(Number);
        totalMatches++;
        goalsFor += gf;
        goalsAgainst += ga;

        if (match.result === 'win') {
            wins++;
            if (currentWinStreak === 0) {
                winStreakStart = match.date;
            }
            currentWinStreak++;
            winStreakEnd = match.date;

            if (currentWinStreak > maxWinStreak) {
                maxWinStreak = currentWinStreak;
                maxWinStreakStart = winStreakStart;
                maxWinStreakEnd = winStreakEnd;
            }
            currentLossStreak = 0;
        } else if (match.result === 'draw') {
            draws++;
            currentWinStreak = 0;
            currentLossStreak = 0;
        } else {
            losses++;
            if (currentLossStreak === 0) {
                lossStreakStart = match.date;
            }
            currentLossStreak++;
            lossStreakEnd = match.date;

            if (currentLossStreak > maxLossStreak) {
                maxLossStreak = currentLossStreak;
                maxLossStreakStart = lossStreakStart;
                maxLossStreakEnd = lossStreakEnd;
            }
            currentWinStreak = 0;
        }

        if (!maxGoalsMatch || gf > parseInt(maxGoalsMatch.score.split(':')[0])) {
            maxGoalsMatch = match;
        }

        if (!maxConcededMatch || ga > parseInt(maxConcededMatch.score.split(':')[1])) {
            maxConcededMatch = match;
        }
    });

    return {
        totalMatches,
        wins,
        draws,
        losses,
        goalsFor,
        goalsAgainst,
        maxWinStreak: {
            count: maxWinStreak,
            startDate: maxWinStreakStart,
            endDate: maxWinStreakEnd
        },
        maxLossStreak: {
            count: maxLossStreak,
            startDate: maxLossStreakStart,
            endDate: maxLossStreakEnd
        },
        maxGoalsMatch,
        maxConcededMatch,
        bestSeason,
        worstSeason
    };
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

// 역대 기록 관리
async function toggleAllTimeView() {
    const chartsSection = document.querySelector('.charts-section');

    if (AppState.data.isAllTimeView) {
        // All-Time -> Season 전환
        AppState.data.isAllTimeView = false;
        const seasonSelect = document.getElementById('seasonSelect');
        AppState.data.currentSeason = seasonSelect?.value || CONFIG.DEFAULT_SEASON;
        
        const mainContent = document.getElementById('mainContent');
        const allTimeContent = document.getElementById('allTimeContent');
        
        if (mainContent) mainContent.style.display = 'grid';
        if (allTimeContent) allTimeContent.style.display = 'none';
        
        updateButtonStates();
        
        const scheduleSection = document.querySelector('.schedule-venue-section');
        if (scheduleSection) {
            scheduleSection.style.display = 'block';
        }
        
        // Fix 3: 시즌 통계 카드로 복구
        renderSeasonStatCards();

        // Fix 1: 차트 섹션 숨기기
        if (chartsSection) chartsSection.style.display = 'none';
        
        await loadData();
    } else {
        // Season -> All-Time 전환
        AppState.data.isAllTimeView = true;
        
        const mainContent = document.getElementById('mainContent');
        const allTimeContent = document.getElementById('allTimeContent');
        
        if (mainContent) mainContent.style.display = 'none';
        if (allTimeContent) allTimeContent.style.display = 'grid';
        
        updateButtonStates();

        const scheduleSection = document.querySelector('.schedule-venue-section');
        if (scheduleSection) {
            scheduleSection.style.display = 'none';
        }

        // Fix 1: 차트 섹션 보이기
        if (chartsSection) chartsSection.style.display = 'block';

        try {
            const { stats: allTimeStats, records: teamRecords, regional: regionalData } = await loadAllTimeSeasonsParallel();
            
            // All-Time UI 업데이트
            updateAllTimeRankings(allTimeStats);
            updateAllTimeTable(allTimeStats, AppState.ui.currentFilter);
            updateTeamRecords(teamRecords);
            updateRegionalTable(regionalData);
            
            // Fix 1: 차트 생성
            createRegionalHeatmap();
            createWinRateTrendChart();
            
        } catch (error) {
            showStatusMessage('역대 기록을 불러오는 중 오류가 발생했습니다.', 'error');
            logError('역대 기록 로딩 오류:', error);
        }
    }
}

// 시즌 변경
async function changeSeason() {
    const seasonSelect = document.getElementById('seasonSelect');
    const newSeason = seasonSelect?.value || CONFIG.DEFAULT_SEASON;

    if (AppState.data.isAllTimeView || AppState.data.currentSeason !== newSeason) {
        if (AppState.data.isAllTimeView) {
            AppState.data.isAllTimeView = false;
            updateButtonStates();
            
            const mainContent = document.getElementById('mainContent');
            const allTimeContent = document.getElementById('allTimeContent');
            
            if (mainContent) mainContent.style.display = 'grid';
            if (allTimeContent) allTimeContent.style.display = 'none';
            
            // Fix 3: 시즌 통계 카드로 복구
            renderSeasonStatCards();

            // Fix 1: 차트 섹션 숨기기
            const chartsSection = document.querySelector('.charts-section');
            if (chartsSection) chartsSection.style.display = 'none';
        }
        AppState.data.currentSeason = newSeason;
        await loadData();
    }
}

// 메인 데이터 로드 함수 (JSON 경로 수정됨)
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
        updateStats(); // 가장 먼저 호출

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

// 테이블 업데이트
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

function updatePlayersTable(playerStats, tableBody) {
    if (!playerStats || Object.keys(playerStats).length === 0) {
        const noDataRow = document.createElement('tr');
        const noDataCell = document.createElement('td');
        noDataCell.setAttribute('colspan', '5');
        noDataCell.className = 'no-data';
        noDataCell.textContent = '선수 데이터가 없습니다.';
        noDataRow.appendChild(noDataCell);
        tableBody.appendChild(noDataRow);
        return;
    }

    let playersArray = Object.entries(playerStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .filter(player => player.appearances > 0);

    // 필터에 따른 정렬
    switch(AppState.ui.currentFilter) {
        case 'goals':
            playersArray.sort((a, b) => {
                if (b.goals !== a.goals) return b.goals - a.goals;
                if (b.appearances !== a.appearances) return b.appearances - a.appearances;
                return koreanCollator.compare(a.name, b.name);
            });
            break;
        case 'attendance':
            playersArray.sort((a, b) => {
                if (b.appearances !== a.appearances) return b.appearances - a.appearances;
                if (b.goals !== a.goals) return b.goals - a.goals;
                return koreanCollator.compare(a.name, b.name);
            });
            break;
        case 'mvp':
            playersArray.sort((a, b) => {
                if (b.mvp !== a.mvp) return b.mvp - a.mvp;
                if (b.appearances !== a.appearances) return b.appearances - a.appearances;
                return koreanCollator.compare(a.name, b.name);
            });
            break;
        default:
            playersArray.sort((a, b) => koreanCollator.compare(a.name, b.name));
    }

    const totalMatches = AppState.data.matches.length;

    playersArray.forEach((player, index) => {
        const row = document.createElement('tr');
        
        // 이름 셀
        const nameCell = document.createElement('td');
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = player.name;
        nameCell.appendChild(nameStrong);

        // 출전 셀
        const appearancesCell = document.createElement('td');
        const appearancesStrong = document.createElement('strong');
        appearancesStrong.textContent = player.appearances.toString();
        appearancesCell.appendChild(appearancesStrong);

        // 참석률 셀
        const attendanceCell = document.createElement('td');
        const attendanceRate = totalMatches > 0 ? Math.round((player.appearances / totalMatches) * 100) : 0;
        const attendanceSpan = document.createElement('span');
        attendanceSpan.className = `attendance-rate ${
            attendanceRate >= 70 ? 'rate-high' :
            attendanceRate >= 40 ? 'rate-medium' : 'rate-low'
        }`;
        attendanceSpan.textContent = `${attendanceRate}%`;
        attendanceCell.appendChild(attendanceSpan);

        // 골 셀
        const goalsCell = document.createElement('td');
        goalsCell.textContent = player.goals.toString();

        // MVP 셀
        const mvpCell = document.createElement('td');
        if (player.mvp > 0) {
            const mvpSpan = document.createElement('span');
            mvpSpan.className = 'mvp-badge';
            mvpSpan.title = `${player.name} ${player.mvp}회`;
            mvpSpan.textContent = `${player.mvp}회`;
            mvpCell.appendChild(mvpSpan);
        } else {
            mvpCell.textContent = '0';
        }

        row.appendChild(nameCell);
        row.appendChild(appearancesCell);
        row.appendChild(attendanceCell);
        row.appendChild(goalsCell);
        row.appendChild(mvpCell);

        tableBody.appendChild(row);
    });
}

function updateMatchesTable(matches, tableBody) {
    if (!matches || matches.length === 0) {
        const noDataRow = document.createElement('tr');
        const noDataCell = document.createElement('td');
        noDataCell.setAttribute('colspan', '5');
        noDataCell.className = 'no-data';
        noDataCell.textContent = '경기 데이터가 없습니다.';
        noDataRow.appendChild(noDataCell);
        tableBody.appendChild(noDataRow);
        return;
    }

    matches.forEach(match => {
        const row = document.createElement('tr');

        // 날짜 셀
        const dateCell = document.createElement('td');
        dateCell.textContent = match.date;

        // 상대 셀
        const opponentCell = document.createElement('td');
        const opponentStrong = document.createElement('strong');
        opponentStrong.textContent = match.opponent;
        opponentCell.appendChild(opponentStrong);

        // 결과 셀
        const resultCell = document.createElement('td');
        const resultSpan = document.createElement('span');
        resultSpan.className = `result-badge result-${match.result}`;
        resultSpan.textContent = match.result === 'win' ? '승' : match.result === 'draw' ? '무' : '패';
        resultCell.appendChild(resultSpan);

        // 스코어 셀
        const scoreCell = document.createElement('td');
        const scoreStrong = document.createElement('strong');
        scoreStrong.textContent = match.score;
        scoreCell.appendChild(scoreStrong);

        // MVP 셀
        const mvpCell = document.createElement('td');
        if (match.mvp) {
            const mvpSpan = document.createElement('span');
            mvpSpan.className = 'mvp-badge';
            mvpSpan.title = `${match.mvp} MVP`;
            mvpSpan.textContent = match.mvp;
            mvpCell.appendChild(mvpSpan);
        } else {
            mvpCell.textContent = '-';
        }

        row.appendChild(dateCell);
        row.appendChild(opponentCell);
        row.appendChild(resultCell);
        row.appendChild(scoreCell);
        row.appendChild(mvpCell);

        tableBody.appendChild(row);
    });
}

// 일정 업데이트
function updateSchedule(schedules) {
    const scheduleContainer = document.querySelector('.schedule-container');
    const venueInfo = document.querySelector('.venue-info');

    if (!scheduleContainer || !venueInfo) return;

    // 기본값 설정 (성불빌라)
    let currentVenue = {
        name: '성불빌라',
        address: '서울 노원구 동일로231가길 7',
        info: '전화번호: 031-790-2022, 주차 편함'
    };

    if (!schedules || schedules.length === 0) {
        scheduleContainer.innerHTML = `
            <h3 style="color: #1e40af; margin-bottom: 15px;">다음 경기 일정</h3>
            <div class="no-data">예정된 경기가 없습니다.</div>
        `;
    } else {
        const nextMatch = schedules[0]; // 가장 가까운 경기
        currentVenue = {
            name: nextMatch.venue || '구장 정보 없음',
            address: nextMatch.address || '주소 정보 없음',
            info: nextMatch.note || '비고 정보 없음'
        };

        scheduleContainer.innerHTML = `
            <h3 style="color: #1e40af; margin-bottom: 15px;">다음 경기 일정</h3>
            <div class="schedule-item">
                <div class="schedule-date">${nextMatch.date}</div>
                <div class="schedule-time-venue">${nextMatch.time} | ${nextMatch.venue}</div>
                <div class="schedule-opponent">vs ${nextMatch.opponent}</div>
            </div>
        `;
        logInfo('일정 업데이트 완료', { nextMatch });
    }

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

// 카카오맵
function loadKakaoMap() {
    if (AppState.map.scriptLoaded) {
        initializeMap();
        return;
    }

    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CONFIG.KAKAO_MAP_API_KEY}&autoload=false&libraries=services`;
    
    script.onload = function () {
        AppState.map.scriptLoaded = true;
        kakao.maps.load(initializeMap);
    };

    script.onerror = function () {
        logError('카카오맵 API 로드 실패');
        document.getElementById('map-placeholder').innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#666;">
                <div>🗺️</div>
                <div style="margin-top:10px;">${CONFIG.VENUE.name || '구장'}</div>
                <div style="font-size:12px;margin-top:5px;">지도를 불러올 수 없습니다 (API 오류)</div>
            </div>
        `;
    };

    document.head.appendChild(script);
}

function initializeMap() {
    const searchAddress = CONFIG.VENUE.address || '경서울 노원구 동일로231가길 7';
    
    if (AppState.map.initialized && AppState.map.lastAddress === searchAddress) {
        logInfo('맵이 이미 초기화되어 있고 주소 변경 없음');
        return;
    }

    const mapPlaceholder = document.getElementById('map-placeholder');
    if (!mapPlaceholder) return;

    mapPlaceholder.innerHTML = '<div id="map" style="width:100%;height:300px;border-radius:8px;border:2px solid #1e40af;"></div>';
    const mapContainer = document.getElementById('map');
    
    const defaultCenter = new kakao.maps.LatLng(37.4656, 127.0347);

    const map = new kakao.maps.Map(mapContainer, {
        center: defaultCenter,
        level: 3
    });

    const geocoder = new kakao.maps.services.Geocoder();
    
    geocoder.addressSearch(searchAddress, function (result, status) {
        if (status === kakao.maps.services.Status.OK) {
            const coords = new kakao.maps.LatLng(result[0].y, result[0].x);
            map.setCenter(coords);

            const marker = new kakao.maps.Marker({
                map: map,
                position: coords
            });

            const infowindow = new kakao.maps.InfoWindow({
                content: `<div style="padding:5px;font-size:12px;text-align:center;">${CONFIG.VENUE.name || '구장'}</div>`
            });

            infowindow.open(map, marker);
            AppState.map.initialized = true;
            AppState.map.lastAddress = searchAddress;

        } else {
            logInfo(`주소 검색 실패: ${searchAddress}. 기본 위치로 설정.`, status);
            map.setCenter(defaultCenter);
            
            const marker = new kakao.maps.Marker({
                map: map,
                position: defaultCenter
            });
            
            const infowindow = new kakao.maps.InfoWindow({
                content: `<div style="padding:5px;font-size:12px;text-align:center;">${CONFIG.VENUE.name || '성불빌라'}</div>`
            });

            infowindow.open(map, marker);
            AppState.map.initialized = true;
            AppState.map.lastAddress = searchAddress;
        }
    });
}

// 선수 필터
function filterPlayers(filter) {
    AppState.ui.currentFilter = filter;

    const filterBtns = document.querySelectorAll('.section .filter-btn, .all-time-content .filter-btn');
    filterBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });

    if (AppState.data.isAllTimeView) {
        loadAllTimeSeasonsParallel().then(({ stats: allTimeStats }) => {
            updateAllTimeTable(allTimeStats, filter);
        });
    } else {
        updateTable(AppState.data.playerStats, AppState.data.matches, 'playersTableBody', 'players');
    }
}

// 지역별 필터 (부분 생략)
function filterRegional(filter) {
    AppState.ui.currentRegionalFilter = filter;

    document.querySelectorAll('.regional-records-section .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });

    updateRegionalSortIndicators(filter);

    if (AppState.data.isAllTimeView) {
        loadAllTimeSeasonsParallel().then(({ regional: regionalData }) => {
            updateRegionalTable(regionalData);
        });
    }
}

function updateRegionalTable(regionalData) {
    // ... (UI 업데이트 로직) ...
}

function updateRegionalSortIndicators(activeSort) {
    // ... (UI 업데이트 로직) ...
}

function createRegionalHeatmap() {
    // ... (SVG 생성 로직) ...
}

// 초기화
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

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializeApp);

// 전역 함수 노출
window.changeSeason = changeSeason;
window.toggleAllTimeView = toggleAllTimeView;
window.onSeasonSelectClick = onSeasonSelectClick;
window.filterPlayers = filterPlayers;
window.filterRegional = filterRegional;
