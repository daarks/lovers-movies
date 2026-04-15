from services.search_hybrid import cosine_similarity, hybrid_rank_score, lexical_score


def test_cosine_similarity():
    a = [1.0, 0.0, 0.0]
    b = [1.0, 0.0, 0.0]
    assert abs(cosine_similarity(a, b) - 1.0) < 1e-6


def test_lexical_score():
    doc = {
        "title": "Filme triste sobre perda",
        "overview": "Uma história melancólica.",
        "genres_csv": "Drama",
        "credits_blob": "",
    }
    s = lexical_score("filme triste perda", doc)
    assert s > 0


def test_hybrid_rank():
    sc = hybrid_rank_score(sem=0.5, lex=0.4, vote=8.0)
    assert 0 < sc < 1
