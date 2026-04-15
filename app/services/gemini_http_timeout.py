"""
Timeout HTTP do cliente Gemini (SDK google-genai).

Default: 90_000 ms. Override: GEMINI_HTTP_TIMEOUT_MS.
Valores inválidos, <=0 ou acima do teto seguro usam fallback e geram warning em log.
"""
from __future__ import annotations

import logging
import os

# Faixa segura (ms): mínimo para evitar timeouts espúrios; máximo para evitar hangs absurdos.
_GEMINI_TIMEOUT_MS_MIN = 5_000
_GEMINI_TIMEOUT_MS_MAX = 180_000
_GEMINI_TIMEOUT_MS_DEFAULT = 90_000

_log = logging.getLogger("movies_app.gemini")


def gemini_http_timeout_ms() -> int:
    """
    Retorna timeout em milissegundos para HttpOptions(timeout=...) do SDK.

    - Sem env ou vazio: 90000.
    - Não inteiro, <=0, >180000: fallback 90000 + warning.
    - Entre 1 e 4999: clamp para 5000 + warning (opcional; plano pedia fallback seguro).
    - Entre 5000 e 180000: valor usado.
    - Entre 180001 e 300000 (legado): fallback 90000 + warning.
    """
    raw = (os.environ.get("GEMINI_HTTP_TIMEOUT_MS") or "").strip()
    if not raw:
        return _GEMINI_TIMEOUT_MS_DEFAULT

    try:
        ms = int(raw, 10)
    except ValueError:
        _log.warning(
            "GEMINI_HTTP_TIMEOUT_MS inválido (%r); usando default=%sms",
            raw[:80],
            _GEMINI_TIMEOUT_MS_DEFAULT,
        )
        return _GEMINI_TIMEOUT_MS_DEFAULT

    if ms <= 0:
        _log.warning(
            "GEMINI_HTTP_TIMEOUT_MS não positivo (%s); usando default=%sms",
            ms,
            _GEMINI_TIMEOUT_MS_DEFAULT,
        )
        return _GEMINI_TIMEOUT_MS_DEFAULT

    if ms < _GEMINI_TIMEOUT_MS_MIN:
        _log.warning(
            "GEMINI_HTTP_TIMEOUT_MS muito baixo (%s); clamp para %sms",
            ms,
            _GEMINI_TIMEOUT_MS_MIN,
        )
        return _GEMINI_TIMEOUT_MS_MIN

    if ms > _GEMINI_TIMEOUT_MS_MAX:
        _log.warning(
            "GEMINI_HTTP_TIMEOUT_MS acima do teto seguro (%s > %s); usando default=%sms",
            ms,
            _GEMINI_TIMEOUT_MS_MAX,
            _GEMINI_TIMEOUT_MS_DEFAULT,
        )
        return _GEMINI_TIMEOUT_MS_DEFAULT

    return ms
