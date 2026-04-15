"""Cliente Gemini: geração de texto e embeddings com timeout unificado."""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from services.gemini_http_timeout import gemini_http_timeout_ms

_log = logging.getLogger("movies_app.gemini")

# Modelo de embedding (API Google Gen AI).
_DEFAULT_EMBED_MODEL = "gemini-embedding-001"


def _resolve_embed_model() -> str:
    return (os.environ.get("GEMINI_EMBEDDING_MODEL") or _DEFAULT_EMBED_MODEL).strip()


def gemini_generate_text(
    prompt: str,
    api_key: str,
    model_name: str,
    *,
    resolve_model_id: Any,
) -> tuple[str | None, str | None]:
    """
    Gera texto. `resolve_model_id` é callable(str)->str (aliases do app).
    Retorna (texto, erro_interno).
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return None, "Pacote google-genai não instalado (pip install google-genai)."

    resolved = resolve_model_id(model_name)
    try:
        timeout_ms = gemini_http_timeout_ms()
        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=timeout_ms),
        )
        response = client.models.generate_content(
            model=resolved,
            contents=prompt,
        )
    except Exception as exc:
        return None, str(exc)

    if not getattr(response, "candidates", None):
        fb = getattr(response, "prompt_feedback", None)
        return None, f"candidates vazios — prompt_feedback={fb}"

    try:
        text = (response.text or "").strip()
    except (ValueError, AttributeError) as exc:
        return None, f"resposta sem texto utilizável — {exc}"

    return text if text else None, None


def gemini_embed_text(api_key: str, text: str) -> tuple[list[float] | None, str | None]:
    """Retorna vetor de embedding ou (None, erro)."""
    if not text or not str(text).strip():
        return None, "texto vazio"
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return None, "Pacote google-genai não instalado"

    model = _resolve_embed_model()
    try:
        timeout_ms = gemini_http_timeout_ms()
        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=timeout_ms),
        )
        resp = client.models.embed_content(
            model=model,
            contents=str(text).strip()[:8000],
        )
    except Exception as exc:
        return None, str(exc)

    embs = getattr(resp, "embeddings", None) or []
    if not embs:
        return None, "embeddings vazios"
    vals = getattr(embs[0], "values", None)
    if not vals:
        return None, "embedding sem values"
    return [float(x) for x in vals], None


def embedding_to_json(vec: list[float]) -> str:
    return json.dumps(vec, separators=(",", ":"))


def embedding_from_json(s: str | None) -> list[float] | None:
    if not s:
        return None
    try:
        raw = json.loads(s)
        if isinstance(raw, list):
            return [float(x) for x in raw]
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    return None
