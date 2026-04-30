#!/usr/bin/env python3
"""Minimal final composer for LaputaMediaCenter dubbing workflows."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any


def ffmpeg_exe() -> str:
    return os.environ.get("DUBBING_FFMPEG_EXE") or os.environ.get("INGEST_FFMPEG_EXE") or "ffmpeg"


def ffprobe_exe() -> str:
    configured = os.environ.get("DUBBING_FFPROBE_EXE") or os.environ.get("INGEST_FFPROBE_EXE")
    if configured:
        return configured

    ffmpeg = Path(ffmpeg_exe())
    if ffmpeg.name:
        candidate = ffmpeg.with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if candidate.exists():
            return str(candidate)
    return "ffprobe"


def run_ffmpeg(args: list[str]) -> None:
    subprocess.run(
        [ffmpeg_exe(), "-y", *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def probe_video_duration(path: str) -> float | None:
    try:
        result = subprocess.run(
            [
                ffprobe_exe(),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=duration",
                "-of",
                "json",
                path,
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        data = json.loads(result.stdout or "{}")
        streams = data.get("streams")
        if isinstance(streams, list) and streams:
            duration = streams[0].get("duration")
            if duration is not None:
                return float(duration)
    except Exception:
        return None
    return None


def wav_duration(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as wav:
            rate = wav.getframerate() or 1
            return wav.getnframes() / rate
    except Exception:
        return None


def write_concat_list(files: list[Path], directory: Path) -> Path:
    list_path = directory / "concat.txt"
    lines = []
    for file in files:
        escaped = str(file.resolve()).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    list_path.write_text("\n".join(lines), encoding="utf-8")
    return list_path


def concat_media(files: list[Path], output: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        list_path = write_concat_list(files, Path(tmp))
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(list_path), "-c", "copy", str(output)])


def read_manifest(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_silence(wav: wave.Wave_write, duration: float, channels: int, sample_width: int) -> int:
    frame_count = max(0, int(duration * wav.getframerate()))
    if frame_count <= 0:
        return 0
    wav.writeframes(b"\x00" * sample_width * channels * frame_count)
    return frame_count


def compose_timeline_audio(manifest_path: Path, output: Path) -> bool:
    manifest = read_manifest(manifest_path)
    files = manifest.get("files") if manifest else None
    if not isinstance(files, list) or not files:
        return False

    entries: list[dict[str, Any]] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        path_value = item.get("path")
        if not path_value:
            continue
        audio_path = Path(str(path_value))
        if not audio_path.exists():
            audio_path = manifest_path.parent / audio_path.name
        if audio_path.suffix.lower() != ".wav" or not audio_path.exists():
            continue
        entries.append({**item, "path": str(audio_path)})

    if not entries:
        return False

    entries.sort(key=lambda item: int(item.get("index") or 0))
    first_path = Path(str(entries[0]["path"]))
    with wave.open(str(first_path), "rb") as first:
        params = first.getparams()
        channels = first.getnchannels()
        sample_width = first.getsampwidth()
        frame_rate = first.getframerate()

    cursor = 0.0
    max_original_end = 0.0
    with wave.open(str(output), "wb") as target:
        target.setparams(params)
        for entry in entries:
            audio_path = Path(str(entry["path"]))
            start = float(entry.get("start") or cursor)
            end = float(entry.get("end") or start)
            max_original_end = max(max_original_end, end)

            gap = max(0.0, start - cursor)
            if gap > 0:
                written = write_silence(target, gap, channels, sample_width)
                cursor += written / frame_rate

            with wave.open(str(audio_path), "rb") as source:
                if (
                    source.getnchannels() != channels
                    or source.getsampwidth() != sample_width
                    or source.getframerate() != frame_rate
                ):
                    return False
                frames = source.readframes(source.getnframes())
                target.writeframes(frames)
                cursor += source.getnframes() / frame_rate

        tail = max(0.0, max_original_end - cursor)
        if tail > 0:
            write_silence(target, tail, channels, sample_width)

    return True


def compose_audio_only(
    audio_files: list[Path],
    output: Path,
    source_video: str | None,
    scenes_dir: Path,
) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        audio_path = tmp_dir / "dub_audio.wav"
        manifest_path = scenes_dir / "tts_manifest.json"
        used_timeline = compose_timeline_audio(manifest_path, audio_path)
        if not used_timeline:
            concat_media(audio_files, audio_path)

        if source_video and Path(source_video).exists():
            video_duration = probe_video_duration(source_video) if used_timeline else None
            audio_duration = wav_duration(audio_path) if used_timeline else None
            needs_video_pad = (
                used_timeline
                and video_duration is not None
                and audio_duration is not None
                and audio_duration > video_duration + 0.1
            )
            if needs_video_pad:
                pad_duration = max(0.5, (audio_duration or 0) - (video_duration or 0) + 0.5)
                args = [
                    "-i",
                    source_video,
                    "-i",
                    str(audio_path),
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-vf",
                    f"tpad=stop_mode=clone:stop_duration={pad_duration:.3f}",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-shortest",
                ]
            else:
                args = [
                    "-i",
                    source_video,
                    "-i",
                    str(audio_path),
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                ]
                if not used_timeline or video_duration is not None:
                    args.append("-shortest")
            args.append(str(output))
            run_ffmpeg(args)
            print(
                f"composed {len(audio_files)} audio files with "
                f"{'timeline timing' if used_timeline else 'concat timing'} to {output}"
            )
            return

        run_ffmpeg(
            [
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=1280x720:r=30",
                "-i",
                str(audio_path),
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                str(output),
            ]
        )
        print(
            f"composed {len(audio_files)} audio files with "
            f"{'timeline timing' if used_timeline else 'concat timing'} to {output}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Compose dubbed scenes or audio into an mp4")
    parser.add_argument("--scenes-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-video")
    parser.add_argument("--video", dest="source_video_alt")
    parser.add_argument("--input-video", dest="source_video_input")
    args = parser.parse_args()

    scenes_dir = Path(args.scenes_dir)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    source_video = args.source_video or args.source_video_alt or args.source_video_input

    if not scenes_dir.exists():
        raise FileNotFoundError(f"Scenes directory not found: {scenes_dir}")

    video_files = sorted(
        [file for file in scenes_dir.iterdir() if file.suffix.lower() in {".mp4", ".mov"}]
    )
    if video_files:
        concat_media(video_files, output)
        print(f"composed {len(video_files)} scene videos to {output}")
        return 0

    audio_files = sorted(
        [file for file in scenes_dir.iterdir() if file.suffix.lower() in {".wav", ".mp3", ".m4a"}]
    )
    if not audio_files:
        raise FileNotFoundError(f"No video or audio files found in {scenes_dir}")

    compose_audio_only(audio_files, output, source_video, scenes_dir)
    print(f"composed {len(audio_files)} audio files to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
