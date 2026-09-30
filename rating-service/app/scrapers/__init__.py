"""Source adapters for rating and news data."""

from .jcr import JCRScraper
from .kobirate import KobiRateScraper
from .news import NewsScraper
from .saha import SAHAScraper
from .turkrating import TurkRatingScraper

__all__ = [
    "JCRScraper",
    "KobiRateScraper",
    "NewsScraper",
    "SAHAScraper",
    "TurkRatingScraper",
]
