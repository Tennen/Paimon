#!/usr/bin/env python3
import argparse
import json
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper.")
    parser.add_argument("--audio", required=True, help="Audio file path")
    parser.add_argument("--model", default="small", help="Whisper model size/path")
    parser.add_argument("--device", default="auto", help="Computation device (auto/cpu/cuda)")
    parser.add_argument("--compute-type", default="int8", help="Compute type (int8/float16/float32)")
    parser.add_argument("--language", default=None, help="Language code, e.g. zh")
    parser.add_argument("--beam-size", type=int, default=1, help="Beam size")
    parser.add_argument("--vad-filter", choices=["true", "false"], default="true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    vad_filter = args.vad_filter == "true"

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        print(f"faster-whisper import failed: {exc}", file=sys.stderr)
        return 2

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segments, info = model.transcribe(
            args.audio,
            beam_size=max(1, args.beam_size),
            language=args.language or None,
            vad_filter=vad_filter,
        )
        text = " ".join((segment.text or "").strip() for segment in segments).strip()
        payload = {
            "text": text,
            "language": getattr(info, "language", "") or "",
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"transcribe failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
