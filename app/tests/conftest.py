import os

import pytest

# Evita falha de import se secrets não existirem em CI
os.environ.setdefault("TMDB_READ_ACCESS_TOKEN", "test-token-placeholder")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("GAMIFICATION_V2", "1")
os.environ.setdefault("BETS_ENABLED", "1")
os.environ.setdefault("SEASONS_ENABLED", "1")


@pytest.fixture
def flask_client():
    from app import app as flask_app

    flask_app.config["TESTING"] = True
    with flask_app.app_context():
        with flask_app.test_client() as client:
            yield client
