#!/usr/bin/env python3
"""Translator bridge for LaputaMediaCenter dubbing workflows.

Formal localization requires a translation provider key. Plain text passthrough
is only allowed when explicitly enabled for local smoke tests.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib import parse, request
from urllib.error import HTTPError

GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite"
OPENAI_DEFAULT_MODEL = "gpt-4o-mini"
MISTRAL_DEFAULT_MODEL = "mistral-small-latest"
ANTHROPIC_DEFAULT_MODEL = "claude-3-5-haiku-latest"
GEMINI_BATCH_SIZE = 4
GEMINI_RETRY_BATCH_SIZE = 3
TRANSLATION_STYLES = {"faithful", "conversational", "localized_script", "short_video"}
API_USER_AGENT = "LaputaMediaCenter/0.1 (+https://localhost)"
ANTHROPIC_VERSION = "2023-06-01"


def is_truthy_env(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def normalize_model_id(model: str | None) -> str:
    model_id = (model or "").strip()
    if model_id.startswith("models/"):
        return model_id.removeprefix("models/")
    return model_id


def read_segments(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("segments"), list):
        return data["segments"]
    raise ValueError(f"Unsupported segments format: {path}")


def normalize_language(value: str | None) -> str:
    return value or "unknown"


def normalize_style(value: str | None) -> str:
    if value in TRANSLATION_STYLES:
        return value
    return "conversational"


def normalize_user_glossary(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []

    glossary: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip()
        target = str(item.get("target") or "").strip()
        note = str(item.get("note") or "").strip()
        if not source or not target:
            continue
        entry = {"source": source, "target": target}
        if note:
            entry["note"] = note
        glossary.append(entry)
    return glossary


def apply_user_glossary_to_text(text: str, glossary: list[dict[str, str]]) -> str:
    result = text
    for entry in glossary:
        source = entry.get("source", "").strip()
        target = entry.get("target", "").strip()
        if not source or not target:
            continue
        result = re.sub(re.escape(source), target, result, flags=re.IGNORECASE)
    return result


def parse_glossary_json(value: str | None) -> list[dict[str, str]]:
    if not value:
        return []
    try:
        return normalize_user_glossary(json.loads(value))
    except Exception:
        return []


def normalize_creator_context(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}

    result: dict[str, str] = {}
    limits = {
        "content_brief": 2000,
        "speaker_identity": 500,
        "target_audience": 500,
        "creator_profile": 1500,
        "language_style": 1500,
        "revision_notes": 2000,
    }
    for key, limit in limits.items():
        text = str(value.get(key) or "").strip()
        if text:
            result[key] = text[:limit]

    wording_style = str(value.get("wording_style") or "").strip().lower()
    if wording_style in {"auto", "plain", "professional"}:
        result["wording_style"] = wording_style

    return result


def parse_creator_context_json(value: str | None) -> dict[str, str]:
    if not value:
        return {}
    try:
        return normalize_creator_context(json.loads(value))
    except Exception:
        return {}


def is_cantonese_target(value: str | None) -> bool:
    cleaned = (value or "").lower()
    return "cantonese" in cleaned or "yue" in cleaned


def is_chinese_target(value: str | None) -> bool:
    cleaned = (value or "").lower()
    return is_cantonese_target(cleaned) or cleaned in {"mandarin", "zh", "chinese"}


def is_script_rewrite_style(value: str | None) -> bool:
    return value == "localized_script"


def style_instruction(style: str, target_language: str) -> str:
    target = target_language or "target language"
    if is_cantonese_target(target_language):
        if style == "localized_script":
            return (
                "First understand the full conversation, then rewrite it as a natural Hong Kong "
                "Cantonese speaking script. Preserve the speakers' intent, factual claims, names, "
                "and sequence, but do not translate sentence-by-sentence."
            )
        if style == "faithful":
            return (
                "Translate into natural spoken Hong Kong Cantonese, preserving meaning, names, "
                "numbers, and factual nuance."
            )
        if style == "short_video":
            return (
                "Translate into compact spoken Hong Kong Cantonese for short video. Keep it lively, "
                "clear, and easy to dub, without excessive filler."
            )
        return (
            "Translate into natural spoken Hong Kong Cantonese for podcast or creator commentary. "
            "Keep the phrasing conversational and dub-friendly while preserving the original meaning."
        )
    if style == "faithful":
        return f"Translate into {target} faithfully, preserving meaning, names, and factual nuance."
    if style == "short_video":
        return (
            f"Translate into {target} as compact spoken delivery for short video, "
            "with clear rhythm and minimal filler."
        )
    if style == "localized_script":
        return (
            f"First understand the full conversation, then rewrite it as a natural spoken {target} "
            "script. Preserve the original intent, facts, and speaker sequence, but do not translate "
            "sentence-by-sentence."
        )
    return (
        f"Translate into natural spoken {target}, suitable for podcast or creator commentary, "
        "while preserving the original meaning."
    )


def language_label(value: str) -> str:
    labels = {
        "mandarin": "natural spoken Mandarin Chinese",
        "cantonese": "natural spoken Cantonese / Yue Chinese",
        "zh": "Chinese",
        "en": "English",
        "ja": "Japanese",
        "ko": "Korean",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "pt": "Portuguese",
        "it": "Italian",
        "ru": "Russian",
        "ar": "Arabic",
        "hi": "Hindi",
        "id": "Indonesian",
        "vi": "Vietnamese",
        "th": "Thai",
        "tr": "Turkish",
        "nl": "Dutch",
    }
    return labels.get(value, value or "target language")


def spoken_number_rules(target_language: str) -> list[str]:
    if not is_chinese_target(target_language):
        return []

    return [
        "Write translated_text as the spoken TTS script, not just display subtitles.",
        "For user-confirmed product or brand pronunciations, follow user_glossary exactly.",
        "For four-digit years followed by 年, read digit by digit: 1999年 -> 一九九九年, 2024年 -> 二零二四年.",
        "For two-digit shorthand years followed by 年 when the context means a year, read digit by digit: 99年 -> 九九年, 97年 -> 九七年; do not read 99年 as 九十九年.",
        "For ordinary cardinal numbers, use normal number reading: 59 -> 五十九, 120 -> 一百二十.",
        "Do not blindly rewrite version numbers, model names, prices, timestamps, or measurements unless the spoken meaning is clear or user_glossary specifies it.",
    ]


def wording_style_instruction(creator_context: dict[str, str] | None) -> str:
    style = (creator_context or {}).get("wording_style", "auto")
    if style == "plain":
        return (
            "The creator wants this version to be easy to understand. Use clear spoken wording, "
            "reduce avoidable jargon, and only explain dense terms when the meaning is already "
            "supported by the source segment."
        )
    if style == "professional":
        return (
            "The creator wants this version to sound professional. Preserve precise terminology, "
            "technical distinctions, names, and factual nuance; avoid oversimplifying the source."
        )
    return ""


def extract_json(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def get_segment_id(segment: dict[str, Any], index: int) -> Any:
    return segment.get("id", index)


def get_segment_text(segment: dict[str, Any]) -> str:
    return str(segment.get("text") or segment.get("original_text") or "").strip()


def chunks(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text))


def translation_for(
    translation_map: dict[Any, str],
    segment: dict[str, Any],
    index: int,
) -> str:
    segment_id = get_segment_id(segment, index)
    return str(translation_map.get(segment_id) or translation_map.get(str(segment_id)) or "").strip()


def needs_retry(
    segment: dict[str, Any],
    index: int,
    translated: str,
    target_language: str,
) -> bool:
    original = get_segment_text(segment)
    if not original:
        return False
    if not translated or translated == original:
        return True
    if target_language in {"mandarin", "cantonese", "zh"}:
        return bool(re.search(r"[A-Za-z]", original)) and not has_cjk(translated)
    return False


def normalize_gemini_base_url(value: str | None) -> str:
    cleaned = (value or "").strip().rstrip("/")
    if not cleaned:
        return "https://generativelanguage.googleapis.com/v1beta"
    if cleaned.endswith("/models"):
        return cleaned[: -len("/models")]
    return cleaned


def is_openai_compatible_base_url(value: str | None) -> bool:
    cleaned = (value or "").strip()
    if not cleaned:
        return False
    parsed = parse.urlparse(cleaned)
    path = parsed.path.rstrip("/").lower()
    if parsed.hostname and parsed.hostname.lower() == "x666.me":
        return True
    if path.endswith("/chat/completions"):
        return True
    return (path == "/v1" or path.endswith("/v1")) and "/v1beta" not in path


def normalize_openai_base_url(value: str) -> str:
    cleaned = value.strip().rstrip("/")
    parsed = parse.urlparse(cleaned)
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        path = path[: -len("/chat/completions")] or "/"
    if not path or path == "/":
        path = "/v1"
    return parse.urlunparse(
        (parsed.scheme, parsed.netloc, path.rstrip("/"), "", "", "")
    ).rstrip("/")


def normalize_anthropic_base_url(value: str | None) -> str:
    cleaned = (value or "").strip().rstrip("/")
    if not cleaned:
        return "https://api.anthropic.com/v1"
    parsed = parse.urlparse(cleaned)
    path = parsed.path.rstrip("/")
    if path.endswith("/messages"):
        path = path[: -len("/messages")] or "/"
    if not path or path == "/":
        path = "/v1"
    return parse.urlunparse(
        (parsed.scheme, parsed.netloc, path.rstrip("/"), "", "", "")
    ).rstrip("/")


def normalize_provider(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"anthropic", "claude"}:
        return "anthropic"
    if normalized in {"gemini", "openai", "mistral"}:
        return normalized
    return ""


def default_model_for_provider(provider: str) -> str:
    if provider == "openai":
        return OPENAI_DEFAULT_MODEL
    if provider == "mistral":
        return MISTRAL_DEFAULT_MODEL
    if provider == "anthropic":
        return ANTHROPIC_DEFAULT_MODEL
    return GEMINI_DEFAULT_MODEL


def extract_openai_chat_text(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return ""
    return str(message.get("content") or "")


def extract_anthropic_message_text(data: dict[str, Any]) -> str:
    content = data.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text" and isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "".join(parts)


def read_json_response(req: request.Request) -> dict[str, Any]:
    try:
        with request.urlopen(req, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API request failed ({error.code}): {body[:1000]}") from error


def generation_temperature(translation_style: str) -> float:
    if translation_style == "faithful":
        return 0.3
    if translation_style == "localized_script":
        return 0.65
    return 0.55


def call_gemini_json(
    api_key: str,
    api_base_url: str,
    model: str,
    prompt: dict[str, Any],
    temperature: float,
    provider: str = "gemini",
    max_tokens: int = 8192,
) -> dict[str, Any]:
    provider_id = normalize_provider(provider) or "gemini"
    model_id = normalize_model_id(model) or default_model_for_provider(provider_id)
    if provider_id == "anthropic":
        anthropic_payload = {
            "model": model_id,
            "system": "Return only valid JSON. Do not add markdown fences or commentary.",
            "messages": [{"role": "user", "content": json.dumps(prompt, ensure_ascii=False)}],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        req = request.Request(
            f"{normalize_anthropic_base_url(api_base_url)}/messages",
            data=json.dumps(anthropic_payload).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": ANTHROPIC_VERSION,
                "User-Agent": API_USER_AGENT,
            },
            method="POST",
        )
    elif provider_id in {"openai", "mistral"} or is_openai_compatible_base_url(api_base_url):
        openai_payload = {
            "model": model_id,
            "messages": [
                {
                    "role": "system",
                    "content": "Return only valid JSON. Do not add markdown fences or commentary.",
                },
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        req = request.Request(
            f"{normalize_openai_base_url(api_base_url)}/chat/completions",
            data=json.dumps(openai_payload).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                "User-Agent": API_USER_AGENT,
            },
            method="POST",
        )
    else:
        base_url = normalize_gemini_base_url(api_base_url)
        url = f"{base_url}/models/{parse.quote(model_id, safe='')}:generateContent"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": API_USER_AGENT,
            "x-goog-api-key": api_key,
        }
        if api_base_url:
            headers["Authorization"] = f"Bearer {api_key}"
        payload = {
            "contents": [
                {"role": "user", "parts": [{"text": json.dumps(prompt, ensure_ascii=False)}]}
            ],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
            },
        }
        req = request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )

    data = read_json_response(req)
    if provider_id == "anthropic":
        text = extract_anthropic_message_text(data)
    elif provider_id in {"openai", "mistral"} or is_openai_compatible_base_url(api_base_url):
        text = extract_openai_chat_text(data)
    else:
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
    if not text:
        raise RuntimeError(f"LLM returned no text: {json.dumps(data, ensure_ascii=False)[:1000]}")

    parsed = extract_json(text)
    if not isinstance(parsed, dict):
        raise RuntimeError("LLM JSON response must be an object")
    return parsed


def build_context_brief_with_gemini(
    api_key: str,
    api_base_url: str,
    model: str,
    provider: str,
    segments: list[dict[str, Any]],
    source_language: str,
    target_language: str,
    translation_style: str,
    user_glossary: list[dict[str, str]] | None = None,
    creator_context: dict[str, str] | None = None,
) -> dict[str, Any]:
    items = [
        {
            "id": get_segment_id(segment, index),
            "start": float(segment.get("start") or 0),
            "end": float(segment.get("end") or 0),
            "text": get_segment_text(segment),
        }
        for index, segment in enumerate(segments)
    ]
    prompt = {
        "task": "Analyze a full transcript before AI dubbing script rewriting.",
        "source_language": source_language,
        "target_language": language_label(target_language),
        "translation_style": translation_style,
        "instructions": [
            "Understand what the speakers are doing before any segment-level rewriting.",
            "Use creator_context as user-provided orientation for topic, speaker identity, creator profile, audience, language style, and wording depth.",
            "If creator_context.revision_notes exists, treat it as QA revision goals for this rerun; apply them when consistent with the transcript.",
            "Do not add unsupported facts from creator_context; use it to choose interpretations and wording when consistent with the transcript.",
            "Treat user_glossary as authoritative user-provided corrections.",
            "Use user_glossary entries exactly when relevant, including proper names and product names.",
            *spoken_number_rules(target_language),
            *([wording_style_instruction(creator_context)] if wording_style_instruction(creator_context) else []),
            "Infer speaker roles and turn-taking when the transcript makes it obvious.",
            "Identify likely ASR mistakes from local transcript context, but do not use external knowledge.",
            "If a proper name, product name, or technical term is uncertain, preserve the transcript wording.",
            "Create a short localization strategy for making the target-language dubbing sound human.",
            "Return only JSON.",
        ],
        "response_schema": {
            "summary": "what is happening in this clip",
            "speaker_notes": ["speaker role, relationship, and tone"],
            "likely_asr_corrections": [{"segment_id": "id", "note": "possible correction"}],
            "glossary": [{"source": "term", "target": "preferred localized wording"}],
            "rewrite_strategy": ["how to rewrite naturally while preserving meaning"],
        },
        "creator_context": creator_context or {},
        "user_glossary": user_glossary or [],
        "segments": items,
    }
    return call_gemini_json(
        api_key,
        api_base_url,
        model,
        prompt,
        generation_temperature(translation_style),
        provider=provider,
        max_tokens=4096,
    )


def translate_with_gemini(
    api_key: str,
    api_base_url: str,
    model: str,
    provider: str,
    segments: list[dict[str, Any]],
    source_language: str,
    target_language: str,
    translation_style: str,
    context_brief: dict[str, Any] | None = None,
    user_glossary: list[dict[str, str]] | None = None,
    creator_context: dict[str, str] | None = None,
) -> dict[Any, str]:
    items = [
        {
            "id": get_segment_id(segment, index),
            "start": float(segment.get("start") or 0),
            "end": float(segment.get("end") or 0),
            "text": get_segment_text(segment),
        }
        for index, segment in enumerate(segments)
    ]
    rules = [
        "Return only JSON.",
        "Keep the same ids and order.",
        "Return exactly one item for every input segment.",
        "Preserve names, numbers, dates, and factual claims.",
        "Make translated_text natural when spoken aloud.",
        "Do not add commentary or explanations.",
        "Use creator_context to understand the topic, speaker identity, creator profile, intended audience, language style, and wording depth.",
        "If creator_context.revision_notes exists, treat it as QA revision goals for this rerun; apply them when consistent with the transcript.",
        "Do not insert facts from creator_context unless the source segment supports them.",
        "User glossary entries are authoritative and must override transcript ambiguity or model guesses.",
        "When user_glossary maps a term to a target form, use the target form exactly.",
        *spoken_number_rules(target_language),
    ]
    wording_rule = wording_style_instruction(creator_context)
    if wording_rule:
        rules.append(wording_rule)
    if is_script_rewrite_style(translation_style):
        rules.extend(
            [
                "This is a localized speaking script rewrite, not a literal subtitle translation.",
                "Use the context brief to infer intent, speaker roles, and likely ASR issues.",
                "Keep each output item aligned to the same segment id and approximate time budget.",
                "You may change word order, combine implied meaning, and choose more natural phrasing within the segment.",
                "Do not replace proper names, product names, or technical terms with guessed corrections.",
                "Use likely ASR corrections only when the transcript itself makes the correction obvious.",
                "Do not add new claims, jokes, opinions, or explanations that are not supported by the source.",
            ]
        )
    if is_cantonese_target(target_language):
        rules.extend(
            [
                "Use natural Hong Kong Cantonese wording such as 我哋, 你哋, 嘅, 喺, 嚟, 係 when appropriate.",
                "Avoid Mandarin-only phrasing and avoid mechanically converting Mandarin into Traditional Chinese.",
                "Do not overuse commas, ellipses, or tiny chopped phrases; keep a natural spoken rhythm for TTS.",
            ]
        )

    prompt = {
        "task": "Translate subtitle segments for AI dubbing.",
        "source_language": source_language,
        "target_language": language_label(target_language),
        "translation_style": translation_style,
        "style_instruction": style_instruction(translation_style, language_label(target_language)),
        "creator_context": creator_context or {},
        "context_brief": context_brief,
        "user_glossary": user_glossary or [],
        "rules": rules,
        "response_schema": {"translations": [{"id": "same id", "translated_text": "text"}]},
        "segments": items,
    }
    parsed = call_gemini_json(
        api_key,
        api_base_url,
        model,
        prompt,
        generation_temperature(translation_style),
        provider=provider,
    )
    translations = parsed.get("translations") if isinstance(parsed, dict) else None
    if not isinstance(translations, list):
        raise RuntimeError("LLM translation response missing translations list")

    result: dict[Any, str] = {}
    for item in translations:
        if not isinstance(item, dict):
            continue
        if "id" not in item:
            continue
        translated_text = str(item.get("translated_text") or "").strip()
        if translated_text:
            result[item["id"]] = translated_text
            result[str(item["id"])] = translated_text

    return result


def translate_all_with_gemini(
    api_key: str,
    api_base_url: str,
    model: str,
    provider: str,
    segments: list[dict[str, Any]],
    source_language: str,
    target_language: str,
    translation_style: str,
    context_brief: dict[str, Any] | None = None,
    user_glossary: list[dict[str, str]] | None = None,
    creator_context: dict[str, str] | None = None,
) -> dict[Any, str]:
    result: dict[Any, str] = {}

    for batch in chunks(segments, GEMINI_BATCH_SIZE):
        result.update(
            translate_with_gemini(
                api_key,
                api_base_url,
                model,
                provider,
                batch,
                source_language,
                target_language,
                translation_style,
                context_brief,
                user_glossary,
                creator_context,
            )
        )

    for _attempt in range(3):
        missing = [
            segment
            for index, segment in enumerate(segments)
            if needs_retry(segment, index, translation_for(result, segment, index), target_language)
        ]
        if not missing:
            break

        for batch in chunks(missing, GEMINI_RETRY_BATCH_SIZE):
            result.update(
                translate_with_gemini(
                    api_key,
                    api_base_url,
                    model,
                    provider,
                    batch,
                    source_language,
                    target_language,
                    translation_style,
                    context_brief,
                    user_glossary,
                    creator_context,
                )
            )

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Translate ASR segments into translations.json")
    parser.add_argument("segments_file")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--target-lang", dest="target_lang")
    parser.add_argument("--target-language", dest="target_language")
    parser.add_argument("--source-lang", dest="source_lang")
    parser.add_argument("--source-language", dest="source_language")
    parser.add_argument("--style", dest="style")
    parser.add_argument("--translation-style", dest="translation_style")
    parser.add_argument("--mode", choices=["session", "api"], default="session")
    parser.add_argument("--api-provider", default="")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--api-base-url", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--glossary-json", default="")
    parser.add_argument("--creator-context-json", default="")
    parser.add_argument(
        "--allow-passthrough",
        action="store_true",
        help="Allow original-text passthrough for local smoke tests when no translation provider key exists.",
    )
    args = parser.parse_args()

    source_language = normalize_language(args.source_lang or args.source_language)
    target_language = normalize_language(args.target_lang or args.target_language)
    translation_style = normalize_style(args.style or args.translation_style)
    user_glossary = parse_glossary_json(
        args.glossary_json or os.environ.get("CHUANGCUT_LOCALIZATION_GLOSSARY")
    )
    creator_context = parse_creator_context_json(
        args.creator_context_json or os.environ.get("CHUANGCUT_CREATOR_CONTEXT")
    )
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    segments = read_segments(Path(args.segments_file))
    requested_provider = normalize_provider(
        args.api_provider or os.environ.get("LMC_LLM_REQUEST_FORMAT") or ""
    )
    generic_key = (
        args.api_key
        or os.environ.get("CHUANGCUT_TRANSLATE_API_KEY")
        or os.environ.get("LMC_LLM_API_KEY")
        or ""
    )
    inferred_provider = ""
    api_key = generic_key
    if os.environ.get("LMC_LLM_API_KEY") and not requested_provider:
        inferred_provider = "openai"
    if not api_key and (requested_provider == "anthropic" or os.environ.get("ANTHROPIC_API_KEY")):
        api_key = os.environ.get("ANTHROPIC_API_KEY") or ""
        inferred_provider = "anthropic"
    if not api_key and (requested_provider == "openai" or os.environ.get("OPENAI_API_KEY")):
        api_key = os.environ.get("OPENAI_API_KEY") or ""
        inferred_provider = "openai"
    if not api_key and (requested_provider == "mistral" or os.environ.get("MISTRAL_API_KEY")):
        api_key = os.environ.get("MISTRAL_API_KEY") or ""
        inferred_provider = "mistral"
    if not api_key:
        api_key = (
            os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_AI_STUDIO_API_KEY")
            or ""
        )
        if api_key:
            inferred_provider = "gemini"

    provider = requested_provider or inferred_provider or ("gemini" if api_key else "passthrough")
    api_base_url = args.api_base_url or os.environ.get("LMC_LLM_API_BASE_URL") or ""
    if not api_base_url:
        if provider == "anthropic":
            api_base_url = os.environ.get("ANTHROPIC_API_BASE_URL") or ""
        elif provider == "openai":
            api_base_url = os.environ.get("OPENAI_API_BASE_URL") or ""
        elif provider == "mistral":
            api_base_url = os.environ.get("MISTRAL_API_BASE_URL") or ""
        else:
            api_base_url = (
                os.environ.get("GEMINI_API_BASE_URL")
                or os.environ.get("GOOGLE_AI_STUDIO_API_BASE_URL")
                or ""
            )
    model = normalize_model_id(args.model or os.environ.get("LMC_LLM_MODEL") or "")
    if not model:
        if provider == "anthropic":
            model = normalize_model_id(os.environ.get("ANTHROPIC_MODEL") or "")
        elif provider == "openai":
            model = normalize_model_id(os.environ.get("OPENAI_MODEL") or "")
        elif provider == "mistral":
            model = normalize_model_id(os.environ.get("MISTRAL_MODEL") or "")
        else:
            model = normalize_model_id(os.environ.get("GEMINI_MODEL_ID") or "")
    passthrough_allowed = args.allow_passthrough or is_truthy_env(
        os.environ.get("DUBBING_ALLOW_PASSTHROUGH_TRANSLATION")
    )

    if not api_key and not passthrough_allowed:
        raise ValueError(
            "DUBBING_TRANSLATION_NOT_CONFIGURED: no translation provider key configured. "
            "Set LMC_LLM_API_KEY, provider-specific API keys, or explicitly enable "
            "DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=true for smoke tests."
        )

    translation_map: dict[Any, str] = {}
    context_brief: dict[str, Any] | None = None
    if api_key:
        # LaputaMediaCenter Phase 3.A：扩展 provider 支持。两阶段 prompt 文本完全不动；
        # OpenAI / Mistral 走 OpenAI-compatible；Anthropic / Claude 走 Messages API。
        # - openai: 默认 https://api.openai.com/v1
        # - mistral: 默认 https://api.mistral.ai/v1
        # - anthropic: 默认 https://api.anthropic.com/v1
        if provider not in ("gemini", "openai", "mistral", "anthropic"):
            raise ValueError(f"Unsupported translation provider: {provider}")

        # 为非 Gemini provider 提供默认 base URL（如果 TS 层没传）
        if provider == "openai" and not api_base_url:
            api_base_url = "https://api.openai.com/v1"
        elif provider == "mistral" and not api_base_url:
            api_base_url = "https://api.mistral.ai/v1"
        elif provider == "anthropic" and not api_base_url:
            api_base_url = "https://api.anthropic.com/v1"

        # 两阶段邏輯共用，不分 provider（call_gemini_json 内部按 base URL 自动分发）
        if is_script_rewrite_style(translation_style):
            try:
                context_brief = build_context_brief_with_gemini(
                    api_key,
                    api_base_url,
                    model,
                    provider,
                    segments,
                    source_language,
                    target_language,
                    translation_style,
                    user_glossary,
                    creator_context,
                )
            except Exception as error:
                context_brief = {"warning": f"context brief failed: {error}"}
        translation_map = translate_all_with_gemini(
            api_key,
            api_base_url,
            model,
            provider,
            segments,
            source_language,
            target_language,
            translation_style,
            context_brief,
            user_glossary,
            creator_context,
        )

    translated_segments: list[dict[str, Any]] = []
    for index, segment in enumerate(segments):
        segment_id = get_segment_id(segment, index)
        original = get_segment_text(segment)
        translated = str(
            translation_map.get(segment_id)
            or translation_map.get(str(segment_id))
            or segment.get("translated_text")
            or original
        ).strip()
        translated = apply_user_glossary_to_text(translated, user_glossary)
        translated_segments.append(
            {
                "id": segment_id,
                "start": float(segment.get("start") or 0),
                "end": float(segment.get("end") or 0),
                "original_text": original,
                "translated_text": translated,
            }
        )

    payload = {
        "source_language": source_language,
        "target_language": target_language,
        "translation_style": translation_style,
        "style_instruction": style_instruction(translation_style, target_language),
        "mode": args.mode,
        "provider": provider,
        "model": model or None,
        "api_base_url": api_base_url or None,
        "used_provider": bool(api_key),
        "creator_context": creator_context,
        "user_glossary": user_glossary,
        "context_brief": context_brief,
        "segments": translated_segments,
        "warning": (
            "No translation provider is configured; translated_text currently mirrors original_text."
            if not api_key
            else None
        ),
    }
    target = output_dir / "translations.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(translated_segments)} translated segments to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
