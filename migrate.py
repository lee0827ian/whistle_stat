import json
import os
import time

SUPABASE_URL = "https://sgzanwxgdcyojcoskseo.supabase.co"
SUPABASE_KEY = ""

# supabase-js 없이 직접 REST API 호출
import urllib.request
import urllib.error

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
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"  ❌ HTTP {e.code}: {error_body}")
        return None

def insert(table, data):
    return supabase_request("POST", table, data)

def select(table, params=None):
    return supabase_request("GET", table, params=params)


# ============================================================
# Step 1. 선수 마스터 구축 (전체 JSON에서 유니크 이름 수집)
# ============================================================
def collect_all_players():
    print("\n📋 Step 1. 전체 선수 이름 수집 중...")
    all_names = set()

    for year in range(2000, 2026):
        fname = f"{year}_data.json"
        if not os.path.exists(fname):
            continue
        with open(fname, encoding="utf-8") as f:
            data = json.load(f)
        for name in data.get("players", {}).keys():
            if name and name.strip():
                all_names.add(name.strip())

    print(f"  → 유니크 선수 {len(all_names)}명 발견")
    return sorted(all_names)

def migrate_players(player_names):
    print("\n👤 Step 1-2. players 테이블에 선수 등록 중...")

    # 등번호 매핑 (2026 기록에서 확인된 것들)
    number_map = {
        "윤정광": 0, "박지성": 1, "유지현": 2, "이치석": 3,
        "김기호": 4, "김진호": 5, "임태현": 6, "이항규": 7,
        "강용기": 8, "김경배": 9, "권창호": 10, "안태수": 11,
        "오진석": 12, "반기훈": 13, "이정호": 14, "서원덕": 15,
        "이상보": 16, "김병태": 17, "윤종진": 18, "안창영": 19,
        "강재웅": 20, "손의창": 21, "김종우": 22, "이지훈": 23,
        "박윤제": 24, "강현제": 25, "조상현": 26, "곽웅": 27,
        "김영주": 28, "신규환": 33, "김동규": 36, "김경현": 42,
        "조인혁": 77, "안수영": 86, "이경윤": 88, "이광수": 98,
    }

    success = 0
    for name in player_names:
        result = insert("players", {
            "name": name,
            "number": number_map.get(name),
            "active": True
        })
        if result:
            success += 1
        else:
            print(f"  ⚠️  '{name}' 등록 실패 (중복일 수 있음)")
        time.sleep(0.05)  # API rate limit 방지

    print(f"  → {success}/{len(player_names)}명 등록 완료")

# ============================================================
# Step 2. players ID 맵 가져오기
# ============================================================
def get_player_id_map():
    print("\n🔍 선수 ID 맵 로딩 중...")
    result = select("players", {"select": "id,name", "limit": "500"})
    if not result:
        print("  ❌ 선수 데이터 로드 실패")
        return {}
    id_map = {row["name"]: row["id"] for row in result}
    print(f"  → {len(id_map)}명 로드 완료")
    return id_map

# ============================================================
# Step 3. 레거시 원본 JSON 보존 (legacy_import_raw)
# ============================================================
def migrate_legacy_raw():
    print("\n📦 Step 3. 레거시 원본 JSON 보존 중...")
    success = 0
    for year in range(2000, 2026):
        fname = f"{year}_data.json"
        if not os.path.exists(fname):
            continue
        with open(fname, encoding="utf-8") as f:
            raw = json.load(f)

        result = insert("legacy_import_raw", {
            "season": year,
            "raw_json": raw
        })
        if result:
            success += 1
            print(f"  ✅ {year} 원본 저장 완료")
        else:
            print(f"  ⚠️  {year} 원본 저장 실패")
        time.sleep(0.1)

    print(f"  → {success}개 시즌 원본 보존 완료")

# ============================================================
# Step 4. 경기 데이터 마이그레이션 (matches)
# ============================================================
def parse_score(score_str):
    """'6:4' → (6, 4)"""
    try:
        our, opp = score_str.split(":")
        return int(our.strip()), int(opp.strip())
    except:
        return 0, 0

def migrate_matches_and_legacy(player_id_map):
    print("\n⚽ Step 4. 경기 + 레거시 통계 마이그레이션 중...")

    total_matches = 0
    total_legacy = 0

    for year in range(2000, 2026):
        fname = f"{year}_data.json"
        if not os.path.exists(fname):
            continue

        with open(fname, encoding="utf-8") as f:
            data = json.load(f)

        matches = data.get("matches", [])
        players = data.get("players", {})

        print(f"\n  📅 {year}년: 경기 {len(matches)}건, 선수 {len(players)}명")

        # --- 경기 등록 ---
        for i, match in enumerate(matches):
            our_score, opp_score = parse_score(match.get("score", "0:0"))

            # MVP 처리 (복수 MVP: "김기호, 이상보" 형태)
            mvp_raw = match.get("mvp", "")
            mvp_names = [n.strip() for n in mvp_raw.split(",") if n.strip()] if mvp_raw else []

            match_result = insert("matches", {
                "season": year,
                "date": match.get("date"),
                "opponent": match.get("opponent", ""),
                "venue": None,          # 레거시는 venue 없음
                "our_score": our_score,
                "opp_score": opp_score
            })

            if not match_result:
                print(f"    ⚠️  경기 등록 실패: {match.get('date')} vs {match.get('opponent')}")
                continue

            match_id = match_result[0]["id"]
            total_matches += 1

            # MVP 등록
            for mvp_name in mvp_names:
                player_id = player_id_map.get(mvp_name)
                insert("match_mvps", {
                    "match_id": match_id,
                    "player_id": player_id,     # 없으면 null
                    "raw_name": mvp_name
                })

            time.sleep(0.05)

        # --- 레거시 집계 통계 등록 ---
        for name, stats in players.items():
            player_id = player_id_map.get(name.strip())
            if not player_id:
                print(f"    ⚠️  선수 ID 없음 (레거시): {name}")
                continue

            result = insert("legacy_stats", {
                "season": year,
                "player_id": player_id,
                "appearances": stats.get("appearances", 0),
                "goals": stats.get("goals", 0),
                "mvp": stats.get("mvp", 0)
            })
            if result:
                total_legacy += 1
            time.sleep(0.03)

    print(f"\n  → 총 {total_matches}경기, {total_legacy}건 레거시 통계 등록 완료")


# ============================================================
# 실행
# ============================================================
if __name__ == "__main__":
    print("=" * 50)
    print("🚀 WHISTLE STAT 마이그레이션 시작")
    print("=" * 50)

    # 1. 선수 수집 및 등록
    player_names = collect_all_players()
    migrate_players(player_names)

    # 2. 선수 ID 맵
    player_id_map = get_player_id_map()
    if not player_id_map:
        print("❌ 선수 ID 맵 로드 실패. 중단합니다.")
        exit(1)

    # 3. 레거시 원본 보존
    migrate_legacy_raw()

    # 4. 경기 + 레거시 통계
    migrate_matches_and_legacy(player_id_map)

    print("\n" + "=" * 50)
    print("✅ 마이그레이션 완료!")
    print("=" * 50)