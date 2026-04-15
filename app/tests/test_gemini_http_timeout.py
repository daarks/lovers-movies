import importlib
import os

import pytest


@pytest.fixture(autouse=True)
def _clear_gemini_timeout_env(monkeypatch):
    monkeypatch.delenv("GEMINI_HTTP_TIMEOUT_MS", raising=False)


def test_gemini_timeout_default(monkeypatch):
    monkeypatch.delenv("GEMINI_HTTP_TIMEOUT_MS", raising=False)
    import services.gemini_http_timeout as m

    importlib.reload(m)
    assert m.gemini_http_timeout_ms() == 90_000


def test_gemini_timeout_valid_range(monkeypatch):
    import services.gemini_http_timeout as m

    monkeypatch.setenv("GEMINI_HTTP_TIMEOUT_MS", "120000")
    importlib.reload(m)
    assert m.gemini_http_timeout_ms() == 120_000

    monkeypatch.setenv("GEMINI_HTTP_TIMEOUT_MS", "5000")
    importlib.reload(m)
    assert m.gemini_http_timeout_ms() == 5_000


def test_gemini_timeout_invalid_falls_back(monkeypatch):
    import services.gemini_http_timeout as m

    monkeypatch.setenv("GEMINI_HTTP_TIMEOUT_MS", "not-a-number")
    importlib.reload(m)
    assert m.gemini_http_timeout_ms() == 90_000

    monkeypatch.setenv("GEMINI_HTTP_TIMEOUT_MS", "0")
    importlib.reload(m)
    assert m.gemini_http_timeout_ms() == 90_000

    monkeypatch.setenv("GEMINI_HTTP_TIMEOUT_MS", "999999999")
    importlib.reload(m)
    assert m.gemini_http_timeout_ms() == 90_000


def test_gemini_timeout_too_low_clamped(monkeypatch):
    import services.gemini_http_timeout as m

    monkeypatch.setenv("GEMINI_HTTP_TIMEOUT_MS", "3")
    importlib.reload(m)
    assert m.gemini_http_timeout_ms() == 5_000
