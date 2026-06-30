from __future__ import annotations

from app.storage import read_jsonl, upsert_jsonl


def test_upsert_jsonl_dedupes_and_updates(tmp_path):
    path = tmp_path / "ratings.jsonl"
    result = upsert_jsonl(path, [{"id": "1", "value": "a"}, {"id": "2", "value": "b"}])
    assert result["added"] == 2

    result = upsert_jsonl(path, [{"id": "1", "value": "changed"}, {"id": "3", "value": "c"}])
    rows = read_jsonl(path)

    assert result["added"] == 1
    assert result["updated"] == 1
    assert len(rows) == 3
    assert rows[0]["value"] == "changed"
