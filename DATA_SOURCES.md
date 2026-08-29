# CamBus Data Sources

- 데이터 점검일: **2026-08-29**
- 대상 릴리스: **1.0.0**

이 문서는 CamBus에 초기 입력한 공개 정보의 출처와 최신성 주의사항을 기록합니다.

## 1. 순환버스

### 2026학년도 2학기 교내 순환버스 운행 횟수 조정

- 출처: 영남대학교 학생지원팀
- 등록일: 2026-08-27
- 시행일: 2026-09-01
- URL: <https://humanservice.yu.ac.kr/main/intro/yu-news.do?articleNo=231399766&mode=view>
- 활용: 08:00~10:50 10분 간격, 오전 11시대/오후 20분 간격 등 시간표

앱의 시간표 기준 원천으로 사용합니다.

**2026-08-29 재검증:** 공지 원문(배차 시간표, 서문 5분 정차, 1노선 11개소/2노선 12개소 정류장
목록)을 다시 대조한 결과 `app.js`의 `SCHEDULE` 배열·정류장 코드와 100% 일치함을 확인했습니다.
이후 1.3.0에서 음악관·기계관 중복 정차점을 하나로 통합해 1노선 10개소/2노선 11개소가 됐지만,
통합한 두 지점 모두 공지문에 실려 있던 지점이라 노선·배차 자체는 그대로입니다.

---

## 2. 전동킥보드/PM

### 이동장치 안전운행 계도 및 단속

- 출처: 영남대학교 총무정보보호팀
- 등록일: 2026-08-25
- 시행: 2026-09-01 이후
- URL: <https://chek.yu.ac.kr/main/intro/yu-news.do?articleNo=231371564&mode=view>
- 주요 내용: 헬멧, 2인 탑승 금지, 보도/횡단보도 안전수칙, 지정구역 주차 등


### 개인형 이동장치 등록제

- 출처: 영남대학교 총무정보보호팀
- 등록일: 2026-07-21
- URL: <https://www.yu.ac.kr/main/intro/yu-news.do?article.offset=0&articleLimit=10&articleNo=230879704&mode=view>
- 활용: 개인 소유 PM 등록 필요성과 등록 방법 안내 카드

### PM 건물 내 반입·배터리 충전 금지

- 출처: 영남대학교
- 등록일: 2025-11-10
- URL: <https://www.yu.ac.kr/graduate/community/notice.do?article.offset=1420&articleLimit=10&articleNo=227345284&mode=view>
- 활용: 건물 내 반입/충전 금지 안전 안내 카드

### 상경관 인근 전동킥보드 주차 안내

- 출처: 영남대학교 경영대학 관련 공지
- 등록일: 2023-04-18
- URL: <https://www.yu.ac.kr/daspo/community/notice.do?articleNo=5996093&mode=view&title=%5B%EA%B8%B0%ED%83%80%EC%95%88%EB%82%B4%5D+%EC%A0%84%EB%8F%99%ED%82%A5%EB%B3%B4%EB%93%9C+%EC%A3%BC%EC%B0%A8+%EC%95%88%EB%82%B4>
- 내용: 상경관 편의점 앞 자전거 거치대를 주차 장소로 안내

주의: 2023년 자료이므로 2026년 현재의 전체 PM 지정구역 목록으로 간주하지 않습니다. 최신 현장 표지와 공식 공지를 함께 확인해야 합니다.

---

## 3. 학사/학교생활

### 2026학년도 2학기 수강신청 및 수강정정 일정

- 출처: 영남대학교 수업학적팀
- URL: <https://enveng.yu.ac.kr/main/bachelor/bachelor-guide.do?articleNo=231118467&mode=view>
- 활용: 수강정정 일정 관련 Picks 카드


### 2026학년도 2학기 폐강강좌 안내

- 출처: 영남대학교 수업학적팀
- 등록일: 2026-08-26
- URL: <https://humanservice.yu.ac.kr/main/bachelor/bachelor-guide.do?articleNo=231385685&mode=view>

### 2026학년도 2학기 국가장학금 2차 신청

- 출처: 영남대학교 장학팀
- URL: <https://www.yu.ac.kr/scholar/notice/notice.do?articleNo=231160598&mode=view>

### 2026학년도 2학기 추가 등록 일정

- 출처: 영남대학교 재무팀
- URL: <https://isen.yu.ac.kr/main/bachelor/bachelor-guide.do?articleNo=231273198&mode=view>

### 2026 대학 학사일정

- 출처: 영남대학교
- URL: <https://www.yu.ac.kr/main/bachelor/calendar.do>

---

## 4. 학교 서비스 바로가기

### 강의포털

- 출처: 영남대학교 포털시스템
- URL: <https://portal.yu.ac.kr/sso/login.jsp?type=learningx>

### 학생종합정보시스템

- 출처: 영남대학교 포털시스템
- URL: <https://portal.yu.ac.kr/sso/login.jsp?type=easyurp>


### YU 서비스 모음

- 출처: 영남대학교 모바일 YU서비스
- URL: <https://mhomep.yu.ac.kr/_mobile/yuservice/>

### 장학 공지사항

- 출처: 영남대학교 장학안내
- URL: <https://jangae.yu.ac.kr/scholar/notice/notice.do>

### 중앙도서관

- 출처: 영남대학교
- URL: <https://www.yu.ac.kr/main/intro/slima.do>

---

## 5. 주변 식당/카페 초기 추천

1.0.0에서는 공개 지역 검색에서 영남대학교 인근으로 확인되는 식당/카페 중 일부를 Picks 초기 카드로 넣었습니다.

- 골목식당
- 씨옌
- 브라우니
- 마야루레스토랑
- 스타벅스 영남대

앱에서는 특정 평점이나 영업시간을 고정 표시하지 않고 **지도/리뷰에서 최신 정보 확인**을 유도합니다.

이유:

- 영업시간은 수시로 바뀔 수 있음
- 폐업/이전 가능성이 있음
- 리뷰 평점은 계속 변함

`data/portal-feed.json`에는 해당 상호를 검색하는 지도 링크를 사용했습니다.

운영 시 최소 월 1회 또는 제보 발생 시 검수하는 것을 권장합니다.

---

## 6. 사용자 제공 자료

버스 정류장 세부 위치와 과거 이용 팁은 프로젝트 진행 중 사용자가 제공한 다음 자료를 참고했습니다.

- 1노선 손그림 노선 이미지
- 2노선 손그림 노선 이미지
- 정류장별 승하차 위치 및 주변 시설 설명

이 자료는 공식 정류장 명칭을 대체하지 않고, 정차 지점을 지도에 수동 보정하는 참고 자료로 사용했습니다.

---

## 7. 데이터 갱신 원칙

1. 공식 영남대학교 공지는 공식 자료를 우선합니다.
2. 날짜가 지난 일정성 콘텐츠는 `enabled=false` 또는 삭제합니다.
3. 음식점/지역 정보는 최신 상태를 정기 검수합니다.
4. 출처가 불분명한 위치/혼잡도/기기 수를 사실처럼 표시하지 않습니다.
5. PM 업체 실시간 데이터는 공식 API/제휴가 확보되기 전까지 생성하지 않습니다.
