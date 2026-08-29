# BUS@YU

영남대학교 교내 순환버스·도보 길찾기와 학교생활 링크 모음을 결합한 OpenStreetMap 기반 웹앱/PWA 프로토타입입니다.

전체 요구사항은 [`SRS.md`](./SRS.md)에 정리되어 있습니다.

## 현재 화면 구조

### 왼쪽 / 1페이지 — BUS@YU

- 영남대 캠퍼스 지도
- 1노선/2노선 및 정류장
- 배차표와 서문 5분 정차
- 시간표 기반 예상 버스 위치/ETA
- 현재 위치 → 목적지 도보 경로
- 도보 + 순환버스 결합 경로 비교
- 승차/하차 알림
- 탑승자 동의형 크라우드 위치 공유
- 사용자 신고형 혼잡도
- 공유 킥보드/PM 주차 레이어
- 세션 최초 대형 광고 1회
- 메인 페이지 하단 얇은 광고

### 오른쪽 / 2페이지 — 유용한 사이트

- 상단의 `유용한 사이트` 탭 또는 좌우 전환 UI로 이동
- 사이트를 **한 행 4개** 아이콘 그리드로 표시
- 아이콘 클릭 시 새 탭에서 사이트 열기
- 페이지 맨 아래에 `오늘 사용자 수 / 이번달 사용자 수`
- 사용자 수 바로 아래에 **메인과 별도의 광고 배너**

지도 위에서 좌우 스와이프를 강제로 가로채면 지도 이동과 충돌하므로, 메인 지도에서는 상단 탭/우측 넘김 핸들을 사용합니다. 유용한 사이트 페이지의 빈 영역에서는 오른쪽 스와이프로 메인으로 돌아갈 수 있습니다.

---

## 실행

전체 기능을 테스트하려면 Node 서버를 사용합니다.

```bash
cd yu-campus-bus
node server.js
```

접속:

```text
http://localhost:8080
```

포트 변경:

```bash
PORT=8099 node server.js
```

정적 서버만 사용하면 지도와 `data/useful-sites.json` 기반 링크 목록은 표시할 수 있지만, 사용자 수/크라우드 API는 동작하지 않습니다.

```bash
python3 -m http.server 8080
```

---

# 유용한 사이트 관리 방식

## 관리자 페이지는 만들지 않음

현재 설계에서는 별도 `admin.html`이나 관리자 로그인 화면을 만들지 않습니다.

운영자가 서버의 다음 파일만 수정합니다.

```text
data/useful-sites.json
```

`server.js`는 `/api/useful-sites` 요청이 들어올 때마다 이 파일을 다시 읽습니다. 따라서 파일을 정상적으로 저장한 뒤 사용자가 `새로고침`을 누르면 **Node 서버 재시작 없이 변경 내용을 반영**할 수 있습니다.

## 파일 형식

기본 파일은 빈 배열입니다.

```json
[]
```

사이트 등록 예시:

```json
[
  {
    "id": "site-001",
    "title": "사이트 이름",
    "url": "https://example.com/",
    "icon": "🔗",
    "description": "짧은 설명",
    "order": 10,
    "enabled": true
  },
  {
    "id": "site-002",
    "title": "다른 사이트",
    "url": "https://example.org/",
    "icon": "https://example.org/icon.png",
    "description": "아이콘 URL도 사용 가능",
    "order": 20,
    "enabled": true
  }
]
```

### 필드

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | 권장 | 운영용 고유 ID. 최대 80자 |
| `title` | 필수 | 아이콘 아래 표시할 사이트명 |
| `url` | 필수 | `http://` 또는 `https://` URL |
| `icon` | 선택 | 이모지/짧은 문자 또는 이미지 URL |
| `description` | 선택 | 데스크톱에서 보조 설명으로 표시 |
| `order` | 선택 | 작은 숫자가 먼저 표시됨 |
| `enabled` | 선택 | `false`면 삭제하지 않고 숨김 |

### 등록

`data/useful-sites.json` 배열에 객체를 추가합니다.

### 순서 변경

`order` 값을 변경합니다.

```text
10 → 20 → 30 → 40 ...
```

중간에 넣어야 하면 `15` 같은 값을 사용해도 됩니다.

### 임시 숨김

```json
"enabled": false
```

### 완전 삭제

해당 객체를 JSON 배열에서 삭제합니다.

### 아이콘 권장

가장 안정적인 방법은 다음 두 가지입니다.

1. 이모지/한두 글자 사용
2. 운영자가 관리하는 HTTPS 이미지 URL 사용

외부 사이트 favicon URL을 직접 연결하면 상대 사이트의 정책이나 파일 변경으로 이미지가 깨질 수 있습니다. 가능하면 운영 서버의 정적 파일 폴더에 아이콘을 넣고 `/icons/...` 형태로 관리하는 편이 좋습니다.

예를 들어 향후:

```text
icons/
  portal.svg
  library.png
  lms.svg
```

처럼 추가한 뒤 JSON에는:

```json
"icon": "https://서비스도메인/icons/lms.svg"
```

를 넣는 방식을 권장합니다.

---

# 사용자 수 집계

오른쪽 페이지 하단에서 다음 두 값을 표시합니다.

- 오늘 사용자 수
- 이번달 사용자 수

정확히는 **익명 브라우저 기준 고유 사용자 추정치**입니다.

동작 방식:

1. 브라우저가 최초 접속 시 무작위 토큰을 `localStorage`에 생성
2. `/api/visit`으로 토큰 전송
3. 서버는 원본 토큰을 저장하지 않고 SHA-256 해시만 저장
4. 한국 시간(`Asia/Seoul`) 기준 오늘/이번달 중복을 제거하여 집계
5. 집계 파일은 `data/visitor-stats.json`에 저장

따라서 같은 브라우저에서 새로고침한다고 계속 증가하지 않습니다. 다만 다음 경우에는 다른 사용자처럼 집계될 수 있습니다.

- 브라우저 저장 데이터 삭제
- 시크릿 모드
- 다른 브라우저
- 다른 기기

그러므로 이 값은 계정 기반 정확한 MAU/DAU가 아니라 **서비스 이용 규모를 보여주는 경량 지표**입니다.

`data/visitor-stats.json`은 서버가 자동 관리하므로 운영자가 직접 편집하지 않는 것을 권장합니다.

---

# 광고 구조

## 1. 최초 진입 대형 광고

- 브라우저 세션당 1회
- 즉시 닫기 가능
- 위치 찾기/경로 검색을 시작하면 자동 닫힘
- 현재는 `demo` placeholder

## 2. BUS@YU 메인 하단 광고

- 얇은 하단 배너
- 승·하차 안내 중에도 유지
- Guidance UI와 겹치지 않도록 공간 예약

## 3. 유용한 사이트 페이지 광고

- 오른쪽 페이지 **가장 아래** 배치
- `오늘 / 이번달 사용자 수` 바로 아래 배치
- 메인 하단 배너와 별도의 placement를 사용할 수 있음

### Ezoic 설정

`index.html` 하단:

```js
window.YU_ADS_CONFIG = {
  provider: 'demo',
  launchPlacementId: null,
  linksPlacementId: null,
  useEzoicAnchor: true,
  bannerHeight: 58
};
```

운영 시:

- `provider: 'ezoic'`
- 최초 대형 광고 ID → `launchPlacementId`
- 유용한 사이트 페이지 전용 배너 ID → `linksPlacementId`
- 메인 하단은 Ezoic Anchor 사용 가능

실제 Ezoic 계정/승인/placement ID가 없는 상태에서는 광고 요청을 임의 생성하지 않습니다.

---

# 크라우드 버스 기능

`탑승했어요` 후 사용자가 별도 동의한 경우에만 위치 공유가 시작됩니다.

- 기본값: OFF
- 약 8초 간격 업로드
- 서버 보관: 인메모리, 최대 약 2분 TTL
- 이름/학번/전화번호 미수집
- 외부 공개 데이터는 노선/운행편별 집계 위치만 반환

혼잡도는 `여유 / 보통 / 혼잡 / 만석` 사용자 신고형입니다. 실제 전체 승객 수를 의미하지 않습니다.

---

# 공유 킥보드 / PM

공식 또는 현장 확인 가능한 주차 존만 지도에 넣는 구조입니다. 업체의 실시간 기기 대수/좌표는 공식 API 또는 제휴 데이터가 확보되기 전까지 표시하지 않습니다.

---

# 서버 API

```text
GET  /api/health
GET  /api/live-buses
POST /api/telemetry
GET  /api/crowding
POST /api/crowding
GET  /api/useful-sites
POST /api/visit
GET  /api/visitors
```

---

# 파일 구조

```text
yu-campus-bus/
├─ index.html                 2페이지 UI shell + 지도/다이얼로그
├─ styles.css                 지도/광고/스와이프/사이트 그리드 스타일
├─ portal.js                  좌우 페이지 전환, 사이트 목록, 사용자 통계
├─ app.js                     지도, ETA, 경로, 승하차 안내, Crowd 기능
├─ ads.js                     최초/메인/사이트 페이지 광고 어댑터
├─ server.js                  정적 서버 + API
├─ SRS.md                     전체 요구사항 명세
├─ manifest.webmanifest       PWA Manifest
├─ sw.js                      Service Worker
├─ icon.svg                   앱 아이콘
├─ route-guide-r1.png         1노선 참고 이미지
├─ route-guide-r2.png         2노선 참고 이미지
└─ data/
   ├─ useful-sites.json       운영자가 직접 관리하는 유용한 사이트 목록
   └─ visitor-stats.json      서버가 자동 관리하는 익명 사용자 집계
```

향후 아이콘을 로컬 파일로 관리하려면 `icons/` 디렉터리를 추가하면 됩니다. 별도 관리자 페이지는 필요할 때만 후속 개발합니다.

---

# 중요한 제한

1. 시간표 기반 버스 마커는 실제 버스 GPS가 아닙니다.
2. 크라우드 위치는 동의한 탑승자 휴대폰 GPS 기반입니다.
3. 공개 OSRM / routing.openstreetmap.de / Overpass 서버는 프로토타입용입니다.
4. 모바일 브라우저는 백그라운드 위치 추적이 제한될 수 있습니다.
5. 사용자 수는 익명 브라우저 토큰 기준 추정치이며 로그인 사용자 수가 아닙니다.
6. 운영 배포 전 HTTPS, 개인정보처리방침, 위치 공유 동의문, rate limit 강화가 필요합니다.
7. Ezoic 광고는 계정 승인과 공식 설정 이후 활성화해야 합니다.
