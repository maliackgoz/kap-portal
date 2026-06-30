from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings sourced from environment variables."""

    model_config = SettingsConfigDict(env_prefix="RATING_MCP_", env_file=".env", extra="ignore")

    data_dir: Path = Field(default=Path("data"))
    api_key: str | None = None
    user_agent: str = "RatingMCP/0.1 (+local financial analysis team)"
    timeout_seconds: float = 15.0
    rate_limit_seconds: float = 1.0
    global_provider_timeout_seconds: float = 20.0
    global_provider_rate_limit_seconds: float = 1.0
    global_provider_max_companies: int = 80
    max_pdf_downloads_per_page: int = 5

    @property
    def ratings_path(self) -> Path:
        return self.data_dir / "ratings.jsonl"

    @property
    def news_path(self) -> Path:
        return self.data_dir / "news.jsonl"

    @property
    def run_log_path(self) -> Path:
        return self.data_dir / "run_log.jsonl"

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def pdf_dir(self) -> Path:
        return self.data_dir / "pdfs"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def imports_dir(self) -> Path:
        return self.data_dir / "imports"

    @property
    def config_dir(self) -> Path:
        return self.data_dir / "config"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    ensure_data_dirs(settings)
    return settings


def ensure_data_dirs(settings: Settings | None = None) -> None:
    settings = settings or Settings()
    for path in [
        settings.data_dir,
        settings.config_dir,
        settings.raw_dir,
        settings.pdf_dir,
        settings.exports_dir,
        settings.imports_dir,
    ]:
        path.mkdir(parents=True, exist_ok=True)
    for path in [settings.ratings_path, settings.news_path, settings.run_log_path]:
        path.touch(exist_ok=True)
    seed_config_files(settings)


def seed_config_files(settings: Settings) -> None:
    default_config_dir = Path(__file__).parent / "default_config"
    if not default_config_dir.exists():
        return
    for filename in ["sources.yaml", "companies.yaml"]:
        source = default_config_dir / filename
        target = settings.config_dir / filename
        if not source.exists():
            continue
        if target.exists() and target.stat().st_size > 0:
            continue
        shutil.copyfile(source, target)


def load_yaml(path: Path, default: Any | None = None) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or default


def load_sources_config(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    return load_yaml(settings.config_dir / "sources.yaml", default={}) or {}


def load_companies_config(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    return load_yaml(settings.config_dir / "companies.yaml", default={"companies": []}) or {
        "companies": []
    }


def env_truthy(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}
