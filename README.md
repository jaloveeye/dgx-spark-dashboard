# DGX Spark Dashboard

**English** | [한국어](README.ko.md)

A lightweight, read-only monitoring dashboard for NVIDIA DGX Spark / GB10 systems. It collects CPU, unified memory, GPU, temperature, storage, network, and process metrics every 15 seconds and retains seven days of history in SQLite.

## Features

- Live CPU, memory, GPU, storage, temperature, and network metrics
- One-hour, 24-hour, and seven-day usage history
- Top CPU and memory processes plus active GPU workloads
- OS, kernel, NVIDIA driver, CUDA, Node.js, Python, Docker, and container toolkit versions
- Korean and English UI with a saved language preference
- System, dark, and light themes with a saved theme preference
- Linux PAM authentication with rate-limited sign-in and HttpOnly sessions
- Read-only LAN dashboard with no system control actions

## Requirements

- NVIDIA DGX Spark / GB10 or a compatible Linux host
- Node.js 24 recommended
- `nvidia-smi` for GPU metrics
- Linux PAM runtime (`libpam.so.0`)
- A C compiler for the small PAM helper
- npm

## Run

```bash
npm install
npm run build
npm start
```

The dashboard listens on `http://HOST:4180` by default. Development mode is available at `http://HOST:5173` with:

```bash
npm run dev
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `4180` | HTTP port |
| `DATABASE_PATH` | `data/metrics.sqlite` | SQLite metrics database |
| `COLLECT_INTERVAL_MS` | `15000` | Collection interval in milliseconds |
| `TLS_CERT_PATH` | empty | PEM certificate path; enables HTTPS with `TLS_KEY_PATH` |
| `TLS_KEY_PATH` | empty | PEM private-key path |

## Start automatically after reboot

The repository includes both system and user service examples. On DGX Spark, the user service avoids conflicting with NVIDIA's built-in `dgx-dashboard.service`.

Review the absolute paths in the unit files, generate the initial certificate, then install the dashboard and renewal timer:

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

The certificate is valid for 90 days. The persistent timer checks it daily, renews it when fewer than 30 days remain, and restarts the dashboard only after a successful renewal.

Verify the deployment:

```bash
systemctl --user status dgx-dashboard.service
curl -k https://127.0.0.1:4180/api/session
```

## API

- `GET /api/health` — collector health
- `GET /api/snapshot` — latest complete snapshot
- `GET /api/history?range=1h|24h|7d` — downsampled metric history
- `GET /api/stream` — live Server-Sent Events stream

## Authentication and security

Dashboard metrics and APIs require a Linux PAM login. Root, system accounts, locked accounts, expired accounts, and users with a UID below `PAM_MIN_UID` are rejected. Sessions expire after eight hours by default, use HttpOnly/SameSite=Strict cookies, and are cleared whenever the service restarts. Failed sign-ins are rate limited by source IP.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAM_SERVICE` | `login` | PAM policy from `/etc/pam.d` |
| `PAM_MIN_UID` | `1000` | Minimum UID allowed to sign in |
| `PAM_ALLOWED_USERS` | empty | Optional comma-separated username allowlist |
| `AUTH_SESSION_HOURS` | `8` | Session lifetime, limited to 1–168 hours |
| `AUTH_COOKIE_SECURE` | `false` | Add the Secure cookie flag when HTTPS is enabled |

The supplied user service enables HTTPS with an automatically renewed self-signed certificate and sets `AUTH_COOKIE_SECURE=true`. Browsers display a certificate warning because there is no public domain or trusted CA; accepting that warning encrypts the connection but does not provide public-CA identity assurance. Verify the displayed certificate fingerprint when connecting from a new client.
