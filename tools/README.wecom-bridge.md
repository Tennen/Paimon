# WeCom Callback Bridge (VPS)

This small service receives WeCom callbacks on the VPS and forwards messages to your local agent via SSE.

## Run on VPS

Create a `.env` file next to `tools/wecom-bridge.js` (or run from project root):

```
WECOM_TOKEN=your_wecom_token
WECOM_AES_KEY=your_encoding_aes_key
WECOM_RECEIVE_ID=your_receive_id_optional
WECOM_BRIDGE_TOKEN=your_stream_token
BRIDGE_BUFFER_SIZE=200
PORT=8080
```

Run:

```bash
cd /path/to/wecom-bridge
npm install
npm start
```

## Endpoints

- `GET /health`
- `GET /wecom` (WeCom verification)
- `POST /wecom` (WeCom message callback)
- `GET /stream` (SSE stream for local agent)
- `POST /proxy/gettoken` (forward gettoken to WeCom)
- `POST /proxy/send` (forward send message to WeCom)
- `POST /proxy/media/upload` (forward media upload to WeCom, expects base64)

## Security

- WeCom signature is verified with `WECOM_TOKEN`.
- `/stream` requires `Authorization: Bearer <WECOM_BRIDGE_TOKEN>` if set.
