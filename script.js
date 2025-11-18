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

    return {
        season: season,
        matches: matches,
        players: players,
        schedules: schedules,
        regional: regional
    };
}

// 통계 업데이트
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

    document.getElementById('totalMatches').textContent = totalMatches.toString();
    document.getElementById('winRate').textContent = winRate + '%';
    document.getElementById('winRateSubtitle').textContent = `${wins}승 ${draws}무 ${losses}패`;
    document.getElementById('totalGoals').textContent = totalGoalsFor.toString();
    document.getElementById('goalsPerMatch').textContent = `경기당 ${goalsPerMatch}골`;
    document.getElementById('seasonMvp').textContent = mvpName;
    document.getElementById('mvpStats').textContent = mvpCount > 0 ? `MVP ${mvpCount}회` : 'MVP 0회';
}

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

// 데이터 로드
async function loadData() {
    AppState.data.matches = [];
    AppState.data.playerStats = {};
    AppState.data.regionalStats = [];

    try {
        showStatusMessage(`${AppState.data.currentSeason} 시즌 데이터를 불러오는 중...`, 'loading');

        let data;
        if (AppState.data.currentSeason === '2025') {
            try {
                data = await loadFromGoogleSheets(AppState.data.currentSeason);
            } catch (gsError) {
                logInfo('구글 시트 로딩 실패, JSON 파일로 대체:', gsError.message);
                // ✅ 경로 수정: 현재 디렉토리 명시
                const response = await fetch(`./${AppState.data.currentSeason}_data.json`); 
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                data = await response.json();
            }
        } else {
            // ✅ 경로 수정: 현재 디렉토리 명시
            const response = await fetch(`./${AppState.data.currentSeason}_data.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            data = await response.json();
        }

        AppState.data.matches = data.matches || [];
        AppState.data.playerStats = data.players || {};
        AppState.data.regionalStats = data.regional || [];
        
        updateStats();
        updateMatchesTable();
        updatePlayersTable();
        updateSchedule(data.schedules || []);

        if (data.schedules && data.schedules.length > 0) {
            loadKakaoMap();
        }

        hideStatusMessage();
    } catch (error) {
        logError('데이터 로딩 실패:', error);
        showStatusMessage(`${AppState.data.currentSeason} 시즌 데이터를 불러올 수 없습니다.`, 'error');
        updateStats();
    }
}

// 테이블 업데이트
function updateMatchesTable() {
    const tbody = document.getElementById('matchesTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!AppState.data.matches || AppState.data.matches.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">경기 데이터가 없습니다.</td></tr>';
        return;
    }

    AppState.data.matches.forEach(match => {
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

function updatePlayersTable() {
    const tbody = document.getElementById('playersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!AppState.data.playerStats || Object.keys(AppState.data.playerStats).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">선수 데이터가 없습니다.</td></tr>';
        return;
    }

    let playersArray = Object.entries(AppState.data.playerStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .filter(player => player.appearances > 0);

    // 필터가 'all'로 초기화되어 있으므로, 이름순으로 정렬
    playersArray.sort((a, b) => koreanCollator.compare(a.name, b.name));

    const totalMatches = AppState.data.matches.length;

    playersArray.forEach(player => {
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

// 일정 업데이트
function updateSchedule(schedules) {
    const scheduleContainer = document.querySelector('.schedule-container');
    if (!scheduleContainer) return;

    if (!schedules || schedules.length === 0) {
        scheduleContainer.innerHTML = `
            <h3 style="color: #1e40af; margin-bottom: 15px;">다음 경기 일정</h3>
            <div class="no-data">예정된 경기가 없습니다.</div>
        `;
    } else {
        const nextMatch = schedules[0];
        scheduleContainer.innerHTML = `
            <h3 style="color: #1e40af; margin-bottom: 15px;">다음 경기 일정</h3>
            <div class="schedule-item">
                <div class="schedule-date">${nextMatch.date}</div>
                <div class="schedule-time-venue">${nextMatch.time} | ${nextMatch.venue}</div>
                <div class="schedule-opponent">vs ${nextMatch.opponent}</div>
            </div>
        `;
        
        // 지도 업데이트를 위한 전역 CONFIG 값 변경
        if (nextMatch.address) {
            CONFIG.VENUE.name = nextMatch.venue || '구장';
            CONFIG.VENUE.address = nextMatch.address;
            CONFIG.VENUE.info = nextMatch.note || '';
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
    // 실제 API 키가 유효해야 지도가 로드됩니다.
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CONFIG.KAKAO_MAP_API_KEY}&autoload=false&libraries=services`;
    
    script.onload = function () {
        AppState.map.scriptLoaded = true;
        kakao.maps.load(initializeMap);
    };

    script.onerror = function () {
        logError('카카오맵 API 로드 실패');
    };

    document.head.appendChild(script);
}

function initializeMap() {
    const searchAddress = CONFIG.VENUE.address;
    
    if (AppState.map.initialized && AppState.map.lastAddress === searchAddress) {
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
                content: `<div style="padding:5px;font-size:12px;text-align:center;">${CONFIG.VENUE.name}</div>`
            });

            infowindow.open(map, marker);
            AppState.map.initialized = true;
            AppState.map.lastAddress = searchAddress;
        }
    });
}

// 시즌 변경
async function changeSeason() {
    const seasonSelect = document.getElementById('seasonSelect');
    const newSeason = seasonSelect?.value || CONFIG.DEFAULT_SEASON;

    if (AppState.data.currentSeason !== newSeason) {
        AppState.data.currentSeason = newSeason;
        await loadData();
    }
}

// 필터
function filterPlayers(filter) {
    AppState.ui.currentFilter = filter;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });
    
    // 이 함수에 정렬 로직이 포함되어야 합니다. (현재는 이름순)
    updatePlayersTable();
}

function filterRegional(filter) {
    // 역대 기록 모드에서만 작동
}

// 역대 기록
async function toggleAllTimeView() {
    alert('역대 기록 기능은 개발 중입니다.');
}

function onSeasonSelectClick() {
    // 시즌 선택 클릭 핸들러
}

// 초기화
function initializeApp() {
    AppState.data.currentSeason = CONFIG.DEFAULT_SEASON;
    loadData();
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializeApp);

// 전역 함수 노출
window.changeSeason = changeSeason;
window.toggleAllTimeView = toggleAllTimeView;
window.onSeasonSelectClick = onSeasonSelectClick;
window.filterPlayers = filterPlayers;
window.filterRegional = filterRegional;
