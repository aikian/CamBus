# CamBus 실제 광고 전환 계획

상태: **데모/지역 하우스 광고는 계속 노출**, 실제 네트워크 광고는 계정 승인과 운영 도메인 준비 후 환경변수로 전환합니다.

Ezoic은 광고를 REST API로 받아 카드 HTML을 직접 만드는 방식이 아니라, 승인된 사이트에 공식 JavaScript와 placement를 설치하고 `ezstandalone.showAds(...)`로 슬롯을 요청하는 방식입니다. CamBus의 `ads.js`는 이 연결부와 실패 시 하우스 광고 폴백을 구현해 두었습니다.

## 1. 외부 준비

1. 운영 도메인과 HTTPS를 준비합니다.
2. Ezoic 사이트 연동과 Google MCM 승인을 완료합니다.
3. Ezoic 대시보드가 발급한 **사이트별 header/CMP 스크립트 원문**을 `index.html`의 `EZOIC HEAD` 표시 구간에 넣습니다. 임의의 publisher ID나 스크립트 주소를 만들지 않습니다.
4. Ezoic에서 launch, Picks 하단, Picks 인피드 placement ID를 발급합니다. ID-less 설정을 쓰는 경우에는 빈 ID를 유지할 수 있습니다.
5. 대시보드 안내에 따라 CMP/개인정보처리방침과 `ads.txt`를 구성합니다.

공식 참고 문서:

- JavaScript 연동: https://support.ezoic.com/kb/article/javascript-integration-for-non-wordpress-sites
- EzoicAds 시작 절차: https://support.ezoic.com/kb/article/ezoicads-getting-started-guide
- GDPR/CMP: https://support.ezoic.com/kb/article/ezoic-and-gdpr-a-guide-to-consent-management
- 수익화 사이트 요구사항: https://support.ezoic.com/kb/article/ezoic-site-requirements-for-monetization

## 2. CamBus 운영 설정

광고 계정의 비밀값은 브라우저에 전달하지 않습니다. 공개 placement 설정만 서버 환경변수로 입력합니다.

```powershell
$env:CAMBUS_AD_PROVIDER = "ezoic"
$env:CAMBUS_AD_LAUNCH_PLACEMENT_ID = "101"
$env:CAMBUS_AD_LINKS_PLACEMENT_ID = "102"
$env:CAMBUS_AD_FEED_PLACEMENT_IDS = "201,202,203,204"
$env:CAMBUS_AD_USE_ANCHOR = "true"
$env:CAMBUS_AD_BANNER_HEIGHT = "58"
$env:CAMBUS_EZOIC_HEADER_READY = "true"
$env:CAMBUS_ADS_TXT_URL = "https://srv.adstxtmanager.com/<대시보드가-발급한-경로>"
node server.js
```

- `CAMBUS_EZOIC_HEADER_READY=true`는 승인된 header/CMP 스크립트가 실제로 설치된 뒤에만 사용합니다.
- 준비가 덜 된 상태에서 provider만 `ezoic`으로 바꾸면 CamBus는 빈 공간을 만들지 않고 기존 하우스 광고를 계속 보여 줍니다.
- `/api/ad-config`에서 현재 공개 설정을 확인할 수 있습니다.
- `CAMBUS_ADS_TXT_URL`은 안전상 `https://*.adstxtmanager.com` 주소만 허용합니다.

## 3. 검수와 단계적 전환

1. 스테이징 도메인에서 `/api/ad-config`의 `provider`, placement ID, `networkScriptsReady`를 확인합니다.
2. Ezoic 공식 디버거 쿼리 `?ez_js_debugger=1`로 placement와 스크립트 로딩을 확인합니다.
3. 모바일에서 CamBus/Picks 전환, 길찾기 버튼, 하단 anchor가 서로 가리지 않는지 확인합니다.
4. EU/EEA 테스트 조건에서 CMP 동의 전후 동작과 개인정보처리방침 링크를 확인합니다.
5. 광고 차단기, 네트워크 실패, fill 없음 상황에서 하우스 광고 또는 빈 슬롯 축소가 안전한지 확인합니다.
6. 초기에는 트래픽 일부만 전환하고 광고 수익뿐 아니라 이탈률, 길찾기 시작률, 화면 가림 신고를 함께 관찰합니다.

## 4. 되돌리기

문제가 있으면 `CAMBUS_AD_PROVIDER=demo`로 바꾸고 서버를 재시작합니다. 광고 영역은 숨지 않고 기존 지역 광고 모집/데모 배너로 즉시 돌아갑니다.
