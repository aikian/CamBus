# CamBus 배포 이미지.
# server.js 가 런타임에 data/*.json 을 쓰므로 서버리스가 아니라
# 상시 실행 프로세스 + 영구 볼륨(CAMBUS_DATA_DIR)이 필요하다.
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
# 런타임 의존성이 없어 (Node 내장 모듈만 사용) 설치는 사실상 no-op 이지만,
# package.json 이 바뀌면 캐시가 깨지도록 먼저 복사한다.
RUN npm install --omit=dev --no-audit --no-fund || true

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
# 영구 디스크를 여기에 마운트한다. 첫 기동 때 저장소의 data/*.json 을 한 번 복사해 넣는다.
ENV CAMBUS_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
