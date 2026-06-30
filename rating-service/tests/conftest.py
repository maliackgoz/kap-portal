from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def clear_global_caches():
    from app.config import get_settings
    from app.normalizer import alias_map

    get_settings.cache_clear()
    alias_map.cache_clear()
    yield
    get_settings.cache_clear()
    alias_map.cache_clear()
