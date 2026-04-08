import json
import time
import urllib.request
import urllib.error
import ssl

# Zscaler SSL 우회
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# ============================================================
# 직접 입력
# ============================================================
SUPABASE_URL = "https://sgzanwxgdcyojcoskseo.supabase.co"
SUPABASE_KEY = ""

# ============================================================
# 2026 시즌 데이터
# ============================================================
MATCHES_2026 = [
    {
        "match_no": 1,
        "date": "2026-01-04",
        "opponent": "엘스타",
        "venue": "신내차량기지 축구장",
        "our_score": 1,
        "opp_score": 6,
        "goals": [{"name": "신규환", "count": 1}],
        "lineups": ["신규환", "강재웅", "김영주", "서원덕", "조상현", "김기호"],
        "mercenary_count": 9
    },
    {
        "match_no": 2,
        "date": "2026-01-10",
        "opponent": "FC숲속",
        "venue": "인덕대학교",
        "our_score": 3,
        "opp_score": 3,
        "goals": [
            {"name": "권창호", "count": 1},
            {"name": None, "count": 2}
        ],
        "lineups": ["박지성", "김영주", "오진석", "서원덕", "강재웅", "권창호", "반기훈"],
        "mercenary_count": 6
    },
    {
        "match_no": 3,
        "date": "2026-01-18",
        "opponent": "한울FC",
        "venue": "신림중학교",
        "our_score": 6,
        "opp_score": 6,
        "goals": [
            {"name": "조인혁", "count": 3},
            {"name": "권창호", "count": 1},
            {"name": None, "count": 2}
        ],
        "lineups": ["조인혁", "강재웅", "김영주", "신규환", "박지성", "유지현", "김기호", "이광수", "권창호", "안창영", "강용기"],
        "mercenary_count": 3
    },
    {
        "match_no": 4,
        "date": "2026-01-24",
        "opponent": "FC드라한",
        "venue": "수락산스포츠타운",
        "our_score": 3,
        "opp_score": 3,
        "goals": [
            {"name": "김기호", "count": 1},
            {"name": None, "count": 2}
        ],
        "lineups": ["박지성", "강재웅", "김영주", "오진석", "이광수", "김기호", "이상보"],
        "mercenary_count": 6
    },
    {
        "match_no": 5,
        "date": "2026-02-01",
        "opponent": "양동FC",
        "venue": "송정초등학교",
        "our_score": 3,
        "opp_score": 2,
        "goals": [
            {"name": "오진석", "count": 1},
            {"name": None, "count": 2}
        ],
        "lineups": ["강용기", "박지성", "오진석", "조인혁", "이광수", "김기호", "신규환", "이상보", "유지현", "서원덕"],
        "mercenary_count": 0
    },
    {
        "match_no": 6,
        "date": "2026-02-08",
        "opponent": "푸르지오FC",
        "venue": "영등포초등학교",
        "our_score": 12,
        "opp_score": 5,
        "goals": [
            {"name": "오진석", "count": 4},
            {"name": "권창호", "count": 3},
            {"name": "이상보", "count": 2},
            {"name": "김기호", "count": 2},
            {"name": "박지성", "count": 1}
        ],
        "lineups": ["이상보", "박지성", "오진석", "윤준배", "안태수", "김기호", "유지현", "권창호"],
        "mercenary_count": 0
    },
    {
        "match_no": 7,
        "date": "2026-02-21",
        "opponent": "TFP FC",
        "venue": "성동살곶이축구장1",
        "our_score": 6,
        "opp_score": 4,
        "goals": [
            {"name": "강재웅", "count": 1},
            {"name": "조인혁", "count": 2},
            {"name": None, "count": 3}
        ],
        "lineups": ["서원덕", "강용기", "안창영", "강재웅", "이상보", "신규환", "안태수", "조인혁", "박지성"],
        "mercenary_count": 7
    },
    {
        "match_no": 8,
        "date": "2026-03-01",
        "opponent": "신정FC",
        "venue": "신정고등학교",
        "our_score": 3,
        "opp_score": 2,
        "goals": [
            {"name": "안창영", "count": 1},
            {"name": "박지성", "count": 1},
            {"name": None, "count": 1}
        ],
        "lineups": ["신규환", "강용기", "안창영", "유지현", "조인혁", "강재웅", "안태수", "박지성"],
        "mercenary_count": 7
    },
    {
        "match_no": 9,
        "date": "2026-03-08",
        "opponent": "백야FC",
        "venue": "서울대학교 대운동장",
        "our_score": 1,
        "opp_score": 6,
        "goals": [{"name": "권창호", "count": 1}],
        "lineups": ["안창영", "안태수", "권창호", "서원덕", "강재웅", "강용기", "조인혁", "신규환", "오진석", "이광수", "김기호", "유지현", "박지성"],
        "mercenary_count": 0
    },
    {
        "match_no": 10,
        "date": "2026-03-15",
        "opponent": "차나마나FC",
        "venue": "노량진축구장",
        "our_score": 3,
        "opp_score": 2,
        "goals": [
            {"name": "안태수", "count": 1},
            {"name": None, "count": 2}
        ],
        "lineups": ["안태수", "박지성", "강재웅", "이광수", "유지현", "안창영", "신규환", "이상보", "조인혁"],
        "mercenary_count": 4
    },
    {
        "match_no": 11,
        "date": "2026-03-22",
        "opponent": "유토피아FC",
        "venue": "당산중학교",
        "our_score": 5,
        "opp_score": 6,
        "goals": [
            {"name": "김기호", "count": 1},
            {"name": "오진석", "count": 1},
            {"name": "조인혁", "count": 1},
            {"name": "안창영", "count": 1},
            {"name": None, "count": 1}
        ],
        "lineups": ["강용기", "이상보", "안창영", "김기호", "강재웅", "서원덕", "오진석", "조인혁", "안태수", "박지성"],
        "mercenary_count": 3
    },
    {
        "match_no": 12,
        "date": "2026-03-29",
        "opponent": "hs FC",
        "venue": "용마폭포공원",
        "our_score": 3,
        "opp_score": 6,
        "goals": [
            {"name": "안창영", "count": 1},
            {"name": None, "count": 2}
        ],
        "lineups": ["이상보", "박지성", "강용기", "유지현", "강재웅", "서원덕", "안창영"],
        "mercenary_count": 7
    },
    {
        "match_no": 13,
        "date": "2026-04-05",
        "opponent": "Dream FC",
        "venue": "은로초등학교",
        "our_score": 6,
        "opp_score": 4,
        "goals": [
            {"name": "강재웅", "count": 1},
            {"name": "이정호", "count": 1},
            {"name": "오진석", "count": 2},
            {"name": "안창영", "count": 1},
            {"name": "조인혁", "count": 1}
        ],
        "lineups": ["이항규", "안창영", "안태수", "권창호", "서원덕", "강재웅", "강용기", "조인혁", "오진석", "이광수", "유지현", "박지성", "반기훈", "이상보", "김경배", "이정호", "조상현"],
        "mercenary_count": 0
    }
]

# ============================================================
# 유틸
# ============================================================
def supabase_request(method, table, data=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    body = json.dumps(data).encode("utf-8") if data else None

    for attempt in range(3):  # 최대 3회 재시도
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, context=SSL_CTX) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            print(f"  ❌ HTTP {e.code}: {e.read().decode('utf-8')}")
            return None
        except Exception as e:
            if attempt < 2:
                print(f"  ⚠️  연결 오류, {attempt+1}회 재시도 중...")
                time.sleep(2)
            else:
                print(f"  ❌ 연결 실패: {e}")
                return None

def insert(table, data):
    return supabase_request("POST", table, data)

def select(table, params=None):
    return supabase_request("GET", table, params=params)

def get_player_id_map():
    result = select("players", {"select": "id,name", "limit": "500"})
    if not result:
        return {}
    return {row["name"]: row["id"] for row in result}

# ============================================================
# 실행
# ============================================================
if __name__ == "__main__":
    print("=" * 50)
    print("🚀 2026 시즌 데이터 삽입 시작")
    print("=" * 50)

    player_id_map = get_player_id_map()
    print(f"선수 ID 맵 로드: {len(player_id_map)}명\n")

    for m in MATCHES_2026:
        print(f"  ⚽ {m['date']} vs {m['opponent']} ({m['our_score']}:{m['opp_score']})")

        match_result = insert("matches", {
            "season": 2026,
            "match_no": m["match_no"],
            "date": m["date"],
            "opponent": m["opponent"],
            "venue": m["venue"],
            "our_score": m["our_score"],
            "opp_score": m["opp_score"]
        })

        if not match_result:
            print(f"    ❌ 경기 등록 실패, 건너뜀")
            continue

        match_id = match_result[0]["id"]

        # 출전 명단 (정규 선수)
        for name in m.get("lineups", []):
            player_id = player_id_map.get(name)
            if not player_id:
                print(f"    ⚠️  선수 ID 없음: {name}")
                continue
            insert("match_lineups", {
                "match_id": match_id,
                "player_id": player_id,
                "is_mercenary": False
            })

        # 용병 출전 (player_id=None, is_mercenary=True)
        for _ in range(m.get("mercenary_count", 0)):
            insert("match_lineups", {
                "match_id": match_id,
                "player_id": None,
                "is_mercenary": True
            })

        # 득점 (1골 = 1행)
        for g in m.get("goals", []):
            player_id = player_id_map.get(g["name"]) if g["name"] else None
            for _ in range(g["count"]):
                insert("match_goals", {
                    "match_id": match_id,
                    "player_id": player_id,
                    "is_mercenary": g["name"] is None,
                    "goal_type": "normal"
                })

        print(f"    ✅ 출전 {len(m['lineups'])}명 + 용병 {m['mercenary_count']}명 / 득점 등록 완료")
        time.sleep(0.1)

    print("\n" + "=" * 50)
    print("✅ 2026 시즌 삽입 완료!")
    print("=" * 50)