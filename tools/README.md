# Tools

This directory contains standalone scripts and bridge programs used by Paimon.

## Files

- `fast-whisper-transcribe.py`: helper script used by `STT_PROVIDER=fast-whisper`.
- `market-smoke.ts`: smoke test for `market-analysis` + `chatgpt-bridge` integration.
- `wecom-bridge.go`: production-ready WeCom callback bridge (recommended on VPS).
- `wecom-bridge.js`: Node.js implementation of the same bridge (for quick local use).
- `package.json`: dependencies and start script for `wecom-bridge.js`.

## Quick usage

Fast whisper helper:

```bash
python3 tools/fast-whisper-transcribe.py --audio /path/to/audio.wav
```

Market smoke script:

```bash
npx tsx tools/market-smoke.ts
```

## WeCom bridge (VPS)

Build Go bridge:

```bash
sudo apt-get update
sudo apt-get install -y golang
cd /path/to/Paimon
go build -o wecom-bridge ./tools/wecom-bridge.go
```

Create env file (e.g. `/etc/wecom-bridge.env`):

```env
WECOM_TOKEN=your_wecom_token
WECOM_AES_KEY=your_encoding_aes_key
WECOM_RECEIVE_ID=your_receive_id_optional
WECOM_BRIDGE_TOKEN=your_stream_token
BRIDGE_BUFFER_SIZE=200
PORT=8080
```

Run (foreground):

```bash
/path/to/Paimon/wecom-bridge
```

Optional Node bridge:

```bash
npm --prefix tools install
npm --prefix tools start
```

Systemd unit (silent):

```ini
[Unit]
Description=WeCom Bridge
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/wecom-bridge.env
WorkingDirectory=/path/to/Paimon
ExecStart=/path/to/Paimon/wecom-bridge
Restart=on-failure
RestartSec=2
StandardOutput=null
StandardError=null

[Install]
WantedBy=multi-user.target
```

Endpoints:

- `GET /health`
- `GET /wecom` (WeCom verification)
- `POST /wecom` (WeCom message callback)
- `GET /stream` (SSE stream for local agent)
- `POST /proxy/gettoken` (forward gettoken to WeCom)
- `POST /proxy/send` (forward send message to WeCom)
- `POST /proxy/media/upload` (forward media upload to WeCom, expects base64)
- `POST /proxy/media/get` (forward media get from WeCom, returns base64)

Security:

- WeCom signature is verified with `WECOM_TOKEN`.
- `/stream` requires `Authorization: Bearer <WECOM_BRIDGE_TOKEN>` if set.
