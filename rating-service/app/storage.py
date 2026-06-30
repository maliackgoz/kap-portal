from __future__ import annotations

import csv
import json
import os
import tempfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from filelock import FileLock
from pydantic import BaseModel


def _lock_for(path: Path) -> FileLock:
    return FileLock(str(path) + ".lock", timeout=30)


def _jsonable(record: Any) -> dict[str, Any]:
    if isinstance(record, BaseModel):
        return record.model_dump(mode="json")
    if isinstance(record, dict):
        return record
    raise TypeError(f"Unsupported record type: {type(record)!r}")


def append_jsonl(path: Path, record: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _jsonable(record)
    with _lock_for(path):
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with _lock_for(path):
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    rows.append(json.loads(stripped))
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"Invalid JSONL in {path} at line {line_number}: {exc}"
                    ) from exc
    return rows


def upsert_jsonl(path: Path, records: Iterable[Any], key: str = "id") -> dict[str, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    incoming = [_jsonable(record) for record in records]
    with _lock_for(path):
        existing: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    row_key = str(row.get(key, ""))
                    if not row_key:
                        continue
                    if row_key not in existing:
                        order.append(row_key)
                    existing[row_key] = row

        added = 0
        updated = 0
        for row in incoming:
            row_key = str(row.get(key, ""))
            if not row_key:
                raise ValueError(f"Cannot upsert record without key {key!r}: {row}")
            if row_key in existing:
                if existing[row_key] != row:
                    updated += 1
                existing[row_key] = row
            else:
                added += 1
                order.append(row_key)
                existing[row_key] = row

        _atomic_write_jsonl_unlocked(path, [existing[row_key] for row_key in order])
    return {"added": added, "updated": updated, "total": len(existing)}


def delete_jsonl_matching(path: Path, predicate: Callable[[dict[str, Any]], bool]) -> int:
    if not path.exists():
        return 0
    with _lock_for(path):
        kept: list[dict[str, Any]] = []
        deleted = 0
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if predicate(row):
                    deleted += 1
                else:
                    kept.append(row)
        if deleted:
            _atomic_write_jsonl_unlocked(path, kept)
    return deleted


def _atomic_write_jsonl_unlocked(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock_for(path):
        fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
            os.replace(tmp_name, path)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)


def export_csv(records: Iterable[Any], path: Path) -> Path:
    rows = [_jsonable(record) for record in records]
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return path

    fieldnames = sorted({field for row in rows for field in row})
    with _lock_for(path):
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow({field: _cell(row.get(field)) for field in fieldnames})
    return path


def export_markdown(records: Iterable[Any], path: Path) -> Path:
    rows = [_jsonable(record) for record in records]
    path.parent.mkdir(parents=True, exist_ok=True)
    preferred = [
        "company_name_normalized",
        "source_agency",
        "rating_date",
        "long_term_rating_raw",
        "short_term_rating_raw",
        "outlook_normalized",
        "sector_normalized",
        "source_url",
    ]
    fieldnames = [field for field in preferred if any(field in row for row in rows)]
    if not fieldnames and rows:
        fieldnames = sorted(rows[0])

    lines = []
    if fieldnames:
        lines.append("| " + " | ".join(fieldnames) + " |")
        lines.append("| " + " | ".join("---" for _ in fieldnames) + " |")
        for row in rows:
            lines.append(
                "| " + " | ".join(_markdown_cell(row.get(field)) for field in fieldnames) + " |"
            )
    with _lock_for(path):
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return path


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "; ".join(str(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _markdown_cell(value: Any) -> str:
    return _cell(value).replace("|", "\\|").replace("\n", " ")
