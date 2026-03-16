# Tools

This directory contains standalone scripts and bridge programs used by Paimon.

## Files

- `fast-whisper-transcribe.py`: helper script used by `STT_PROVIDER=fast-whisper`.
- `llama-server-daemon-macos.sh`: manage `llama-server` as a macOS launchd daemon (silent/background).
- `market-smoke.ts`: smoke test for `market-analysis` + `chatgpt-bridge` integration.
- `migrate_persistence_to_sqlite.ts`: migrate all `src/storage/persistence.ts` managed stores from JSON files into SQLite.
- `migrate_writing_knowledge_to_sqlite.py`: rebuild writing-organizer SQLite metadata index from JSON/Markdown artifacts.
- `ollama-model-to-gguf.js`: export an Ollama-downloaded GGUF blob into `~/.llm/models`.
- `wecom-bridge.go`: production-ready WeCom callback bridge (recommended on VPS).
- `wecom-bridge.js`: Node.js implementation of the same bridge (for quick local use).
- `package.json`: dependencies and start script for `wecom-bridge.js`.

## Quick usage

Fast whisper helper:

```bash
python3 tools/fast-whisper-transcribe.py --audio /path/to/audio.wav
```

If you run the helper script directly, install Python deps first:

```bash
python3 -m pip install faster-whisper httpx[socks]
```

Market smoke script:

```bash
npx tsx tools/market-smoke.ts
```

Persistence store migration (JSON -> SQLite):

```bash
npx tsx tools/migrate_persistence_to_sqlite.ts --strict
```

Writing organizer SQLite index rebuild:

```bash
python3 tools/migrate_writing_knowledge_to_sqlite.py \
  --topics-root data/writing/topics \
  --db data/writing/index/metadata.sqlite
```

llama-server daemon on macOS (silent by default):

```bash
tools/llama-server-daemon-macos.sh start --model ~/.llm/models/qwen3-thinking.gguf --port 8080
tools/llama-server-daemon-macos.sh status
tools/llama-server-daemon-macos.sh stop
```

Export Ollama model blob to GGUF:

```bash
node tools/ollama-model-to-gguf.js --model qwen3:4b
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
