from __future__ import annotations

from .base import GenericTableRatingScraper


class TurkRatingScraper(GenericTableRatingScraper):
    source_key = "turkrating"
    source_name = "TurkRating"
