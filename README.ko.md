# DGX Spark 대시보드

[English](README.md) | **한국어**

NVIDIA DGX Spark / GB10 시스템을 위한 가벼운 읽기 전용 관제 대시보드입니다. CPU, 통합 메모리, GPU, 온도, 저장소, 네트워크와 프로세스 지표를 15초마다 수집하고 SQLite에 최근 7일 이력을 보존합니다.

## 주요 기능

- CPU, 메모리, GPU, 저장소, 온도, 네트워크 실시간 지표
- 1시간, 24시간, 7일 사용량 이력
- CPU·메모리 상위 프로세스와 활성 GPU 작업
- OS, 커널, NVIDIA 드라이버, CUDA, Node.js, Python, Docker 및 컨테이너 툴킷 버전
- 선택을 저장하는 한국어·영어 UI
- 선택을 저장하는 시스템·다크·라이트 테마
- 로그인 제한과 HttpOnly 세션을 적용한 Linux PAM 인증
- 시스템 제어 기능이 없는 읽기 전용 LAN 대시보드

## 요구 사항

- NVIDIA DGX Spark / GB10 또는 호환 Linux 호스트
- Node.js 24 권장
- GPU 지표 수집을 위한 `nvidia-smi`
- Linux PAM 런타임(`libpam.so.0`)
- 소형 PAM 헬퍼 빌드를 위한 C 컴파일러
- npm

## 실행

```bash
npm install
npm run build
npm start
```

기본 주소는 `http://장비-IP:4180`입니다. 개발 모드는 다음 명령으로 실행하며 `http://장비-IP:5173`에서 접속할 수 있습니다.

```bash
npm run dev
```

### 환경 설정

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 수신 주소 |
| `PORT` | `4180` | HTTP 포트 |
| `DATABASE_PATH` | `data/metrics.sqlite` | SQLite 지표 데이터베이스 |
| `COLLECT_INTERVAL_MS` | `15000` | 밀리초 단위 수집 간격 |
| `TLS_CERT_PATH` | 비어 있음 | `TLS_KEY_PATH`와 함께 HTTPS를 활성화하는 PEM 인증서 경로 |
| `TLS_KEY_PATH` | 비어 있음 | PEM 개인 키 경로 |
| `DGX_UPDATE_URL` | 비어 있음 | 업데이트 버튼이 열 주소. 비어 있으면 현재 호스트의 `http://HOST:11000/updates` 사용 |

## 재부팅 후 자동 시작

저장소에는 시스템 서비스와 사용자 서비스 예제가 모두 포함되어 있습니다. DGX Spark에서는 NVIDIA 기본 `dgx-dashboard.service`와 충돌하지 않는 사용자 서비스를 권장합니다.

unit 파일의 절대 경로를 확인하고 최초 인증서를 생성한 후 대시보드와 갱신 timer를 설치합니다.

```bash
./scripts/renew-self-signed-cert.sh
mkdir -p ~/.config/systemd/user
cp deploy/dgx-dashboard.user.service ~/.config/systemd/user/dgx-dashboard.service
cp deploy/dgx-dashboard-cert-renew.service ~/.config/systemd/user/
cp deploy/dgx-dashboard-cert-renew.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now dgx-dashboard-cert-renew.timer
systemctl --user enable --now dgx-dashboard.service
sudo loginctl enable-linger "$USER"
```

인증서는 90일간 유효합니다. persistent timer가 매일 확인하여 남은 기간이 30일 미만이면 갱신하고, 갱신에 성공한 뒤에만 대시보드를 재시작합니다.

배포 상태를 확인합니다.

```bash
systemctl --user status dgx-dashboard.service
curl -k https://127.0.0.1:4180/api/session
```

## API

- `GET /api/health` — 수집기 상태
- `GET /api/snapshot` — 최신 전체 스냅샷
- `GET /api/history?range=1h|24h|7d` — 다운샘플링된 지표 이력
- `GET /api/updates[?refresh=1]` — APT 업데이트 가능 목록과 보안·DGX/NVIDIA 요약
- `GET /api/stream` — 실시간 Server-Sent Events 스트림

## 인증과 보안

대시보드 지표와 API를 사용하려면 Linux PAM 로그인이 필요합니다. root, 시스템 계정, 잠긴 계정, 만료된 계정과 `PAM_MIN_UID`보다 UID가 낮은 사용자는 거부됩니다. 세션은 기본 8시간 후 만료되며 HttpOnly/SameSite=Strict 쿠키를 사용하고 서비스가 재시작되면 모두 폐기됩니다. 로그인 실패는 접속 IP별로 제한됩니다.

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `PAM_SERVICE` | `login` | `/etc/pam.d`의 PAM 정책 |
| `PAM_MIN_UID` | `1000` | 로그인을 허용할 최소 UID |
| `PAM_ALLOWED_USERS` | 비어 있음 | 쉼표로 구분한 선택적 사용자 허용 목록 |
| `AUTH_SESSION_HOURS` | `8` | 1–168시간 범위의 세션 유지 시간 |
| `AUTH_COOKIE_SECURE` | `false` | HTTPS 사용 시 Secure 쿠키 속성 추가 |

제공되는 사용자 서비스는 자동 갱신되는 자체 서명 인증서로 HTTPS를 활성화하고 `AUTH_COOKIE_SECURE=true`를 설정합니다. 공개 도메인과 신뢰된 CA가 없으므로 브라우저 인증서 경고가 표시됩니다. 경고를 승인하면 통신은 암호화되지만 공개 CA 수준의 서버 신원 보장은 제공되지 않으므로 새 클라이언트에서는 표시된 인증서 지문을 확인하십시오.
