# CamBus v1.1.0 Test Report

검수일: 2026-08-29

## 통과

- `app.js`, `portal.js`, `ads.js`, `server.js`, `sw.js`, `scripts/refresh-yu-feed.js` Node 문법 검사
- Node 서버 기동 및 `/` 정적 페이지 응답
- `/api/portal-feed` 응답
- `/api/local-ads` 응답 및 `ad@uxo.kr` 하우스 광고 데이터
- `/api/pm-zones` 응답
- `/api/metrics` 응답
- 시간표 예상 버스 애니메이션 코드 및 다음 정류장 ETA 코드 포함 확인
- 정류장 팝업 다음 운행편 ETA 코드 포함 확인
- 크라우드 위치 집계/혼잡도 API 폴백 구조 확인
- Picks 5개 콘텐츠당 광고 삽입 로직 코드 확인
- Service Worker에 v1.1.0 데이터 파일 캐시 항목 포함 확인

## 제한적으로 검증

- Headless Chromium 실행을 시도했으나 컨테이너에서 외부 네트워크 리소스(OpenStreetMap/Leaflet CDN/라우팅) 대기가 길어 전체 E2E 캡처가 타임아웃됨.
- 따라서 실제 휴대폰 브라우저에서 위치 권한, OSM 타일, OSRM 차량경로, 보행 라우팅, 알림/진동은 배포 전 실기기 검수가 추가로 필요함.

## 데이터 제한

- 실제 버스 GPS 없음: 시간표/구간시간 기반 예상 위치임.
- `data/route-timings.json` 실측 초 값은 현재 `null`: OSRM 구간시간으로 폴백함.
- PM 존은 확인 가능한 공식 자료만 포함하며 정확 좌표 미확인 항목은 건물 상대 위치로 표시함.
- 학교 공지 자동수집은 실패해도 `data/portal-feed.json` 수동 피드를 유지함.
