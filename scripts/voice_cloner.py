#!/usr/bin/env python3
"""Minimal TTS bridge for LaputaMediaCenter dubbing workflows.

Uses MiniMax only when a MiniMax key and the minimax_tts provider gate are both
confirmed. Otherwise generates silent WAV placeholders so the pipeline can be
smoke-tested without paid calls.
"""

from __future__ import annotations

import argparse
import binascii
import json
import math
import os
import re
import struct
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any
from urllib import request


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_segments(path: Path) -> list[dict[str, Any]]:
    data = read_json(path)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("segments"), list):
        return data["segments"]
    raise ValueError(f"Unsupported translations format: {path}")


def find_minimax_key() -> str | None:
    if os.environ.get("MINIMAX_API_KEY"):
        return os.environ["MINIMAX_API_KEY"]

    cwd = Path.cwd()
    candidates = [
        cwd / "config" / "minimax.json",
        cwd / "data" / "minimax.json",
    ]
    skill_dir = os.environ.get("DUBBING_SKILL_DIR")
    if skill_dir:
        candidates.append(Path(skill_dir) / "credentials" / "minimax.json")

    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            data = read_json(candidate)
            token = data.get("auth", {}).get("token") or data.get("api_key") or data.get("token")
            if token and not str(token).startswith("<"):
                return str(token)
        except Exception:
            continue
    return None


def normalize_minimax_api_base_url(value: str | None) -> str:
    cleaned = (value or "").strip().rstrip("/")
    if not cleaned:
        return "https://api.minimaxi.com/v1"
    if cleaned.endswith("/t2a_v2"):
        return cleaned[: -len("/t2a_v2")]
    return cleaned


def find_minimax_api_base_url() -> str:
    return normalize_minimax_api_base_url(
        os.environ.get("LMC_TTS_API_BASE_URL") or os.environ.get("MINIMAX_API_BASE_URL")
    )


def minimax_t2a_url() -> str:
    return f"{find_minimax_api_base_url()}/t2a_v2"


def parse_gate_ids(raw: str | None) -> set[str]:
    if not raw:
        return set()

    text = str(raw).strip()
    if not text:
        return set()

    if text.startswith("["):
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return {str(item).strip() for item in data if str(item).strip()}
        except Exception:
            pass

    return {part.strip() for part in re.split(r"[\s,;]+", text) if part.strip()}


def write_silent_wav(path: Path, duration: float, sample_rate: int = 24000) -> None:
    frames = max(1, int(max(duration, 0.5) * sample_rate))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00" * frames)


def get_wav_duration(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate() or 24000
            return frames / rate
    except Exception:
        return 0.0


def analyze_wav_signal(path: Path) -> dict[str, Any]:
    try:
        with wave.open(str(path), "rb") as wav:
            sample_width = wav.getsampwidth()
            frames = wav.readframes(wav.getnframes())
    except Exception:
        return {
            "audio_peak": 0.0,
            "audio_rms": 0.0,
            "audio_non_zero_ratio": 0.0,
            "audio_non_silent": False,
        }

    if not frames or sample_width not in {1, 2, 4}:
        return {
            "audio_peak": 0.0,
            "audio_rms": 0.0,
            "audio_non_zero_ratio": 0.0,
            "audio_non_silent": False,
        }

    sample_count = len(frames) // sample_width
    usable = frames[: sample_count * sample_width]
    if sample_width == 1:
        samples = [value - 128 for value in usable]
        max_sample = 128.0
    elif sample_width == 2:
        samples = struct.unpack(f"<{sample_count}h", usable)
        max_sample = 32768.0
    else:
        samples = struct.unpack(f"<{sample_count}i", usable)
        max_sample = 2147483648.0

    if not samples:
        return {
            "audio_peak": 0.0,
            "audio_rms": 0.0,
            "audio_non_zero_ratio": 0.0,
            "audio_non_silent": False,
        }

    absolute = [abs(value) for value in samples]
    peak = max(absolute) / max_sample
    rms = math.sqrt(sum(value * value for value in absolute) / len(absolute)) / max_sample
    non_zero_ratio = sum(1 for value in absolute if value > 0) / len(absolute)
    return {
        "audio_peak": peak,
        "audio_rms": rms,
        "audio_non_zero_ratio": non_zero_ratio,
        "audio_non_silent": peak >= 0.001 and rms >= 0.0001 and non_zero_ratio > 0.001,
    }


def clamp_speed(value: float | None) -> float:
    if value is None:
        return 1.0
    return min(2.0, max(0.5, float(value)))


def infer_speaker_labels(segments: list[dict[str, Any]], speaker_mode: str) -> list[str]:
    if speaker_mode == "alternate":
        return ["speaker_1" if index % 2 == 0 else "speaker_2" for index, _ in enumerate(segments)]
    if speaker_mode == "single":
        return ["speaker_1" for _ in segments]

    labels: list[str] = []
    current = "speaker_1"
    switch_next = False
    for index, segment in enumerate(segments):
        original = str(segment.get("original_text") or segment.get("text") or "")
        translated = str(segment.get("translated_text") or "")
        combined = f"{original}\n{translated}"
        lowered = combined.lower()

        if switch_next:
            current = "speaker_2"
            switch_next = False

        if current == "speaker_1" and index > 0:
            if re.search(r"\b(thanks|thank you),?\s+[a-z][a-z'\-]+", lowered):
                current = "speaker_2"

        labels.append(current)

        handoff_markers = [
            "you should be good to go",
            "over to you",
            "take it away",
            "you can start",
            "你可以開始",
        ]
        if any(marker in lowered for marker in handoff_markers):
            switch_next = True

    return labels


def voice_for_speaker(speaker: str, primary_voice_id: str, secondary_voice_id: str | None) -> str:
    if speaker == "speaker_2" and secondary_voice_id:
        return secondary_voice_id
    return primary_voice_id


def synthesize_minimax(
    api_key: str,
    text: str,
    voice_id: str,
    language_boost: str | None,
    speed: float,
) -> bytes | None:
    payload: dict[str, Any] = {
        "model": "speech-2.8-turbo",
        "text": text or " ",
        "stream": False,
        "voice_setting": {"voice_id": voice_id, "speed": speed, "vol": 1.0, "pitch": 0},
        "audio_setting": {"sample_rate": 24000, "bitrate": 128000, "format": "mp3", "channel": 1},
        "output_format": "hex",
    }
    if language_boost:
        payload["language_boost"] = language_boost

    req = request.Request(
        minimax_t2a_url(),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8"))

    audio_hex = (
        data.get("data", {}).get("audio")
        or data.get("audio_file")
        or data.get("audio")
    )
    if not audio_hex:
        return None
    return binascii.unhexlify(audio_hex)


def convert_to_wav(input_path: Path, output_path: Path) -> None:
    ffmpeg = os.environ.get("DUBBING_FFMPEG_EXE") or os.environ.get("INGEST_FFMPEG_EXE") or "ffmpeg"
    subprocess.run(
        [ffmpeg, "-y", "-i", str(input_path), "-ac", "1", "-ar", "24000", str(output_path)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate segment audio files from translations.json")
    parser.add_argument("--ref-audio", default="")
    parser.add_argument("--translations-json", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--voice-id", required=True)
    parser.add_argument("--secondary-voice-id", default="")
    parser.add_argument("--speaker-mode", choices=["single", "auto", "alternate"], default="single")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--target-lang", dest="target_lang")
    parser.add_argument("--target-language", dest="target_language")
    parser.add_argument("--language-boost", dest="language_boost")
    parser.add_argument("--language_boost", dest="language_boost_underscore")
    parser.add_argument(
        "--provider-mode",
        choices=["auto", "placeholder", "provider"],
        default=os.environ.get("DUBBING_TTS_MODE", "auto"),
    )
    parser.add_argument(
        "--confirmed-gate-id",
        dest="confirmed_gate_ids_single",
        action="append",
        default=[],
    )
    parser.add_argument(
        "--confirmed-gate-ids",
        default=os.environ.get("DUBBING_CONFIRMED_GATE_IDS", ""),
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    api_key = find_minimax_key()
    confirmed_gate_ids = parse_gate_ids(args.confirmed_gate_ids)
    for raw_gate_id in args.confirmed_gate_ids_single:
        confirmed_gate_ids.update(parse_gate_ids(raw_gate_id))
    minimax_gate_confirmed = "minimax_tts" in confirmed_gate_ids
    require_real_provider = (
        args.provider_mode == "provider"
        or os.environ.get("DUBBING_REQUIRE_REAL_MINIMAX_TTS") == "true"
    )
    provider_call_allowed = (
        args.provider_mode != "placeholder" and bool(api_key) and minimax_gate_confirmed
    )
    if require_real_provider and not minimax_gate_confirmed:
        print(
            "DUBBING_PROVIDER_CONFIRMATION_REQUIRED: MiniMax provider mode requires confirmed minimax_tts gate.",
            file=sys.stderr,
        )
        return 2
    language_boost = args.language_boost or args.language_boost_underscore
    segments = read_segments(Path(args.translations_json))
    speed = clamp_speed(args.speed)
    secondary_voice_id = args.secondary_voice_id.strip() or None
    speaker_labels = infer_speaker_labels(segments, args.speaker_mode if secondary_voice_id else "single")

    generated: list[dict[str, Any]] = []
    proof_segments: list[dict[str, Any]] = []
    generated_count = 0
    placeholder_count = 0
    failed_count = 0
    for index, segment in enumerate(segments):
        text = str(segment.get("translated_text") or segment.get("text") or "").strip()
        start = float(segment.get("start") or 0)
        end = float(segment.get("end") or 0)
        duration = end - start
        wav_path = output_dir / f"segment_{index + 1:03d}.wav"
        speaker = speaker_labels[index] if index < len(speaker_labels) else "speaker_1"
        segment_voice_id = voice_for_speaker(speaker, args.voice_id, secondary_voice_id)
        proof_source = "placeholder"
        proof_status = "placeholder"
        error_code: str | None = None
        error_message: str | None = None

        if provider_call_allowed:
            try:
                audio_bytes = synthesize_minimax(
                    api_key,
                    text,
                    segment_voice_id,
                    language_boost,
                    speed,
                )
                if audio_bytes:
                    mp3_path = output_dir / f"segment_{index + 1:03d}.mp3"
                    mp3_path.write_bytes(audio_bytes)
                    convert_to_wav(mp3_path, wav_path)
                    proof_source = "minimax"
                    proof_status = "ok"
                    generated_count += 1
                else:
                    error_code = "MINIMAX_EMPTY_AUDIO"
                    error_message = "MiniMax response did not include audio"
                    proof_status = "failed" if require_real_provider else "placeholder"
                    write_silent_wav(wav_path, duration)
            except Exception as error:
                print(f"MiniMax failed for segment {index + 1}; using silence: {error}")
                error_code = "MINIMAX_TTS_FAILED"
                error_message = str(error)
                proof_status = "failed" if require_real_provider else "placeholder"
                write_silent_wav(wav_path, duration)
        elif api_key and not minimax_gate_confirmed:
            error_code = "MINIMAX_PROVIDER_GATE_MISSING"
            error_message = "MiniMax API key is configured but minimax_tts gate is not confirmed"
            proof_status = "failed" if require_real_provider else "placeholder"
            write_silent_wav(wav_path, duration)
        elif api_key and args.provider_mode == "placeholder":
            error_code = "MINIMAX_PROVIDER_DISABLED"
            error_message = "MiniMax provider calls are disabled by provider-mode=placeholder"
            proof_status = "failed" if require_real_provider else "placeholder"
            write_silent_wav(wav_path, duration)
        else:
            error_code = "MINIMAX_API_KEY_MISSING"
            error_message = "MiniMax API key is not configured"
            proof_status = "failed" if require_real_provider else "placeholder"
            write_silent_wav(wav_path, duration)

        audio_duration = get_wav_duration(wav_path)
        audio_signal = analyze_wav_signal(wav_path)
        if proof_status == "ok" and not audio_signal["audio_non_silent"]:
            proof_status = "failed"
            error_code = "MINIMAX_SILENT_AUDIO"
            error_message = "MiniMax provider audio was silent"
            generated_count = max(0, generated_count - 1)
        if proof_status == "placeholder":
            placeholder_count += 1
        elif proof_status == "failed":
            failed_count += 1
        proof_segment = {
            "index": index,
            "voice_id": segment_voice_id,
            "output_path": str(wav_path),
            "source": proof_source,
            "status": proof_status,
            "audio_duration": audio_duration,
            **audio_signal,
        }
        if error_code:
            proof_segment["error_code"] = error_code
        if error_message:
            proof_segment["error_message"] = error_message
        proof_segments.append(proof_segment)

        generated.append(
            {
                "index": index,
                "path": str(wav_path),
                "text": text,
                "start": start,
                "end": end,
                "source_duration": duration,
                "audio_duration": audio_duration,
                "speaker": speaker,
                "voice_id": segment_voice_id,
                "source": proof_source,
                "status": proof_status,
                **audio_signal,
            }
        )

    provider_proof_ok = (
        bool(api_key)
        and minimax_gate_confirmed
        and len(segments) > 0
        and generated_count == len(segments)
        and placeholder_count == 0
        and failed_count == 0
    )
    proof_mode = "provider" if require_real_provider or provider_call_allowed else "placeholder"
    manifest = {
        "voice_id": args.voice_id,
        "primary_voice_id": args.voice_id,
        "secondary_voice_id": secondary_voice_id,
        "speaker_mode": args.speaker_mode if secondary_voice_id else "single",
        "speed": speed,
        "target_language": args.target_lang or args.target_language,
        "language_boost": language_boost,
        "provider_mode": proof_mode,
        "minimax_configured": bool(api_key),
        "provider_gate_confirmed": minimax_gate_confirmed,
        "provider_call_allowed": provider_call_allowed,
        "confirmed_gate_ids": sorted(confirmed_gate_ids),
        "used_minimax": generated_count > 0,
        "provider_proof_ok": provider_proof_ok,
        "segment_count": len(segments),
        "generated_count": generated_count,
        "placeholder_count": placeholder_count,
        "failed_count": failed_count,
        "provider_proof": {
            "provider": "minimax",
            "mode": proof_mode,
            "provider_configured": bool(api_key),
            "provider_gate_confirmed": minimax_gate_confirmed,
            "provider_call_allowed": provider_call_allowed,
            "strict_provider": require_real_provider,
            "segment_count": len(segments),
            "generated_count": generated_count,
            "placeholder_count": placeholder_count,
            "failed_count": failed_count,
            "ok": provider_proof_ok,
            "segments": proof_segments,
        },
        "files": generated,
    }
    (output_dir / "tts_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if require_real_provider and not provider_proof_ok:
        print("MiniMax provider proof failed; refusing to treat placeholder audio as real TTS")
        return 2
    print(f"wrote {len(generated)} audio files to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
