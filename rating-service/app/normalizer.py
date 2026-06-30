from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from rapidfuzz import fuzz, process

from .config import get_settings, load_companies_config

TR_TRANSLATION = str.maketrans(
    {
        "ç": "c",
        "Ç": "C",
        "ğ": "g",
        "Ğ": "G",
        "ı": "i",
        "I": "I",
        "İ": "I",
        "ö": "o",
        "Ö": "O",
        "ş": "s",
        "Ş": "S",
        "ü": "u",
        "Ü": "U",
    }
)

COMPANY_SUFFIX_RE = re.compile(
    r"""
    (?:
      \bA\s*\.?\s*Ş\s*\.?\b|
      \bA\s*\.?\s*S\s*\.?\b|
      \bANON[İI]M\s+Ş[İI]RKET[İI]\b|
      \bLTD\s*\.?\s*ŞT[İI]\s*\.?\b|
      \bL[İI]M[İI]TED\s+Ş[İI]RKET[İI]\b|
      \bLTD\s*\.?\b|
      \bŞT[İI]\s*\.?\b
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

OUTLOOK_MAP = {
    "duragan": "Durağan",
    "stabil": "Durağan",
    "stable": "Durağan",
    "pozitif": "Pozitif",
    "positive": "Pozitif",
    "negatif": "Negatif",
    "negative": "Negatif",
    "gelisen": "Gelişen",
    "developing": "Gelişen",
}

ACTION_MAP = {
    "ilk kez": "İlk Kez",
    "initial": "İlk Kez",
    "new rating": "İlk Kez",
    "guncelleme": "Güncelleme",
    "update": "Güncelleme",
    "surveillance": "Güncelleme",
    "not artirimi": "Not Artırımı",
    "upgrade": "Not Artırımı",
    "not dusurumu": "Not Düşürümü",
    "downgrade": "Not Düşürümü",
    "geri cekildi": "Geri Çekildi",
    "geri cekme": "Geri Çekildi",
    "withdrawn": "Geri Çekildi",
}

SECTOR_MAP = {
    "varlik yonetim": "Varlık Yönetim",
    "varlik yonetim sirketleri": "Varlık Yönetim",
    "asset management": "Varlık Yönetim",
    "npl asset management": "Varlık Yönetim",
    "araci kurum": "Aracı Kurum",
    "banka": "Banka",
    "faktoring": "Faktoring",
    "finansal kiralama": "Finansal Kiralama",
}


def normalize_text_key(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value.translate(TR_TRANSLATION))
    asciiish = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    asciiish = asciiish.replace("’", "'").replace("`", "'")
    asciiish = re.sub(r"[^A-Za-z0-9+/\-.' ]+", " ", asciiish)
    asciiish = re.sub(r"\s+", " ", asciiish).strip().lower()
    return asciiish


def clean_company_suffix(value: str | None) -> str:
    if not value:
        return ""
    cleaned = value.replace("’", "'").replace("`", "'")
    cleaned = COMPANY_SUFFIX_RE.sub(" ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.strip(" ,.-")
    return cleaned


def company_match_key(value: str | None) -> str:
    cleaned = clean_company_suffix(value)
    key = normalize_text_key(cleaned)
    key = re.sub(r"\b(as|anonim sirketi|limited sirketi|sirketi|sirket|ltd|sti)\b", " ", key)
    key = re.sub(r"[^a-z0-9]+", " ", key)
    return re.sub(r"\s+", " ", key).strip()


@lru_cache
def alias_map(config_path: str | None = None) -> dict[str, str]:
    if config_path:
        import yaml

        path = Path(config_path)
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    else:
        payload = load_companies_config(get_settings())
    aliases: dict[str, str] = {}
    for item in payload.get("companies", []) or []:
        canonical = clean_company_suffix(str(item.get("name", "")))
        if not canonical:
            continue
        aliases[company_match_key(canonical)] = canonical
        for alias in item.get("aliases", []) or []:
            aliases[company_match_key(str(alias))] = canonical
    return aliases


def normalize_company_name(value: str | None, *, fuzzy: bool = True) -> str:
    cleaned = clean_company_suffix(value)
    if not cleaned:
        return ""
    key = company_match_key(cleaned)
    aliases = alias_map()
    if key in aliases:
        return aliases[key]
    if fuzzy and aliases:
        match = process.extractOne(key, aliases.keys(), scorer=fuzz.WRatio, score_cutoff=92)
        if match:
            return aliases[match[0]]
    return cleaned


def aliases_for_company(value: str | None) -> list[str]:
    normalized = normalize_company_name(value)
    if not normalized:
        return []
    matches = [alias for alias, canonical in alias_map().items() if canonical == normalized]
    return sorted(set(matches))


def normalize_outlook(value: str | None) -> str | None:
    key = normalize_text_key(_empty_to_none(value))
    if not key or key in {"-", "n/a", "na"}:
        return None
    return OUTLOOK_MAP.get(key, value.strip() if value else None)


def normalize_action(value: str | None) -> str | None:
    key = normalize_text_key(_empty_to_none(value))
    if not key or key in {"-", "n/a", "na"}:
        return None
    for needle, normalized in ACTION_MAP.items():
        if needle in key:
            return normalized
    return value.strip() if value else None


def normalize_sector(value: str | None) -> str | None:
    key = normalize_text_key(_empty_to_none(value))
    if not key or key in {"-", "n/a", "na"}:
        return None
    for needle, normalized in SECTOR_MAP.items():
        if needle in key:
            return normalized
    return value.strip() if value else None


def is_same_company(candidate: str | None, query: str | None, cutoff: int = 88) -> bool:
    if not candidate or not query:
        return False
    candidate_key = company_match_key(normalize_company_name(candidate))
    query_key = company_match_key(normalize_company_name(query))
    if candidate_key == query_key:
        return True
    return fuzz.WRatio(candidate_key, query_key) >= cutoff


def clean_rating(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    if not cleaned or cleaned in {"-", "—", "–", "N/A", "n/a"}:
        return None
    return cleaned


def _empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped or stripped in {"-", "—", "–"}:
        return None
    return stripped
