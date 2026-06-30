from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote_plus, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

from ..config import load_companies_config
from ..dedupe import dedupe_records, with_rating_id
from ..models import RatingRecord, RunLog
from ..normalizer import (
    aliases_for_company,
    clean_rating,
    normalize_action,
    normalize_company_name,
    normalize_outlook,
    normalize_sector,
    normalize_text_key,
)
from .base import FetchedPage, GenericTableRatingScraper, parse_date

ProviderStatus = str

RATING_STATUSES = {
    "FOUND",
    "NO_MATCH",
    "LOGIN_REQUIRED",
    "BLOCKED",
    "SUBSCRIPTION_REQUIRED",
    "PARSE_ERROR",
}

LONG_TERM_RATINGS = [
    "AAA",
    "AA+",
    "AA",
    "AA-",
    "A+",
    "A",
    "A-",
    "BBB+",
    "BBB",
    "BBB-",
    "BB+",
    "BB",
    "BB-",
    "B+",
    "B",
    "B-",
    "CCC+",
    "CCC",
    "CCC-",
    "CC",
    "C",
    "D",
]

SHORT_TERM_RATINGS = [
    "F1+",
    "F1",
    "F2",
    "F3",
    "A-1+",
    "A-1",
    "A-2",
    "A-3",
    "P-1",
    "P-2",
    "P-3",
    "B",
    "C",
    "D",
]

OUTLOOK_VALUES = [
    "Rating Watch Negative",
    "Rating Watch Positive",
    "Developing",
    "Stable",
    "Negative",
    "Positive",
    "Watch",
]

ACCESS_PATTERNS = {
    "LOGIN_REQUIRED": [
        "sign in",
        "login",
        "log in",
        "create account",
        "registration required",
    ],
    "SUBSCRIPTION_REQUIRED": [
        "subscription required",
        "subscriber",
        "paid subscription",
        "not entitled",
        "permission required",
    ],
    "BLOCKED": [
        "captcha",
        "access denied",
        "forbidden",
        "blocked",
        "cloudflare",
        "akamai",
        "too many requests",
    ],
}

GENERIC_LINK_LABELS = {
    "about",
    "all insights",
    "careers",
    "contact",
    "contact us",
    "cookie notice",
    "events",
    "home",
    "insights",
    "login",
    "log in",
    "privacy",
    "ratings",
    "ratings definitions",
    "research",
    "search",
    "sign in",
    "terms",
}


@dataclass
class RatingResult:
    companyName: str
    agency: str
    status: ProviderStatus
    confidence: float
    fetchedAt: str
    matchedName: str | None = None
    ratingDate: str | None = None
    longTermRating: str | None = None
    shortTermRating: str | None = None
    nationalRating: str | None = None
    outlook: str | None = None
    action: str | None = None
    sector: str | None = None
    sourceUrl: str | None = None
    rawText: str | None = None
    errorMessage: str | None = None
    searchQueries: list[str] = field(default_factory=list)
    candidateUrls: list[str] = field(default_factory=list)


def normalize_company_name_for_search(value: str | None) -> str:
    key = normalize_text_key(value).upper()
    key = re.sub(r"[^A-Z0-9]+", " ", key)
    key = re.sub(
        r"\b(A\s*S|AS|A\s*S\s*\.|T\s*A\s*S|TAS|ANONIM|SIRKETI|SIRKET|"
        r"SANAYI|TICARET|VE TICARET|YATIRIM ORTAKLIGI|ORTAKLIGI|HOLDING|"
        r"LTD|STI|LIMITED)\b",
        " ",
        key,
    )
    key = re.sub(r"[^A-Z0-9]+", " ", key)
    return re.sub(r"\s+", " ", key).strip()


def generate_search_variants(company_name: str) -> list[str]:
    base = normalize_company_name_for_search(company_name)
    if not base:
        return []
    variants = [company_name.strip(), base, f"{base} A.S."]

    replacements = [
        (" YATIRIM BANKASI", " INVESTMENT BANK"),
        (" BANKASI", " BANK"),
        (" MENKUL DEGERLER", " SECURITIES"),
        (" VARLIK YONETIM", " ASSET MANAGEMENT"),
        (" GAYRIMENKUL YATIRIM ORTAKLIGI", " REIT"),
        (" FINANSAL KIRALAMA", " LEASING"),
    ]
    for old, new in replacements:
        if old in f" {base}":
            variants.append(base.replace(old.strip(), new.strip()))

    if "YATIRIM BANKASI" in base:
        variants.append(base.replace("YATIRIM BANKASI", "BANK"))
    if "BANKASI" in base:
        variants.append(base.replace("BANKASI", "BANK"))

    tokens = base.split()
    if len(tokens) > 2:
        variants.append(" ".join(tokens[:2]))
    if len(tokens) > 3:
        variants.append(" ".join(tokens[:3]))

    seen: set[str] = set()
    output: list[str] = []
    for item in variants:
        cleaned = re.sub(r"\s+", " ", item).strip(" .")
        key = normalize_company_name_for_search(cleaned)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(cleaned)
    return output[:6]


def _company_semantic_forms(key: str) -> set[str]:
    forms = {key}
    replacements = [
        ("YATIRIM BANKASI", "INVESTMENT BANK"),
        ("INVESTMENT BANK", "YATIRIM BANKASI"),
        ("BANKASI", "BANK"),
        ("BANK", "BANKASI"),
        ("MENKUL DEGERLER", "SECURITIES"),
        ("SECURITIES", "MENKUL DEGERLER"),
        ("VARLIK YONETIM", "ASSET MANAGEMENT"),
        ("ASSET MANAGEMENT", "VARLIK YONETIM"),
        ("FINANSAL KIRALAMA", "LEASING"),
        ("LEASING", "FINANSAL KIRALAMA"),
    ]
    for old, new in replacements:
        if old in key:
            forms.add(key.replace(old, new))
    return {re.sub(r"\s+", " ", item).strip() for item in forms if item.strip()}


def fuzzy_match_company(query: str, candidate: str) -> float:
    query_key = normalize_company_name_for_search(query)
    candidate_key = normalize_company_name_for_search(candidate)
    if not query_key or not candidate_key:
        return 0.0
    scores: list[float] = []
    for query_form in _company_semantic_forms(query_key):
        for candidate_form in _company_semantic_forms(candidate_key):
            if query_form == candidate_form:
                scores.append(1.0)
                continue
            if query_form in candidate_form:
                scores.append(0.92)
                continue
            query_tokens = set(query_form.split())
            candidate_tokens = set(candidate_form.split())
            overlap = len(query_tokens & candidate_tokens) / max(len(query_tokens), 1)
            fuzzy = max(
                fuzz.WRatio(query_form, candidate_form),
                fuzz.token_set_ratio(query_form, candidate_form),
            ) / 100
            scores.append(max(fuzzy * 0.75 + overlap * 0.25, overlap))
    return round(max(scores), 3)


def parse_rating_from_text(text: str, agency: str | None = None) -> dict[str, str | None]:
    compact = _clean_text(text)
    rating_context = _rating_context(compact)
    long_term = _first_rating(rating_context, LONG_TERM_RATINGS)
    short_term = _first_rating(rating_context, SHORT_TERM_RATINGS)
    if not long_term:
        long_term = _first_rating(compact[:5000], LONG_TERM_RATINGS)
    national = _parse_national_rating(compact)
    return {
        "long_term_rating": long_term,
        "short_term_rating": short_term if short_term != long_term else None,
        "national_rating": national,
    }


def parse_outlook_from_text(text: str) -> str | None:
    key_text = _clean_text(text)
    for value in OUTLOOK_VALUES:
        if re.search(rf"\b{re.escape(value)}\b", key_text, flags=re.IGNORECASE):
            return value
    return None


def parse_rating_date_from_text(text: str) -> str | None:
    date_patterns = [
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{1,2}[./]\d{1,2}[./]\d{4}\b",
        r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b",
        r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{4}\b",
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        parsed = parse_date(match.group(0))
        if parsed:
            return parsed.isoformat()
    return None


class BaseGlobalRatingsProvider(GenericTableRatingScraper):
    """Company-by-company adapter for global agencies with explicit empty statuses."""

    agency_name = "Global Ratings"
    api_key_env = ""
    api_base_env = ""
    allowed_domains: tuple[str, ...] = ()
    public_search_templates: tuple[str, ...] = ()
    candidate_path_keywords: tuple[str, ...] = ()

    def run(self) -> tuple[list[RatingRecord], RunLog]:
        started_at = datetime.now(UTC)
        log = RunLog(
            run_id=str(uuid.uuid4()),
            source=self.source_key,
            started_at=started_at,
            status="success",
        )
        records: list[RatingRecord] = []
        try:
            records.extend(self._manual_records())
            companies = self._known_company_names()
            for company in companies:
                result = self.search_company(company)
                records.append(self._result_to_record(result))
                self.errors.append(self._debug_log_line(result))

            records = dedupe_records([with_rating_id(record) for record in records])
            log.records_found = len(records)
            statuses = [
                record.provider_status
                for record in records
                if record.source_agency == self.source_name
            ]
            log.status = self._run_status(statuses)
            log.errors.extend(self.errors[-250:])
            if not records and not log.errors:
                log.status = "skipped"
                log.errors.append("Manual import veya aranacak sirket bulunamadi.")
        except Exception as exc:  # noqa: BLE001
            records = []
            log.status = "error"
            log.errors.append(f"{type(exc).__name__}: {exc}")
        log.finished_at = datetime.now(UTC)
        return records, log

    def fetch(self) -> list[FetchedPage]:
        return self._manual_import_pages()

    def search_company(self, company_name: str) -> RatingResult:
        queries = generate_search_variants(company_name)
        fetched_at = datetime.now(UTC).isoformat()
        if not queries:
            return RatingResult(
                companyName=company_name,
                agency=self.source_name,
                status="NO_MATCH",
                confidence=0.0,
                fetchedAt=fetched_at,
                errorMessage="EMPTY_QUERY",
            )

        api_result = self._official_api_search(company_name, queries, fetched_at)
        if api_result and api_result.status != "NO_MATCH":
            return api_result

        return self._public_fallback_search(company_name, queries, fetched_at)

    def _manual_records(self) -> list[RatingRecord]:
        pages = self._manual_import_pages()
        if not pages:
            return []
        rows = self.parse(pages)
        records = GenericTableRatingScraper.normalize(self, rows)
        return [
            record.model_copy(
                update={
                    "provider_status": "FOUND",
                    "match_confidence": record.extraction_confidence,
                    "fetched_at": record.extracted_at,
                }
            )
            for record in records
        ]

    def _known_company_names(self) -> list[str]:
        config = load_companies_config(self.settings)
        names: list[str] = []
        seen: set[str] = set()
        for item in config.get("companies", []) or []:
            name = str(item.get("name") or "").strip()
            key = normalize_company_name_for_search(name)
            if name and key and key not in seen:
                seen.add(key)
                names.append(name)
        return names[: max(1, int(self.settings.global_provider_max_companies))]

    def _official_api_search(
        self, company_name: str, queries: list[str], fetched_at: str
    ) -> RatingResult | None:
        api_key = os.getenv(self.api_key_env)
        base_url = os.getenv(self.api_base_env)
        if not api_key or not base_url:
            return None

        candidate_urls: list[str] = []
        for query in queries[:3]:
            url = f"{base_url.rstrip('/')}/ratings/search"
            try:
                response = self._get(url, params={"q": query}, api_key=api_key)
                status = self._response_access_status(response.status_code, response.text)
                if status:
                    return self._empty_result(
                        company_name,
                        queries,
                        candidate_urls,
                        status,
                        fetched_at,
                        url,
                        f"{status}: official API returned HTTP {response.status_code}",
                    )
                data = response.json()
                candidates = self._json_candidates(data, base_url)
                candidate_urls.extend(item["url"] for item in candidates if item.get("url"))
                result = self._best_candidate_result(
                    company_name,
                    queries,
                    candidates,
                    candidate_urls,
                    fetched_at,
                    mode="official_api",
                )
                if result.status != "NO_MATCH":
                    return result
            except Exception as exc:  # noqa: BLE001
                return self._empty_result(
                    company_name,
                    queries,
                    candidate_urls,
                    "PARSE_ERROR",
                    fetched_at,
                    base_url,
                    f"API_ERROR: {type(exc).__name__}: {exc}",
                )
        return None

    def _public_fallback_search(
        self, company_name: str, queries: list[str], fetched_at: str
    ) -> RatingResult:
        candidate_urls: list[str] = []
        candidates: list[dict[str, str]] = []
        last_error: str | None = None
        last_search_url: str | None = None

        for query in queries[:4]:
            for url in self._public_search_urls(query):
                try:
                    response = self._get(url)
                    text = response.text
                    last_search_url = str(response.url)
                    raw_path = self.save_raw(url, text)
                    status = self._response_access_status(response.status_code, text)
                    if status:
                        return self._empty_result(
                            company_name,
                            queries,
                            candidate_urls,
                            status,
                            fetched_at,
                            last_search_url,
                            self._access_error_message(
                                status, response.status_code, text, "public search"
                            ),
                        )
                    page_candidates = self._extract_candidates(str(response.url), text)
                    if (
                        not page_candidates
                        and fuzzy_match_company(company_name, text[:3000]) >= 0.75
                    ):
                        page_candidates = [
                            {
                                "url": str(response.url),
                                "title": _html_title(text) or str(response.url),
                                "text": _clean_text(text)[:4000],
                                "raw_path": str(raw_path),
                            }
                        ]
                    candidates.extend(page_candidates)
                    candidate_urls.extend(item["url"] for item in page_candidates)
                    if candidates:
                        break
                except Exception as exc:  # noqa: BLE001
                    last_error = f"{type(exc).__name__}: {exc}"
                if candidates:
                    break
            if candidates:
                break

        if not candidates:
            return self._empty_result(
                company_name,
                queries,
                candidate_urls,
                "NO_MATCH",
                fetched_at,
                last_search_url or (self.urls[0] if self.urls else None),
                last_error
                or (
                    "NO_MATCH: public search loaded but exposed no company/rating candidate "
                    "URL in server HTML; open source_url for manual control."
                ),
            )

        return self._best_candidate_result(
            company_name,
            queries,
            candidates,
            candidate_urls,
            fetched_at,
            mode="public_fallback",
        )

    def _best_candidate_result(
        self,
        company_name: str,
        queries: list[str],
        candidates: list[dict[str, str]],
        candidate_urls: list[str],
        fetched_at: str,
        *,
        mode: str,
    ) -> RatingResult:
        ranked = sorted(
            candidates,
            key=lambda item: fuzzy_match_company(
                company_name, f"{item.get('title', '')} {item.get('text', '')}"
            ),
            reverse=True,
        )
        best = ranked[0] if ranked else {}
        best_text = f"{best.get('title', '')}\n{best.get('text', '')}".strip()
        confidence = fuzzy_match_company(company_name, best_text)
        source_url = best.get("url")
        if confidence < 0.75:
            return self._empty_result(
                company_name,
                queries,
                candidate_urls,
                "NO_MATCH",
                fetched_at,
                source_url,
                f"LOW_CONFIDENCE: best_match_score={confidence:.2f}",
            )

        page_text = best_text
        if source_url and mode == "public_fallback":
            try:
                response = self._get(source_url)
                status = self._response_access_status(response.status_code, response.text)
                if status:
                    return self._empty_result(
                        company_name,
                        queries,
                        candidate_urls,
                        status,
                        fetched_at,
                        source_url,
                        self._access_error_message(
                            status, response.status_code, response.text, "candidate page"
                        ),
                    )
                self.save_raw(source_url, response.text)
                page_text = _clean_text(
                    BeautifulSoup(response.text, "lxml").get_text(" ", strip=True)
                )
            except Exception as exc:  # noqa: BLE001
                return self._empty_result(
                    company_name,
                    queries,
                    candidate_urls,
                    "PARSE_ERROR",
                    fetched_at,
                    source_url,
                    f"CANDIDATE_FETCH_ERROR: {type(exc).__name__}: {exc}",
                )

        parsed = parse_rating_from_text(page_text, self.source_name)
        outlook = parse_outlook_from_text(page_text)
        rating_date = parse_rating_date_from_text(page_text)
        has_rating_token = (
            parsed["long_term_rating"]
            or parsed["short_term_rating"]
            or parsed["national_rating"]
        )
        if not has_rating_token:
            return self._empty_result(
                company_name,
                queries,
                candidate_urls,
                "PARSE_ERROR",
                fetched_at,
                source_url,
                "PARSE_ERROR: official candidate matched but no rating token was parsed",
                confidence=confidence,
                matched_name=best.get("title"),
                raw_text=page_text[:3000],
            )

        return RatingResult(
            companyName=company_name,
            agency=self.source_name,
            matchedName=best.get("title"),
            ratingDate=rating_date,
            longTermRating=parsed["long_term_rating"],
            shortTermRating=parsed["short_term_rating"],
            nationalRating=parsed["national_rating"],
            outlook=outlook,
            sourceUrl=source_url,
            status="FOUND",
            confidence=confidence,
            rawText=page_text[:3000],
            fetchedAt=fetched_at,
            searchQueries=queries,
            candidateUrls=_unique(candidate_urls),
        )

    def _result_to_record(self, result: RatingResult) -> RatingRecord:
        extracted_at = _parse_datetime(result.fetchedAt) or datetime.now(UTC)
        rating_date = parse_date(result.ratingDate)
        status = result.status if result.status in RATING_STATUSES else "PARSE_ERROR"
        return RatingRecord(
            company_name_raw=result.companyName,
            company_name_normalized=normalize_company_name(result.companyName),
            company_aliases=aliases_for_company(result.companyName),
            source_agency=self.source_name,
            source_url=result.sourceUrl or (self.urls[0] if self.urls else ""),
            matched_name=result.matchedName,
            sector_raw=result.sector,
            sector_normalized=normalize_sector(result.sector),
            rating_date=rating_date,
            long_term_rating_raw=clean_rating(result.longTermRating),
            short_term_rating_raw=clean_rating(result.shortTermRating),
            national_rating_raw=clean_rating(result.nationalRating),
            outlook_raw=result.outlook,
            outlook_normalized=normalize_outlook(result.outlook),
            action_type_raw=result.action,
            action_type_normalized=normalize_action(result.action),
            rating_scale="Global" if status == "FOUND" else None,
            country_or_national_scale="Global" if status == "FOUND" else None,
            notes=result.errorMessage,
            provider_status=status,  # type: ignore[arg-type]
            match_confidence=result.confidence,
            raw_text=result.rawText,
            raw_payload={
                "searchQueries": result.searchQueries,
                "candidateUrls": result.candidateUrls,
            },
            error_message=result.errorMessage,
            fetched_at=extracted_at,
            extraction_confidence=result.confidence,
            extracted_at=extracted_at,
        )

    def _extract_candidates(self, page_url: str, html: str) -> list[dict[str, str]]:
        soup = BeautifulSoup(html, "lxml")
        candidates: list[dict[str, str]] = []
        for anchor in soup.find_all("a", href=True):
            href = urljoin(page_url, str(anchor["href"]))
            title = _clean_text(anchor.get_text(" ", strip=True))
            parent_text = _clean_text(
                anchor.parent.get_text(" ", strip=True) if anchor.parent else ""
            )
            if not title and not parent_text:
                continue
            if not self._is_candidate_url(href, title, parent_text):
                continue
            candidates.append({"url": href, "title": title or href, "text": parent_text})
        return _dedupe_candidates(candidates)[:12]

    def _json_candidates(self, data: Any, base_url: str) -> list[dict[str, str]]:
        candidates: list[dict[str, str]] = []
        for item in _walk_json_objects(data):
            text = _clean_text(json.dumps(item, ensure_ascii=False))
            title = str(
                item.get("name")
                or item.get("title")
                or item.get("issuerName")
                or item.get("entityName")
                or ""
            )
            raw_url = str(item.get("url") or item.get("link") or item.get("href") or "")
            url = urljoin(base_url, raw_url) if raw_url else base_url
            if self._is_candidate_url(url, title, text):
                candidates.append({"url": url, "title": title or url, "text": text})
        return _dedupe_candidates(candidates)[:20]

    def _public_search_urls(self, query: str) -> list[str]:
        encoded = quote_plus(query)
        return [template.format(q=encoded) for template in self.public_search_templates]

    def _get(
        self,
        url: str,
        *,
        params: dict[str, str] | None = None,
        api_key: str | None = None,
    ) -> httpx.Response:
        headers = {
            "User-Agent": self.settings.user_agent,
            "Accept": "text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with httpx.Client(
                    headers=headers,
                    timeout=self.settings.global_provider_timeout_seconds,
                    follow_redirects=True,
                ) as client:
                    response = client.get(url, params=params)
                return response
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt >= 2:
                    raise
                time.sleep(1.0)
            finally:
                time.sleep(max(0.0, self.settings.global_provider_rate_limit_seconds))
        raise RuntimeError(str(last_error))

    def _response_access_status(self, status_code: int, text: str) -> ProviderStatus | None:
        lowered = text[:5000].lower()
        if status_code in {401}:
            return "LOGIN_REQUIRED"
        if status_code in {402}:
            return "SUBSCRIPTION_REQUIRED"
        if status_code in {403, 429}:
            return "BLOCKED"
        if status_code >= 500:
            return "BLOCKED"
        for status, patterns in ACCESS_PATTERNS.items():
            if any(pattern in lowered for pattern in patterns):
                return status
        return None

    def _is_allowed_url(self, url: str) -> bool:
        netloc = urlparse(url).netloc.lower()
        return any(
            netloc == domain or netloc.endswith(f".{domain}")
            for domain in self.allowed_domains
        )

    def _is_candidate_url(self, url: str, title: str = "", text: str = "") -> bool:
        if not self._is_allowed_url(url) or _is_low_value_url(url):
            return False
        parsed = urlparse(url)
        path = parsed.path.lower()
        if self.candidate_path_keywords and not any(
            keyword in path for keyword in self.candidate_path_keywords
        ):
            return False
        label_key = normalize_text_key(title)
        if label_key in GENERIC_LINK_LABELS:
            return False
        if not label_key and not normalize_text_key(text):
            return False
        return True

    def _access_error_message(
        self,
        status: ProviderStatus,
        status_code: int,
        text: str,
        context: str,
    ) -> str:
        lowered = text[:5000].lower()
        if status == "BLOCKED" and "cloudflare" in lowered:
            return f"BLOCKED: {context} returned HTTP {status_code}; Cloudflare/security page."
        if status == "LOGIN_REQUIRED":
            return f"LOGIN_REQUIRED: {context} returned HTTP {status_code} or login wall."
        if status == "SUBSCRIPTION_REQUIRED":
            return (
                f"SUBSCRIPTION_REQUIRED: {context} returned HTTP {status_code} "
                "or entitlement wall."
            )
        return f"{status}: {context} returned HTTP {status_code}."

    def _empty_result(
        self,
        company_name: str,
        queries: list[str],
        candidate_urls: list[str],
        status: ProviderStatus,
        fetched_at: str,
        source_url: str | None,
        error: str,
        *,
        confidence: float = 0.0,
        matched_name: str | None = None,
        raw_text: str | None = None,
    ) -> RatingResult:
        return RatingResult(
            companyName=company_name,
            agency=self.source_name,
            matchedName=matched_name,
            sourceUrl=source_url,
            status=status,
            confidence=confidence,
            rawText=raw_text,
            errorMessage=error,
            fetchedAt=fetched_at,
            searchQueries=queries,
            candidateUrls=_unique(candidate_urls),
        )

    def _debug_log_line(self, result: RatingResult) -> str:
        return (
            f"[{self.source_name}] originalName={result.companyName}; "
            f"normalizedName={normalize_company_name_for_search(result.companyName)}; "
            f"searchQueries={result.searchQueries}; "
            f"candidateUrls={result.candidateUrls[:6]}; "
            f"matchScore={result.confidence:.2f}; "
            f"finalStatus={result.status}; "
            f"errorMessage={result.errorMessage or ''}"
        )

    @staticmethod
    def _run_status(statuses: list[str]) -> str:
        if not statuses:
            return "skipped"
        found = sum(1 for status in statuses if status == "FOUND")
        if found and found == len(statuses):
            return "success"
        if found:
            return "partial"
        if all(
            status in {"LOGIN_REQUIRED", "BLOCKED", "SUBSCRIPTION_REQUIRED"}
            for status in statuses
        ):
            return "error"
        return "success"


class FitchRatingsProvider(BaseGlobalRatingsProvider):
    source_key = "fitch"
    source_name = "Fitch Ratings"
    agency_name = "Fitch Ratings"
    api_key_env = "FITCH_API_KEY"
    api_base_env = "FITCH_BASE_URL"
    allowed_domains = ("fitchratings.com",)
    candidate_path_keywords = (
        "/entity/",
        "/research/",
        "/rating-action-commentary/",
    )
    public_search_templates = (
        "https://www.fitchratings.com/search?query={q}",
        "https://www.fitchratings.com/search?q={q}",
    )


class SPGlobalRatingsProvider(BaseGlobalRatingsProvider):
    source_key = "spglobal"
    source_name = "S&P Global Ratings"
    agency_name = "S&P Global Ratings"
    api_key_env = "SPGLOBAL_API_KEY"
    api_base_env = "SPGLOBAL_BASE_URL"
    allowed_domains = ("spglobal.com",)
    candidate_path_keywords = (
        "/ratings/en/research/articles/",
        "/ratings/en/regulatory/article/",
        "/ratings/en/regulatory/entity/",
        "/ratings/en/regulatory/ratings-actions/",
    )
    public_search_templates = (
        "https://www.spglobal.com/ratings/en/search?query={q}",
        "https://www.spglobal.com/ratings/en/search?q={q}",
    )


class MoodysRatingsProvider(BaseGlobalRatingsProvider):
    source_key = "moodys"
    source_name = "Moody's Ratings"
    agency_name = "Moody's Ratings"
    api_key_env = "MOODYS_API_KEY"
    api_base_env = "MOODYS_BASE_URL"
    allowed_domains = ("moodys.com", "ratings.moodys.com")
    candidate_path_keywords = (
        "/research/",
        "/credit-ratings/",
        "/issuer/",
        "/rating-action/",
    )
    public_search_templates = (
        "https://ratings.moodys.com/search?keyword={q}",
        "https://www.moodys.com/search?keyword={q}",
        "https://www.moodys.com/search?q={q}",
    )


def _rating_context(text: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    selected = [
        part
        for part in parts
        if re.search(
            r"rating|long-term|short-term|issuer default|senior unsecured|outlook|"
            r"national scale|foreign currency|local currency",
            part,
            flags=re.IGNORECASE,
        )
    ]
    return " ".join(selected[:80]) or text[:3000]


def _first_rating(text: str, values: list[str]) -> str | None:
    ordered = sorted(values, key=len, reverse=True)
    pattern = (
        r"(?<![A-Z0-9])("
        + "|".join(re.escape(value) for value in ordered)
        + r")(?![A-Z0-9+\-])"
    )
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(1).upper() if match else None


def _parse_national_rating(text: str) -> str | None:
    patterns = [
        r"\b(?:TR|TUR)\s*(AAA|AA\+|AA-|AA|A\+|A-|A|BBB\+|BBB-|BBB|BB\+|BB-|BB|B\+|B-|B)\b",
        r"\b(AAA|AA\+|AA-|AA|A\+|A-|A|BBB\+|BBB-|BBB|BB\+|BB-|BB|B\+|B-|B)\s*\(tr\)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(0).upper()
    return None


def _clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def _html_title(html: str) -> str | None:
    soup = BeautifulSoup(html, "lxml")
    if soup.title and soup.title.string:
        return _clean_text(soup.title.string)
    heading = soup.find(["h1", "h2"])
    return _clean_text(heading.get_text(" ", strip=True)) if heading else None


def _dedupe_candidates(candidates: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    output: list[dict[str, str]] = []
    for item in candidates:
        url = item.get("url", "").split("#", 1)[0]
        if not url or url in seen:
            continue
        seen.add(url)
        output.append({**item, "url": url})
    return output


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        output.append(value)
    return output


def _is_low_value_url(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower().rstrip("/") or "/"
    root_paths = {
        "/",
        "/en",
        "/ratings",
        "/ratings/ar",
        "/ratings/en",
        "/ratings/es",
        "/ratings/jp",
        "/ratings/pt",
        "/ratings/ru",
        "/ratings/zh",
    }
    if path in root_paths:
        return True
    blocked_prefixes = [
        "/login",
        "/contact",
        "/policies",
        "/privacy",
        "/terms",
        "/events",
        "/about",
        "/careers",
        "/ratings/en/contact",
        "/ratings/en/contact-us",
    ]
    return any(path.startswith(item) for item in blocked_prefixes)


def _walk_json_objects(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        found.append(value)
        for child in value.values():
            found.extend(_walk_json_objects(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(_walk_json_objects(child))
    return found


def _parse_datetime(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None
