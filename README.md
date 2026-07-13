# DGX 관제 센터

GB10 장비의 CPU, 통합 메모리, GPU, 온도, 저장소, 네트워크와 프로세스 Top 5를 LAN에서 조회하는 한국어 대시보드입니다. 15초마다 수집하며 SQLite에 최근 7일 이력을 보존합니다.

## 실행

```bash
npm install
npm run build
npm start
```

기본 주소는 `http://장비-IP:4180`입니다. `HOST`, `PORT`, `DATABASE_PATH`, `COLLECT_INTERVAL_MS` 환경 변수로 변경할 수 있습니다. 개발 시에는 `npm run dev`를 실행하고 포트 5173으로 접속합니다.

## 서비스 설치

빌드 후 `deploy/dgx-dashboard.service`를 `/etc/systemd/system/`에 복사하고 다음을 실행합니다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dgx-dashboard
```

LAN 방화벽에는 TCP 4180만 허용하십시오. 자체 로그인 기능이 없으므로 인터넷에 직접 공개하면 안 됩니다.

## API

- `GET /api/health` — 수집기 상태
- `GET /api/snapshot` — 최신 전체 지표
- `GET /api/history?range=1h|24h|7d` — 다운샘플링된 이력
- `GET /api/stream` — 실시간 SSE 스트림
