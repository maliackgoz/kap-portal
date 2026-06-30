from __future__ import annotations

from .base import GenericTableRatingScraper


class SAHAScraper(GenericTableRatingScraper):
    source_key = "saha"
    source_name = "SAHA Rating"
