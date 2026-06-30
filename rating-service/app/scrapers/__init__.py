"""Source adapters for rating and news data."""

from .fitch import FitchScraper
from .global_providers import FitchRatingsProvider, MoodysRatingsProvider, SPGlobalRatingsProvider
from .jcr import JCRScraper
from .kobirate import KobiRateScraper
from .moodys import MoodysScraper
from .news import NewsScraper
from .saha import SAHAScraper
from .spglobal import SPGlobalScraper
from .turkrating import TurkRatingScraper

__all__ = [
    "FitchScraper",
    "FitchRatingsProvider",
    "JCRScraper",
    "KobiRateScraper",
    "MoodysScraper",
    "MoodysRatingsProvider",
    "NewsScraper",
    "SAHAScraper",
    "SPGlobalScraper",
    "SPGlobalRatingsProvider",
    "TurkRatingScraper",
]
