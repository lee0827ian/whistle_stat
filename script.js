// ========== 개선된 전역 상태 관리 ==========
        const AppState = {
            map: {
                scriptLoaded: false,
                initialized: false,
                lastAddress: null // Fix 2: 마지막 검색 주소 추적
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

        // ========== 설정 ==========
        const CONFIG = {
            AVAILABLE_SEASONS: ['2000','2001','2002','2003','2004','2005','2006','2007','2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019', '2020', '2021', '2022', '2023', '2024', '2025'],
            DEFAULT_SEASON: '2025',
            KAKAO_MAP_API_KEY: '47eed652b004605d8a8e3e39df268f24', // 실제 키를 여기에 입력해야 함
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

        // ========== 구글 시트 설정 ==========
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

        // ========== 유틸리티 - 최적화된 Collator (한 번만 생성) ==========
        const koreanCollator = new Intl.Collator('ko', { numeric: true });
        const seasonDataCache = new Map();

        // ========== 보안 함수 ==========
        function escapeHtml(unsafe) {
            if (typeof unsafe !== 'string') return unsafe;
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function sanitizeTableData(data) {
            return typeof data === 'string' ? escapeHtml(data) : data;
        }

        // ========== 개선된 에러 처리 ==========
        async function safeAsyncOperation(operation, errorMessage) {
            try {
                return await operation();
            } catch (error) {
                logError(errorMessage, error);
                showStatusMessage(errorMessage, 'error');
                throw error;
            }
        }

        // ========== 로깅 시스템 (개발/프로덕션 분리) ==========
        const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        function logError(message, error) {
            if (isDevelopment) {
                console.error(message, error);
            }
            // 프로덕션에서는 에러 로깅 서비스로 전송 가능
        }

        function logInfo(message, data) {
            if (isDevelopment) {
                console.log(message, data);
            }
        }

        // ========== CSV 파싱 함수 ==========
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

        // ========== 구글 시트에서 데이터 로드 ==========
        async function loadFromGoogleSheets(season) {
            const seasonConfig = GOOGLE_SHEETS_CONFIG.SEASONS[season];
            if (!seasonConfig) {
                throw new Error(`${season}년 구글 시트가 설정되지 않았습니다.`);
            }

            return await safeAsyncOperation(async () => {
                // 경기 결과 데이터 로드
                const matchesUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.matches}`;
                const matchesResponse = await fetch(matchesUrl);
                if (!matchesResponse.ok) throw new Error('경기 결과 시트를 불러올 수 없습니다.');
                const matchesCsv = await matchesResponse.text();
                const matchesData = parseCSV(matchesCsv);

                // 선수 통계 데이터 로드
                const playersUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.players}`;
                const playersResponse = await fetch(playersUrl);
                if (!playersResponse.ok) throw new Error('선수 통계 시트를 불러올 수 없습니다.');
                const playersCsv = await playersResponse.text();
                const playersData = parseCSV(playersCsv);

                // 다음 경기 일정 데이터 로드
                const scheduleUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.schedule}`;
                const scheduleResponse = await fetch(scheduleUrl);
                if (!scheduleResponse.ok) throw new Error('다음 경기 일정 시트를 불러올 수 없습니다.');
                const scheduleCsv = await scheduleResponse.text();
                const scheduleData = parseCSV(scheduleCsv);

                // 지역별 기록 데이터 로드
                const regionalUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.SHEET_ID}/export?format=csv&gid=${seasonConfig.regional}`;
                const regionalResponse = await fetch(regionalUrl);
                if (!regionalResponse.ok) throw new Error('지역별 기록 시트를 불러올 수 없습니다.');
                const regionalCsv = await regionalResponse.text();
                const regionalData = parseCSV(regionalCsv);

                // 데이터 변환 및 반환
                return processSheetData(matchesData, playersData, scheduleData, regionalData, season);
            }, '구글 시트 데이터 로딩 실패');
        }

        // ========== 데이터 처리 함수 ==========
        function processSheetData(matchesData, playersData, scheduleData, regionalData, season) {
            // 경기 데이터 변환
            const matches = validateMatches(matchesData)
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            // 선수 데이터 변환 및 초기화 최적화
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

            // 일정 데이터 변환
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

            // 지역별 데이터 변환
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

        // ========== 상태 메시지 관리 (기존 로직 유지) ==========
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

        // ========== 안전한 DOM 요소 생성 함수 (기존 로직 유지) ==========
        function createStatsCard(title, value, subtitle, className = '') {
            const card = document.createElement('div');
            card.className = `stat-card ${className}`;
            
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

        function createTableRow(data, cellClasses = []) {
            const row = document.createElement('tr');
            
            data.forEach((cellData, index) => {
                const cell = document.createElement('td');
                if (cellClasses[index]) {
                    cell.className = cellClasses[index];
                }
                
                if (typeof cellData === 'string') {
                    cell.textContent = cellData;
                } else {
                    cell.appendChild(cellData);
                }
                
                row.appendChild(cell);
            });
            
            return row;
        }

        // ========== 차트 메모리 관리 개선 (기존 로직 유지) ==========
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
            
            // 기존 차트 파괴
            AppState.charts.winRateTrendChart = destroyChart(AppState.charts.winRateTrendChart);
            
            const ctx = canvas.getContext('2d');
            const seasons = CONFIG.AVAILABLE_SEASONS;
            const winRateData = [];
            
            for (const season of seasons) {
                let seasonData = seasonDataCache.get(season);
                if (seasonData && seasonData.matches) {
                    const matches = seasonData.matches;
                    const wins = matches.filter(m => m.result === 'win').length;
                    const total = matches.length;
                    const rate = total > 0 ? (wins / total * 100).toFixed(1) : 0;
                    winRateData.push({
                        season: season,
                        rate: parseFloat(rate)
                    });
                }
            }
            
            if (winRateData.length === 0) {
                logInfo('차트용 데이터 없음');
                return;
            }
            
            AppState.charts.winRateTrendChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: winRateData.map(d => d.season + '시즌'),
                    datasets: [{
                        label: '승률 (%)',
                        data: winRateData.map(d => d.rate),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 5,
                        pointBackgroundColor: '#1e40af'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { position: 'top' }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: { 
                                callback: function(value) {
                                    return value + '%';
                                }
                            }
                        }
                    }
                }
            });
        }

        // ========== 데이터 검증 (기존 로직 유지) ==========
        function validateSeasonData(data) {
            const validatedData = {
                matches: [],
                players: {}
            };

            if (Array.isArray(data.matches)) {
                validatedData.matches = data.matches.filter(match => {
                    return match &&
                        typeof match.date === 'string' &&
                        typeof match.opponent === 'string' &&
                        typeof match.result === 'string' &&
                        typeof match.score === 'string' &&
                        ['win', 'draw', 'loss'].includes(match.result) &&
                        /^\d+:\d+$/.test(match.score);
                }).map(match => ({
                    date: sanitizeTableData(match.date),
                    opponent: sanitizeTableData(match.opponent),
                    result: match.result,
                    score: match.score,
                    mvp: sanitizeTableData(match.mvp || '')
                }));
            }

            if (data.players && typeof data.players === 'object') {
                Object.entries(data.players).forEach(([name, stats]) => {
                    if (typeof name === 'string' && stats && typeof stats === 'object') {
                        validatedData.players[sanitizeTableData(name)] = {
                            appearances: Math.max(0, parseInt(stats.appearances) || 0),
                            goals: Math.max(0, parseInt(stats.goals) || 0),
                            mvp: Math.max(0, parseInt(stats.mvp) || 0)
                        };
                    }
                });
            }

            return validatedData;
        }

        // ========== MVP 선정 함수 (기존 로직 유지) ==========
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

        // ========== UI 상태 관리 (기존 로직 유지) ==========
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

        // ========== 시즌 데이터 로딩 (캐싱 포함 - 기존 로직 유지) ==========
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

                    const response = await fetch(`${season}_data.json`, {
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

        // ========== 병렬 데이터 로딩 (기존 로직 유지) ==========
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

        // ========== 팀 기록 계산 (기존 로직 유지) ==========
        function calculateTeamRecords(matches, seasonData) {
            // 기존 로직을 그대로 유지하되, 로깅만 개선
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

        // Fix 3: 시즌 오버뷰 카드 구조를 다시 그리는 함수
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

        // ========== 역대 기록 관리 ==========
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

        // ========== 안전한 DOM 요소 업데이트 함수들 (기존 로직 유지) ==========
        function updateAllTimeRankings(allTimeStats) {
            const statsOverview = document.querySelector('.stats-overview');
            if (!statsOverview) return;

            const topScorers = Object.entries(allTimeStats)
                .map(([name, stats]) => ({name, ...stats}))
                .filter(player => player.totalGoals > 0)
                .sort((a, b) => b.totalGoals - a.totalGoals);

            const topMvps = Object.entries(allTimeStats)
                .map(([name, stats]) => ({name, ...stats}))
                .filter(player => player.totalMvp > 0)
                .sort((a, b) => {
                    if (b.totalMvp !== a.totalMvp) return b.totalMvp - a.totalMvp;
                    if (b.totalAppearances !== a.totalAppearances) return b.totalAppearances - a.totalAppearances;
                    return koreanCollator.compare(a.name, b.name);
                });

            const topAppearances = Object.entries(allTimeStats)
                .map(([name, stats]) => ({name, ...stats}))
                .filter(player => player.totalAppearances > 0)
                .sort((a, b) => b.totalAppearances - a.totalAppearances);

            const totalPlayers = Object.keys(allTimeStats).filter(name => 
                allTimeStats[name].totalAppearances > 0
            ).length;

            // DocumentFragment 대신 안전한 DOM 조작 사용
            statsOverview.innerHTML = '';
            
            const cards = [
                createStatsCard('역대 득점왕', topScorers[0]?.name || '-', `${topScorers[0]?.totalGoals || 0}골`, 'all-time-highlight'),
                createStatsCard('역대 MVP', topMvps[0]?.name || '-', `${topMvps[0]?.totalMvp || 0}회`, 'all-time-highlight'),
                createStatsCard('최다 출장', topAppearances[0]?.name || '-', `${topAppearances[0]?.totalAppearances || 0}경기`, 'all-time-highlight'),
                createStatsCard('등록 선수', totalPlayers.toString(), '명', 'all-time-highlight')
            ];

            cards.forEach(card => statsOverview.appendChild(card));
        }

        function updateTeamRecords(teamRecords) {
            const container = document.getElementById('teamRecordsContainer');
            if (!container) return;
            
            if (!teamRecords) {
                container.innerHTML = '<div class="no-data">팀 기록 데이터가 없습니다.</div>';
                return;
            }

            const formatDate = (dateStr) => {
                const date = new Date(dateStr);
                return date.toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            };

            // 안전한 DOM 조작으로 변경
            container.innerHTML = '';
            
            // 전체 기록 카드
            const overallCard = document.createElement('div');
            overallCard.className = 'team-record-card team-record-overall';
            
            const overallTitle = document.createElement('div');
            overallTitle.className = 'team-record-title';
            overallTitle.textContent = '📊 누적 기록';
            
            const overallValue = document.createElement('div');
            overallValue.className = 'team-record-value';
            overallValue.style.fontSize = '1.4em';
            overallValue.textContent = `${teamRecords.totalMatches}전 ${teamRecords.wins}승 ${teamRecords.draws}무 ${teamRecords.losses}패`;
            
            const overallDetail = document.createElement('div');
            overallDetail.className = 'team-record-detail';
            overallDetail.textContent = `득점 ${teamRecords.goalsFor} / 실점 ${teamRecords.goalsAgainst}`;
            
            overallCard.appendChild(overallTitle);
            overallCard.appendChild(overallValue);
            overallCard.appendChild(overallDetail);
            container.appendChild(overallCard);

            // 각 기록 카드들
            const records = [
                { 
                    class: 'team-record-win-streak', 
                    title: '🔥 최고 연승 기록', 
                    value: `${teamRecords.maxWinStreak.count}연승`, 
                    detail: teamRecords.maxWinStreak.startDate ? 
                        `${formatDate(teamRecords.maxWinStreak.startDate)} ~ ${formatDate(teamRecords.maxWinStreak.endDate)}` : '기록 없음' 
                },
                { 
                    class: 'team-record-loss-streak', 
                    title: '💔 최다 연패 기록', 
                    value: `${teamRecords.maxLossStreak.count}연패`, 
                    detail: teamRecords.maxLossStreak.startDate ? 
                        `${formatDate(teamRecords.maxLossStreak.startDate)} ~ ${formatDate(teamRecords.maxLossStreak.endDate)}` : '기록 없음' 
                },
                { 
                    class: 'team-record-max-goals', 
                    title: '⚽ 최다 득점 경기', 
                    value: `${teamRecords.maxGoalsMatch ? teamRecords.maxGoalsMatch.score.split(':')[0] : 0}골`, 
                    detail: teamRecords.maxGoalsMatch ? 
                        `vs ${teamRecords.maxGoalsMatch.opponent}\n${formatDate(teamRecords.maxGoalsMatch.date)}` : '기록 없음' 
                },
                { 
                    class: 'team-record-max-conceded', 
                    title: '😱 최다 실점 경기', 
                    value: `${teamRecords.maxConcededMatch ? teamRecords.maxConcededMatch.score.split(':')[1] : 0}실점`, 
                    detail: teamRecords.maxConcededMatch ? 
                        `vs ${teamRecords.maxConcededMatch.opponent}\n${formatDate(teamRecords.maxConcededMatch.date)}` : '기록 없음' 
                },
                { 
                    class: 'team-record-best-season', 
                    title: '🏆 최고 시즌', 
                    value: teamRecords.bestSeason ? teamRecords.bestSeason.season : '-', 
                    detail: teamRecords.bestSeason ? 
                        `승률 ${teamRecords.bestSeason.winRate.toFixed(1)}%\n${teamRecords.bestSeason.wins}승 ${teamRecords.bestSeason.draws}무 ${teamRecords.bestSeason.losses}패` : '기록 없음' 
                },
                { 
                    class: 'team-record-worst-season', 
                    title: '📉 아쉬운 시즌', 
                    value: teamRecords.worstSeason ? teamRecords.worstSeason.season : '-', 
                    detail: teamRecords.worstSeason ? 
                        `승률 ${teamRecords.worstSeason.winRate.toFixed(1)}%\n${teamRecords.worstSeason.wins}승 ${teamRecords.worstSeason.draws}무 ${teamRecords.worstSeason.losses}패` : '기록 없음' 
                }
            ];

            records.forEach(rec => {
                const card = document.createElement('div');
                card.className = `team-record-card ${rec.class}`;
                
                const title = document.createElement('div');
                title.className = 'team-record-title';
                title.textContent = rec.title;
                
                const value = document.createElement('div');
                value.className = 'team-record-value';
                value.textContent = rec.value;
                
                const detail = document.createElement('div');
                detail.className = 'team-record-detail';
                detail.innerHTML = rec.detail.replace(/\n/g, '<br>');
                
                card.appendChild(title);
                card.appendChild(value);
                card.appendChild(detail);
                container.appendChild(card);
            });
        }

        // ========== 지역별 기록 테이블 업데이트 함수 (기존 로직 유지) ==========
        function updateRegionalTable(regionalData) {
            const tbody = document.getElementById('regionalTableBody');
            if (!tbody) return;
            
            tbody.innerHTML = '';
            
            if (!regionalData || regionalData.length === 0) {
                const noDataRow = document.createElement('tr');
                const noDataCell = document.createElement('td');
                noDataCell.setAttribute('colspan', '6');
                noDataCell.className = 'no-data';
                noDataCell.textContent = '지역별 기록 데이터가 없습니다.';
                noDataRow.appendChild(noDataCell);
                tbody.appendChild(noDataRow);
                return;
            }

            // 승률 계산하여 데이터 준비
            let regionsWithWinRate = regionalData.map(region => ({
                ...region,
                winRate: region.matches > 0 ? (region.wins / region.matches * 100) : 0
            }));

            // 정렬 적용
            sortRegionalData(regionsWithWinRate, AppState.ui.currentRegionalFilter);

            // 안전한 DOM 조작으로 테이블 행 생성
            regionsWithWinRate.forEach(region => {
                const row = document.createElement('tr');

                // 승률에 따른 색상 클래스 결정
                const winRateClass =
                    region.winRate >= 80 ? 'winrate-excellent' :
                    region.winRate >= 60 ? 'winrate-good' :
                    region.winRate >= 40 ? 'winrate-average' : 'winrate-poor';

                // 각 셀 생성
                const regionCell = document.createElement('td');
                const regionStrong = document.createElement('strong');
                regionStrong.textContent = region.region;
                regionCell.appendChild(regionStrong);

                const matchesCell = document.createElement('td');
                const matchesStrong = document.createElement('strong');
                matchesStrong.textContent = region.matches.toString();
                matchesCell.appendChild(matchesStrong);

                const winsCell = document.createElement('td');
                winsCell.textContent = region.wins.toString();

                const drawsCell = document.createElement('td');
                drawsCell.textContent = region.draws.toString();

                const lossesCell = document.createElement('td');
                lossesCell.textContent = region.losses.toString();

                const winRateCell = document.createElement('td');
                const winRateSpan = document.createElement('span');
                winRateSpan.className = `winrate-cell ${winRateClass}`;
                winRateSpan.textContent = `${region.winRate.toFixed(1)}%`;
                winRateCell.appendChild(winRateSpan);

                row.appendChild(regionCell);
                row.appendChild(matchesCell);
                row.appendChild(winsCell);
                row.appendChild(drawsCell);
                row.appendChild(lossesCell);
                row.appendChild(winRateCell);

                tbody.appendChild(row);
            });
        }

        // ========== 지역별 정렬 함수 (기존 로직 유지) ==========
        function sortRegionalData(data, sortBy) {
            switch(sortBy) {
                case 'matches':
                    data.sort((a, b) => {
                        if (b.matches !== a.matches) return b.matches - a.matches;
                        return koreanCollator.compare(a.region, b.region);
                    });
                    break;
                case 'wins':
                    data.sort((a, b) => {
                        if (b.wins !== a.wins) return b.wins - a.wins;
                        if (b.matches !== a.matches) return b.matches - a.matches;
                        return koreanCollator.compare(a.region, b.region);
                    });
                    break;
                case 'draws':
                    data.sort((a, b) => {
                        if (b.draws !== a.draws) return b.draws - a.draws;
                        return koreanCollator.compare(a.region, b.region);
                    });
                    break;
                case 'losses':
                    data.sort((a, b) => {
                        if (b.losses !== a.losses) return b.losses - a.losses;
                        return koreanCollator.compare(a.region, b.region);
                    });
                    break;
                case 'winrate':
                    data.sort((a, b) => {
                        if (Math.abs(b.winRate - a.winRate) > 0.01) return b.winRate - a.winRate;
                        if (b.matches !== a.matches) return b.matches - a.matches;
                        return koreanCollator.compare(a.region, b.region);
                    });
                    break;
                case 'name':
                    data.sort((a, b) => koreanCollator.compare(a.region, b.region));
                    break;
                default:
                    data.sort((a, b) => {
                        if (Math.abs(b.winRate - a.winRate) > 0.01) return b.winRate - a.winRate;
                        return koreanCollator.compare(a.region, b.region);
                    });
            }
        }

        // ========== 지역별 필터 함수 (기존 로직 유지) ==========
        function filterRegional(filter) {
            AppState.ui.currentRegionalFilter = filter;

            // 필터 버튼 상태 업데이트
            document.querySelectorAll('.regional-records-section .filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
            });

            // 정렬 표시기 업데이트
            updateRegionalSortIndicators(filter);

            // 테이블 재정렬 및 업데이트
            if (AppState.data.isAllTimeView) {
                loadAllTimeSeasonsParallel().then(({ regional: regionalData }) => {
                    updateRegionalTable(regionalData);
                });
            }
        }

        // ========== 정렬 표시기 업데이트 (기존 로직 유지) ==========
        function updateRegionalSortIndicators(activeSort) {
            const indicators = {
                'regionNameSort': 'name',
                'regionMatchesSort': 'matches',
                'regionWinsSort': 'wins',
                'regionDrawsSort': 'draws', 
                'regionLossesSort': 'losses',
                'regionWinrateSort': 'winrate'
            };

            Object.entries(indicators).forEach(([elementId, sortType]) => {
                const element = document.getElementById(elementId);
                if (element) {
                    element.textContent = sortType === activeSort ? '↓' : '';
                }
            });
        }

        function updateAllTimeTable(allTimeStats, sortBy = 'goals') {
            const tbody = document.getElementById('allTimePlayersTableBody');
            if (!tbody) return;
            
            tbody.innerHTML = '';

            let playersBySort = Object.entries(allTimeStats)
                .map(([name, stats]) => ({name, ...stats}))
                .filter(player => player.totalAppearances > 0);

            switch(sortBy) {
                case 'goals':
                    playersBySort.sort((a, b) => {
                        if (b.totalGoals !== a.totalGoals) return b.totalGoals - a.totalGoals;
                        if (b.totalAppearances !== a.totalAppearances) return b.totalAppearances - a.totalAppearances;
                        return koreanCollator.compare(a.name, b.name);
                    });
                    break;
                case 'attendance':
                    playersBySort.sort((a, b) => {
                        if (b.totalAppearances !== a.totalAppearances) return b.totalAppearances - a.totalAppearances;
                        if (b.totalGoals !== a.totalGoals) return b.totalGoals - a.totalGoals;
                        return koreanCollator.compare(a.name, b.name);
                    });
                    break;
                case 'mvp':
                    playersBySort.sort((a, b) => {
                        if (b.totalMvp !== a.totalMvp) return b.totalMvp - a.totalMvp;
                        if (b.totalAppearances !== a.totalAppearances) return b.totalAppearances - a.totalAppearances;
                        return koreanCollator.compare(a.name, b.name);
                    });
                    break;
                default:
                    playersBySort.sort((a, b) => koreanCollator.compare(a.name, b.name));
            }

            if (playersBySort.length === 0) {
                const noDataRow = document.createElement('tr');
                const noDataCell = document.createElement('td');
                noDataCell.setAttribute('colspan', '4');
                noDataCell.className = 'no-data';
                noDataCell.textContent = '역대 기록 데이터가 없습니다.';
                noDataRow.appendChild(noDataCell);
                tbody.appendChild(noDataRow);
                return;
            }

            // 안전한 DOM 조작으로 테이블 행 생성
            playersBySort.forEach((player, index) => {
                const row = document.createElement('tr');

                let rankDisplay = '';
                if (index < 3) {
                    const rankEmoji = ['🥇', '🥈', '🥉'];
                    let showMedal = false;

                    switch(sortBy) {
                        case 'goals':
                            showMedal = player.totalGoals > 0;
                            break;
                        case 'attendance':
                            showMedal = player.totalAppearances > 0;
                            break;
                        case 'mvp':
                            showMedal = player.totalMvp > 0;
                            break;
                        default:
                            showMedal = false;
                    }

                    if (showMedal) {
                        rankDisplay = ` ${rankEmoji[index]}`;
                    }
                }

                // 이름 셀
                const nameCell = document.createElement('td');
                const nameStrong = document.createElement('strong');
                nameStrong.textContent = player.name + rankDisplay;
                nameCell.appendChild(nameStrong);

                // 총 출장 셀
                const appearancesCell = document.createElement('td');
                const appearancesStrong = document.createElement('strong');
                appearancesStrong.textContent = player.totalAppearances.toString();
                appearancesCell.appendChild(appearancesStrong);

                // 총 득점 셀
                const goalsCell = document.createElement('td');
                const goalsStrong = document.createElement('strong');
                goalsStrong.textContent = player.totalGoals.toString();
                goalsCell.appendChild(goalsStrong);

                // MVP 셀
                const mvpCell = document.createElement('td');
                if (player.totalMvp > 0) {
                    const mvpSpan = document.createElement('span');
                    mvpSpan.className = 'mvp-badge';
                    mvpSpan.title = `${player.name} ${player.totalMvp}회`;
                    mvpSpan.textContent = `${player.totalMvp}회`;
                    mvpCell.appendChild(mvpSpan);
                } else {
                    mvpCell.textContent = '0';
                }

                row.appendChild(nameCell);
                row.appendChild(appearancesCell);
                row.appendChild(goalsCell);
                row.appendChild(mvpCell);

                tbody.appendChild(row);
            });
        }

        // ========== 시즌 데이터 관리 (기존 로직 유지) ==========
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

        function updateStats() {
            if (AppState.data.matches.length === 0) {
                const updates = [
                    ['totalMatches', '0'],
                    ['winRate', '0%'],
                    ['winRateSubtitle', '0승 0무 0패'],
                    ['totalGoals', '0'],
                    ['goalsPerMatch', '경기당 0골'],
                    ['seasonMvp', '-'],
                    ['mvpStats', 'MVP 0회']
                ];
                
                updates.forEach(([id, value]) => {
                    const element = document.getElementById(id);
                    if (element) element.textContent = value;
                });
                return;
            }

            const totalMatches = AppState.data.matches.length;
            const wins = AppState.data.matches.filter(match => match.result === 'win').length;
            const draws = AppState.data.matches.filter(match => match.result === 'draw').length;
            const losses = AppState.data.matches.filter(match => match.result === 'loss').length;

            let totalGoalsFor = 0;
            let totalGoalsAgainst = 0;

            AppState.data.matches.forEach(match => {
                const [goalsFor, goalsAgainst] = match.score.split(':').map(Number);
                if (!isNaN(goalsFor) && !isNaN(goalsAgainst)) {
                    totalGoalsFor += goalsFor;
                    totalGoalsAgainst += goalsAgainst;
                }
            });

            const winRate = totalMatches > 0 ? (wins / totalMatches * 100).toFixed(1) : 0;
            const goalsPerMatch = totalMatches > 0 ? (totalGoalsFor / totalMatches).toFixed(1) : 0;

            const seasonMvpPlayer = calculateSeasonMvp(AppState.data.playerStats);
            const mvpName = seasonMvpPlayer ? seasonMvpPlayer.name : '-';
            const mvpCount = seasonMvpPlayer ? seasonMvpPlayer.mvp : 0;
            const mvpAppearances = seasonMvpPlayer ? seasonMvpPlayer.appearances : 0;

            // 안전한 DOM 업데이트
            const updates = [
                ['totalMatches', totalMatches.toString()],
                ['winRate', winRate + '%'],
                ['winRateSubtitle', `${wins}승 ${draws}무 ${losses}패`],
                ['totalGoals', totalGoalsFor.toString()],
                ['goalsPerMatch', `경기당 ${goalsPerMatch}골`],
                ['seasonMvp', mvpName],
                ['mvpStats', mvpCount > 0 ? `MVP ${mvpCount}회 (출전 ${mvpAppearances}회)` : 'MVP 0회']
            ];
            
            updates.forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });
        }

        async function loadData() {
            // 상태 초기화
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
                            const response = await fetch(`${AppState.data.currentSeason}_data.json`, { 
                                signal: AppState.network.currentAbortController.signal, 
                                headers: { 'Cache-Control': 'no-cache' } 
                            });
                            if (!response.ok) throw new Error(`HTTP ${response.status}: 파일을 찾을 수 없습니다.`);
                            const rawData = await response.json();
                            data = validateSeasonData(rawData);
                            dataSource = 'JSON 파일 (대체)';
                        }
                    } else {
                        const response = await fetch(`${AppState.data.currentSeason}_data.json`, { 
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
                
                // Fix 1: chart/map generation moved to toggleAllTimeView for All-Time mode.
                // Fix 2: Map initialization logic is now inside initializeMap/loadKakaoMap,
                // and it will check if AppState.map.lastAddress has changed from the schedule update.
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

        // ========== 테이블 업데이트 함수 (기존 로직 유지하되 안전성 개선) ==========
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

        // ========== 일정 업데이트 함수 ==========
        function updateSchedule(schedules) {
            const scheduleContainer = document.querySelector('.schedule-container');
            const venueInfo = document.querySelector('.venue-info');

            if (!scheduleContainer || !venueInfo) return;

            // 기본값 설정 (감일축구장)
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

            // Fix 2: Venue 정보 업데이트
            CONFIG.VENUE = currentVenue;
            venueInfo.innerHTML = `
                <div class="venue-name">${currentVenue.name}</div>
                <div class="venue-address">📍 ${currentVenue.address}</div>
                <div class="venue-phone">📞 ${currentVenue.info}</div>
            `;
             // Fix 2: 맵 로딩
            if (currentVenue.address && currentVenue.address !== '주소 정보 없음') {
                loadKakaoMap();
            } else {
                // 주소 정보가 없으면 맵 초기화하지 않음
                 const mapPlaceholder = document.getElementById('map-placeholder');
                 if (mapPlaceholder) {
                     mapPlaceholder.innerHTML = '<div class="map-placeholder">주소 정보가 없어 지도를 표시할 수 없습니다</div>';
                 }
            }
        }

        // Fix 2: 카카오맵 관련 함수들

        function loadKakaoMap() {
            if (AppState.map.scriptLoaded) {
                initializeMap();
                return;
            }

            const script = document.createElement('script');
            // Assuming KAKAO_MAP_API_KEY is available globally/in CONFIG
            script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CONFIG.KAKAO_MAP_API_KEY}&autoload=false&libraries=services`;
            
            script.onload = function () {
                AppState.map.scriptLoaded = true;
                // Defer initialization slightly to ensure all DOM elements are ready
                kakao.maps.load(initializeMap);
            };

            script.onerror = function () {
                logError('카카오맵 API 로드 실패');
                document.getElementById('map-placeholder').innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#666;">
                        <div>🗺️</div>
                        <div style="margin-top:10px;">${CONFIG.VENUE.name || '구장'}</div>
                        <div style="font-size:12px;margin-top:5px;">지도를 불러올 수 없습니다</div>
                    </div>
                `;
            };

            document.head.appendChild(script);
        }


        function initializeMap() {
             const searchAddress = CONFIG.VENUE.address || '경서울 노원구 동일로231가길 7';
             
             // Fix 2: 주소가 바뀌지 않았으면 맵 재초기화 건너뛰기
             if (AppState.map.initialized && AppState.map.lastAddress === searchAddress) {
                 logInfo('맵이 이미 초기화되어 있고 주소 변경 없음');
                 return;
             }

             const mapPlaceholder = document.getElementById('map-placeholder');
             if (!mapPlaceholder) return;

             // Map Container 재설정
             mapPlaceholder.innerHTML = '<div id="map" style="width:100%;height:300px;border-radius:8px;border:2px solid #1e40af;"></div>';
             const mapContainer = document.getElementById('map');
             
             // 기본 중심 좌표 (감일축구장)
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
        
        // ========== 선수 필터 함수 (기존 로직 유지) ==========
        function filterPlayers(filter) {
            AppState.ui.currentFilter = filter;

            // 필터 버튼 상태 업데이트
            const filterBtns = document.querySelectorAll('.section .filter-btn, .all-time-content .filter-btn');
            filterBtns.forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
            });

            // 테이블 업데이트
            if (AppState.data.isAllTimeView) {
                loadAllTimeSeasonsParallel().then(({ stats: allTimeStats }) => {
                    updateAllTimeTable(allTimeStats, filter);
                });
            } else {
                updateTable(AppState.data.playerStats, AppState.data.matches, 'playersTableBody', 'players');
            }
        }

        // ========== 지역별 히트맵 생성 함수 (기존 로직 유지) ==========
        function createRegionalHeatmap() {
            const svg = document.getElementById('seoulMap');
            if (!svg) return;

            // 기존 내용 제거
            svg.innerHTML = '';

            const guData = [
                { name: '강남구' }, { name: '강북구' }, { name: '강동구' }, { name: '강서구' },
                { name: '관악구' }, { name: '광진구' }, { name: '구로구' }, { name: '금천구' },
                { name: '노원구' }, { name: '도봉구' }, { name: '동대문구' }, { name: '동작구' },
                { name: '마포구' }, { name: '서대문구' }, { name: '서초구' }, { name: '성동구' },
                { name: '성북구' }, { name: '송파구' }, { name: '양천구' }, { name: '영등포구' },
                { name: '용산구' }, { name: '은평구' }, { name: '종로구' }, { name: '중구' },
                { name: '중랑구' }
            ];
            
            svg.setAttribute('viewBox', '0 0 400 450');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            
            guData.forEach((gu, index) => {
                let rate = 50; // 기본값 (40-60% 평균)
                let wins = 0;
                let totalMatches = 0;

                const stats = AppState.data.regionalStats.find(s => s.region === gu.name);
                if (stats) {
                    wins = stats.wins || 0;
                    totalMatches = stats.matches || 0;
                    rate = totalMatches > 0 ? (wins / totalMatches * 100) : 50;
                }
                
                let color = '#ef4444'; // 40% 미만 (빨강)
                if (rate >= 60) color = '#10b981'; // 60% 이상 (녹색)
                else if (rate >= 40) color = '#f59e0b'; // 40-60% (주황)
                
                const x = (index % 5) * 75 + 10;
                const y = Math.floor(index / 5) * 85 + 10;
                
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', x.toString());
                rect.setAttribute('y', y.toString());
                rect.setAttribute('width', '70');
                rect.setAttribute('height', '80');
                rect.setAttribute('fill', color);
                rect.setAttribute('stroke', '#1e40af');
                rect.setAttribute('stroke-width', '2');
                rect.setAttribute('rx', '5');
                rect.style.cursor = 'pointer';
                rect.style.transition = 'all 0.3s ease';
                
                const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                nameText.setAttribute('x', (x + 35).toString());
                nameText.setAttribute('y', (y + 30).toString());
                nameText.setAttribute('text-anchor', 'middle');
                nameText.setAttribute('font-size', '12');
                nameText.setAttribute('fill', '#fff');
                nameText.setAttribute('font-weight', 'bold');
                nameText.setAttribute('pointer-events', 'none');
                nameText.textContent = gu.name;
                
                const rateText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                rateText.setAttribute('x', (x + 35).toString());
                rateText.setAttribute('y', (y + 50).toString());
                rateText.setAttribute('text-anchor', 'middle');
                rateText.setAttribute('font-size', '16');
                rateText.setAttribute('fill', '#fff');
                rateText.setAttribute('font-weight', 'bold');
                rateText.setAttribute('pointer-events', 'none');
                rateText.textContent = rate.toFixed(1) + '%';
                
                const matchText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                matchText.setAttribute('x', (x + 35).toString());
                matchText.setAttribute('y', (y + 68).toString());
                matchText.setAttribute('text-anchor', 'middle');
                matchText.setAttribute('font-size', '10');
                matchText.setAttribute('fill', '#fff');
                matchText.setAttribute('pointer-events', 'none');
                matchText.textContent = wins + '승/' + totalMatches + '전';
                
                rect.addEventListener('mouseover', function() {
                    rect.setAttribute('stroke-width', '4');
                    rect.style.filter = 'drop-shadow(0 0 5px rgba(0,0,0,0.3))';
                });
                
                rect.addEventListener('mouseout', function() {
                    rect.setAttribute('stroke-width', '2');
                    rect.style.filter = 'none';
                });
                
                g.appendChild(rect);
                g.appendChild(nameText);
                g.appendChild(rateText);
                g.appendChild(matchText);
                svg.appendChild(g);
            });
            
            logInfo('SVG 지도 생성 완료');
        }

        // ========== 초기화 함수 (기존 로직 유지) ==========
        function initializeApp() {
            // 앱 상태 초기화
            AppState.data.currentSeason = CONFIG.DEFAULT_SEASON;
            AppState.ui.currentFilter = 'all';
            AppState.ui.currentRegionalFilter = 'winrate';
            
            // Fix 3: 초기 로드 시 시즌 통계 카드 구조를 먼저 그림
            renderSeasonStatCards();

            // 버튼 상태 업데이트
            updateButtonStates();
            
            // 초기 데이터 로드
            loadData().catch(error => {
                logError('초기 데이터 로드 실패:', error);
            });
        }

        // ========== 페이지 로드 시 초기화 ==========
        document.addEventListener('DOMContentLoaded', initializeApp);
        
        // ========== 전역 함수들 (HTML에서 호출) ==========
        window.changeSeason = changeSeason;
        window.toggleAllTimeView = toggleAllTimeView;
        window.onSeasonSelectClick = onSeasonSelectClick;
        window.filterPlayers = filterPlayers;
        window.filterRegional = filterRegional;