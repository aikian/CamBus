# CamBus

현재 릴리스: **1.3.0**

영남대학교 경산캠퍼스 순환버스, 도보 길찾기, 승하차 안내, 생활정보 피드를 결합한 OpenStreetMap 기반 웹앱/PWA입니다.

- 왼쪽 페이지: **CamBus** 지도/길찾기/버스
- 오른쪽 페이지: **Picks** 세로형 생활정보 배너 피드
- 전체 요구사항: [`SRS.md`](./SRS.md)
- 변경 이력: [`CHANGELOG.md`](./CHANGELOG.md)
- 공개 데이터 출처: [`DATA_SOURCES.md`](./DATA_SOURCES.md)
- 실제 광고 전환 계획: [`ADS_PLAN.md`](./ADS_PLAN.md)

---

## 1. 실행

실시간 API, 방문자 집계, 크라우드 위치/혼잡도까지 테스트하려면 Node 서버를 사용합니다.

```bash
cd yu-campus-bus
node server.js
```

기본 접속 주소:

```text
http://localhost:8080
```

정류장 좌표를 지도에서 직접 보정하는 로컬 편집기:

```text
http://localhost:8080/stop-editor.html
```

노선과 정류장을 선택한 뒤 지도 클릭 또는 핀 드래그로 좌표를 바꾸고 `좌표 저장`을 누르면
`data/route-stops.json`에 반영됩니다. 저장 API는 로컬 접속에서만 허용됩니다.

정류장 사이 노선 경유점과 구간 실측시간을 함께 보정하는 로컬 편집기:

```text
http://localhost:8080/path-editor.html
```

구간 선택 후 지도에 경유점을 순서대로 찍고 `전체 노선 다시 계산`을 누르면 도로 경로가 갱신됩니다.
현장에서는 스톱워치로 구간 시간을 재서 저장할 수 있습니다. 두 편집기의 저장 API는 로컬 접속에서만 허용됩니다.

### 1.1 테스트 전용 시간 가속 모드

배차표는 `2026-09-01`부터 시작하고 운행시간도 08:00~17:40로 한정돼 있어서, 그 전이거나 심야에
개발 화면을 열면 버스가 하나도 움직이지 않습니다. 확인용으로만 아래처럼 접속하면 가상 시각이
실제 시각과 무관하게 흐르면서 배차·버스 마커·정류장 ETA가 항상 살아있는 것처럼 보입니다.

```text
http://localhost:8080/?test=1&simTime=09:00&simSpeed=30
```

- `simTime`: 가상 시각의 시작점 (`HH:MM`, 기본 `09:00`)
- `simSpeed`: 배속 (기본 30배, 최대 500배)

화면 위쪽에 빨간 `TEST` 배지가 뜨는 동안에만 가상 시각이 적용됩니다. 이 파라미터는 실제 서비스
URL에는 절대 붙이지 않습니다.

포트 변경:

```bash
PORT=8099 node server.js
```

정적 화면만 확인하려면 다음도 가능합니다.

```bash
python3 -m http.server 8080
```

다만 정적 서버에서는 `/api/*` 기능이 동작하지 않으므로 방문자 통계와 크라우드 기능은 사용할 수 없습니다.

---

## 2. 화면 구조

### 2.1 CamBus 메인

- 영남대 캠퍼스 OpenStreetMap
- 1노선 / 2노선 노선 및 정류장
- 2026학년도 2학기 배차표
- 서문 5분 정차 반영
- 시간표 기반 ETA
- 길찾기 출발 시간 지정(지금 출발 / 시간 지정)
- 노선 간 자동 환승 인식(서문·1과학관·중앙도서관) 및 환승 경로 후보
- 현재 위치·검색·지도 선택 출발지 → 목적지 도보 경로
- 도보 + 순환버스 경로 비교
- 승차/하차 알림
- 탑승자 동의형 익명 위치 공유
- 사용자 신고형 혼잡도
- PM 주차 존 데이터는 보존하되 현재 지도 UI에서는 비활성화
- 세션 최초 대형 광고 1회
- 안내 중에도 유지되는 메인 하단 얇은 배너

### 2.2 Picks

아이콘 그리드가 아니라 **세로형 배너/카드 피드**입니다.

피드에는 다음 유형을 섞어 넣을 수 있습니다.

- 영남대 공식 소식
- 학사/장학/등록 일정
- 유용한 학교 서비스 링크
- 주변 맛집/카페 추천
- 지역 정보
- 운영자가 직접 추가하는 콘텐츠

**콘텐츠 5개마다 광고 카드 1개가 자동 삽입**됩니다. 광고 항목을 JSON에 직접 추가할 필요는 없습니다.

페이지 최하단에는 다음 순서로 표시합니다.

1. 오늘 사용자 수
2. 이번달 사용자 수
3. Picks 전용 하단 광고 배너

---

## 3. Picks 콘텐츠 관리

별도 관리자 페이지는 없습니다.

운영자는 다음 파일을 직접 수정합니다.

```text
data/portal-feed.json
```

Node 서버는 `/api/portal-feed` 요청 때 파일을 다시 읽으므로, 정상 저장 후 사용자가 새로고침하면 **서버 재시작 없이 반영**됩니다.

### 3.1 항목 형식

```json
{
  "id": "news-example",
  "type": "news",
  "badge": "학사",
  "icon": "🗓️",
  "title": "제목",
  "summary": "배너에 표시할 짧은 설명",
  "url": "https://example.com/",
  "source": "출처명",
  "publishedAt": "2026-08-29",
  "order": 10,
  "enabled": true
}
```

### 3.2 필드 규격

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | 권장 | 운영용 고유 ID |
| `type` | 권장 | `news`, `utility`, `food` 등. 스타일 분류 |
| `badge` | 선택 | 카드 상단 짧은 분류명 |
| `icon` | 선택 | 이모지 또는 짧은 문자 |
| `title` | 필수 | 배너 제목 |
| `summary` | 선택 | 1~2줄 설명 |
| `url` | 필수 | `http://` 또는 `https://` 링크 |
| `source` | 선택 | 출처/제공처 |
| `publishedAt` | 선택 | `YYYY-MM-DD` 형식 권장 |
| `startsAt` | 선택 | 이 시각 전에는 숨김. ISO 8601 권장 |
| `endsAt` | 선택 | 이 시각이 지나면 자동 숨김. ISO 8601 권장 |
| `lastVerifiedAt` | 선택 | 링크/내용을 마지막으로 확인한 날짜 |
| `order` | 선택 | 숫자가 작을수록 위에 표시 |
| `enabled` | 선택 | `false`면 숨김 |

### 3.3 등록/삭제

등록은 JSON 배열에 객체를 추가합니다.

임시 숨김:

```json
"enabled": false
```

완전 삭제는 해당 객체를 배열에서 제거합니다.

순서는 예를 들어 다음처럼 10 단위로 두면 중간 삽입이 쉽습니다.

```text
10, 20, 30, 40 ...
```

---

## 4. Picks 광고 운영

### 4.1 콘텐츠 사이 광고

`portal.js`가 **정상 콘텐츠 5개를 출력한 뒤 광고 슬롯 1개**를 자동 삽입합니다.

예:

```text
콘텐츠 1
콘텐츠 2
콘텐츠 3
콘텐츠 4
콘텐츠 5
[광고]
콘텐츠 6
...
콘텐츠 10
[광고]
```

현재 `demo` 모드에서는:

- 홀수 번째 광고 슬롯: 지역 광고 모집 하우스 배너
- 짝수 번째 광고 슬롯: 광고 네트워크 연결용 placeholder

지역 광고 문의 주소:

```text
ad@uxo.kr
```

하우스 광고 문구는 `portal.js`의 `makeInlineAd()`에서 관리합니다.

### 4.2 Picks 최하단 광고

사용자 수 바로 아래에 별도 광고 슬롯이 있습니다.

현재 기본 상태에서는 다음 광고 모집 배너가 표시됩니다.

```text
영남대 · 경산 지역 광고 모집중
맛집 · 카페 · 행사 · 동아리 · 지역 서비스
ad@uxo.kr
```

### 4.3 실제 Ezoic 연결

`index.html` 하단 설정:

```js
window.YU_ADS_CONFIG = {
  provider: 'demo',
  launchPlacementId: null,
  linksPlacementId: null,
  feedPlacementIds: [],
  useEzoicAnchor: true,
  bannerHeight: 58
};
```

운영에서는 파일에 ID를 직접 박지 않고 서버 환경변수를 사용합니다.

```powershell
$env:CAMBUS_AD_PROVIDER = "ezoic"
$env:CAMBUS_AD_LAUNCH_PLACEMENT_ID = "101"
$env:CAMBUS_AD_LINKS_PLACEMENT_ID = "102"
$env:CAMBUS_AD_FEED_PLACEMENT_IDS = "201,202,203"
$env:CAMBUS_EZOIC_HEADER_READY = "true"
node server.js
```

`feedPlacementIds[0]`은 첫 번째 5개 콘텐츠 뒤 광고, `[1]`은 두 번째 광고에 연결됩니다.

Placement ID가 없는 슬롯은 하우스 광고/placeholder를 유지합니다.

실제 광고는 Ezoic/MCM 승인, 운영 도메인, CMP/header 스크립트, ads.txt가 필요합니다. 준비 전에는 광고를 숨기지 않고 하우스 광고가 계속 노출됩니다. 전체 절차와 되돌리기는 [`ADS_PLAN.md`](./ADS_PLAN.md)를 따릅니다.

---

## 5. 현재 수집해 넣은 공개 정보

`data/portal-feed.json`에는 1.1.0 기준 다음 유형의 초기 데이터가 들어 있습니다.

- 2026학년도 2학기 교내 순환버스 증편 공지
- 2026년 9월 PM 안전운행 계도/단속 공지
- 개인형 이동장치 등록제 안내
- 2026학년도 2학기 수강정정 관련 안내
- 2026학년도 2학기 폐강강좌 확인 안내
- 2026학년도 2학기 국가장학금 안내
- 2026학년도 2학기 추가 등록 안내
- 강의포털
- 학생종합정보시스템
- YU 주요 서비스 모음
- 2026 학사일정
- 중앙도서관 안내
- 장학 공지사항 모음
- PM 건물 내 반입/충전 금지 안내
- 학교의 전동킥보드 주차 관련 기존 안내
- 영남대 주변 식당/카페 검색 기반 추천 5건

각 원천과 주의사항은 [`DATA_SOURCES.md`](./DATA_SOURCES.md)에 기록했습니다.

맛집/카페는 영업 여부와 시간이 바뀔 수 있으므로 앱 문구도 **방문 전 지도에서 최신 정보 확인**을 전제로 합니다.

---

## 6. 사용자 수 집계

Picks 맨 아래에 다음 값을 표시합니다.

- 오늘 사용자 수
- 이번달 사용자 수

정확한 정의는 **익명 브라우저 기준 고유 사용자 추정치**입니다.

동작:

1. 브라우저에서 무작위 토큰 생성
2. `localStorage`에 저장
3. `/api/visit`으로 전송
4. 서버는 원본 토큰이 아니라 SHA-256 해시만 저장
5. `Asia/Seoul` 기준 일/월 중복 제거

서버 저장 파일:

```text
data/visitor-stats.json
```

이 파일은 서버가 자동 관리합니다.

브라우저 데이터 삭제, 시크릿 모드, 다른 기기/브라우저는 새 사용자처럼 집계될 수 있으므로 로그인 기반 DAU/MAU와 동일한 수치는 아닙니다.

---

## 7. ETA / 크라우드 기능

### 시간표 ETA

실제 버스 GPS를 확보하지 못한 경우 다음 데이터로 추정합니다.

```text
배차 시각
+ OSM/OSRM 구간 예상 주행시간
+ 서문 5분 정차
= 시간표 기반 ETA
```

따라서 화면에서는 실제 GPS와 구분합니다.

### 익명 탑승 위치 공유

`탑승했어요` 이후 사용자가 별도 동의한 경우에만 위치를 공유합니다.

- 기본값 OFF
- 이름/학번/전화번호 미수집
- 약 8초 간격 업로드
- 서버 메모리에서 약 2분 후 만료
- 외부에는 운행편 단위 집계 위치만 반환

### 혼잡도

사용자가 직접 다음 중 하나를 신고합니다.

- 여유
- 보통
- 혼잡
- 만석

이는 **앱 사용자 신고**이며 전체 실제 승객 수를 의미하지 않습니다.

---

## 8. 서버 API

```text
GET  /api/health
GET  /api/ad-config
GET  /api/live-buses
POST /api/telemetry
GET  /api/crowding
POST /api/crowding
GET  /api/portal-feed
GET  /api/route-stops
GET  /api/route-paths
GET  /api/route-timings
POST /api/visit
GET  /api/visitors
POST /api/route-stops       로컬 편집기 전용
POST /api/route-paths       로컬 편집기 전용
POST /api/route-timings     로컬 편집기 전용
```

---

## 9. 파일 구조

```text
yu-campus-bus/
├─ VERSION                    현재 제품 버전
├─ README.md                  실행/운영 가이드
├─ SRS.md                     전체 소프트웨어 요구사항 명세
├─ CHANGELOG.md               버전별 변경 이력
├─ DATA_SOURCES.md            공개 데이터 출처/검증 기록
├─ ADS_PLAN.md                실제 광고 승인/설정/검수 계획
├─ index.html                 2페이지 UI, 다이얼로그, 광고 설정
├─ styles.css                 지도/경로/피드/광고 스타일
├─ app.js                     지도, ETA, 경로, 승하차, Crowd 기능
├─ portal.js                  좌우 페이지, Picks 피드, 광고 삽입, 통계
├─ ads.js                     광고 어댑터/Ezoic placement 연결
├─ route-utils.js             순환 노선 인덱스 계산
├─ stop-editor.*              정류장 좌표 편집기
├─ path-editor.*              노선 경유점/실측시간 편집기
├─ server.js                  정적 서버 + API
├─ manifest.webmanifest       PWA Manifest
├─ sw.js                      Service Worker
├─ icon.svg                   앱 아이콘
├─ route-guide-r1.png         1노선 참고 이미지
├─ route-guide-r2.png         2노선 참고 이미지
└─ data/
   ├─ portal-feed.json        운영자가 관리하는 Picks 콘텐츠
   └─ visitor-stats.json      서버 자동 생성/관리 사용자 집계
```

별도 관리자 페이지는 없습니다.

---

## 10. 버전 규칙

이 프로젝트의 배포 ZIP은 **Semantic Versioning** 형식을 사용합니다.

```text
MAJOR.MINOR.PATCH
```

- `MAJOR`: 호환되지 않는 구조/API 변경
- `MINOR`: 기존 기능과 호환되는 기능 추가
- `PATCH`: 버그 수정, 문구/데이터 보정

최초 정식 묶음:

```text
1.0.0
```

ZIP 파일명:

```text
bus-at-yu-v1.0.0.zip
```

앞으로 새 ZIP을 전달할 때마다 변경 규모에 맞춰 버전을 반드시 올립니다.

예:

```text
1.0.0 → 1.0.1   버그 수정
1.0.1 → 1.1.0   새로운 사용자 기능
1.x.x → 2.0.0   큰 구조/API 변경
```

`VERSION`, `CHANGELOG.md`, Service Worker 캐시 버전도 함께 갱신합니다.

---

## 11. 운영 전 체크사항

1. HTTPS 적용
2. 실제 도메인에서 위치 권한 테스트
3. 정류장 좌표 현장 검증
4. 실제 운행시간 표본 수집으로 ETA 보정
5. 개인정보처리방침/위치정보 안내 작성
6. 광고 네트워크 정책 검토
7. Ezoic placement 실제 연결
8. `data/portal-feed.json` 링크 주기적 검수
9. 맛집/지역 정보의 폐업/영업시간 변경 여부 검수
10. Node 프로세스 재시작/로그/백업 체계 구축

---

## 12. 중요한 제한

- 시간표 버스 위치는 실제 차량 GPS가 아닙니다.
- 크라우드 위치는 참여자가 있을 때만 작동합니다.
- 통신사 기지국 기반 버스 혼잡도는 사용하지 않습니다.
- 공유 킥보드 업체 실시간 기기 수/좌표는 공식 API가 없으면 표시하지 않습니다.
- 공개 OSRM / OpenStreetMap 라우팅 데모 서비스는 대규모 운영용 SLA가 아닙니다.
- 모바일 웹의 백그라운드 위치 추적은 OS 제약을 받습니다.


## 13. v1.3.0 핵심 변경

- 길찾기 출발 시간 지정 (`지금 출발` / `시간 지정`)
- 노선 코드가 겹치는 정류장(서문/1과학관/중앙도서관) 자동 환승 인식과 환승 경로 후보
- 정류장 팝업 환승 배지
- 정류장 이름을 지하철식 2~4글자로 단축, 음악관·기계관 중복 정차점 통합
- `?test=1` 테스트 전용 시간 가속 모드

## 14. v1.2.0 핵심 변경

- 정류장 좌표와 분리된 노선 경유점/실측시간 편집기
- 앱 실행 시 `data/route-paths.json` 고정 경로 우선 사용
- 서문 이후처럼 순환 끝을 넘어가는 승차·하차 계산 수정
- 환경변수 기반 실제 광고 공개 설정과 안전한 하우스 광고 폴백
- Picks 예약/만료 필드와 링크 검사 명령
- 모바일 조작 영역, 키보드 접근성, 모션 감소, 오프라인 폴백 개선
- `npm run check`, `npm test` 자동 검사

## 15. v1.1.0 핵심 변경

- 시간표 예상 버스 마커를 `requestAnimationFrame`으로 보간하여 지도에서 부드럽게 이동
- 버스 마커에 다음 정류장까지 남은 ETA 표시
- 정류장 팝업에서 다음 2개 운행편 ETA 표시
- `data/route-timings.json` 구간별 실측시간 오버라이드 구조 추가 (미입력 시 OSRM 값 사용)
- 탑승객 공유 위치에도 다음 정류장/ETA 표시 및 부드러운 마커 이동
- Picks 수동 피드 + `portal-auto.json` 자동수집 피드 병합 구조
- `scripts/refresh-yu-feed.js` 자동수집 스크립트 추가
- `data/local-ads.json` 기간형 직접 광고 구조 추가
- `data/metrics.json` 길찾기/안내/탑승/Picks 클릭 통계 구조 추가
- `data/pm-zones.json` PM 주차 존 데이터 분리
- 지도/서버/정적 폴백 관련 회귀 테스트 항목을 `TEST_REPORT.md`에 기록
