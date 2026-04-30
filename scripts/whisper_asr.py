#!/usr/bin/env python3
"""Minimal ASR bridge for LaputaMediaCenter dubbing workflows.

Outputs segments.json as an array:
[
  {"start": 0.0, "end": 2.4, "text": "..."}
]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def normalize_segments(raw_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for index, segment in enumerate(raw_segments):
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        segments.append(
            {
                "id": segment.get("id", index),
                "start": float(segment.get("start") or 0),
                "end": float(segment.get("end") or 0),
                "text": text,
            }
        )
    return segments


def transcribe_with_openai_whisper(
    source: str, model: str, language: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    import whisper  # type: ignore

    whisper_model = whisper.load_model(model)
    kwargs: dict[str, Any] = {"fp16": False}
    if language:
        kwargs["language"] = language
    result = whisper_model.transcribe(source, **kwargs)
    return normalize_segments(result.get("segments") or []), result.get("language")


def transcribe_with_faster_whisper(
    source: str, model: str, language: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    from faster_whisper import WhisperModel  # type: ignore

    whisper_model = WhisperModel(model, device="auto", compute_type="int8")
    segments_iter, info = whisper_model.transcribe(source, language=language)
    segments = [
        {"id": index, "start": item.start, "end": item.end, "text": item.text.strip()}
        for index, item in enumerate(segments_iter)
        if item.text.strip()
    ]
    return segments, getattr(info, "language", None)


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe media into LaputaMediaCenter segments.json")
    parser.add_argument("source")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language")
    parser.add_argument("--source-lang", dest="source_lang")
    parser.add_argument("--source-language", dest="source_language")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    language = args.language or args.source_lang or args.source_language
    if language == "auto":
        language = None

    errors: list[str] = []
    detected_language: str | None = None
    segments: list[dict[str, Any]] = []

    try:
        segments, detected_language = transcribe_with_openai_whisper(args.source, args.model, language)
    except Exception as error:
        errors.append(f"openai-whisper: {error}")
        try:
            segments, detected_language = transcribe_with_faster_whisper(
                args.source, args.model, language
            )
        except Exception as fallback_error:
            errors.append(f"faster-whisper: {fallback_error}")
            raise RuntimeError(
                "No usable Whisper runtime. Install openai-whisper or faster-whisper in "
                "DUBBING_PYTHON_EXE, or set DUBBING_PYTHON_EXE to a Python that has it. "
                + " | ".join(errors)
            ) from fallback_error

    (output_dir / "segments.json").write_text(
        json.dumps(segments, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "asr.json").write_text(
        json.dumps(
            {
                "source": args.source,
                "language": detected_language or language or "unknown",
                "segments": segments,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {len(segments)} segments to {output_dir / 'segments.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
