from __future__ import annotations

from app.normalizer import (
    clean_company_suffix,
    normalize_action,
    normalize_company_name,
    normalize_outlook,
    normalize_sector,
)


def test_company_suffix_and_alias_normalization():
    assert clean_company_suffix("A1 Capital Yatırım Menkul Değerler A.Ş.") == (
        "A1 Capital Yatırım Menkul Değerler"
    )
    assert normalize_company_name("A1 Capital") == "A1 Capital Yatırım Menkul Değerler"


def test_outlook_action_sector_normalization():
    assert normalize_outlook("Stable") == "Durağan"
    assert normalize_outlook("Negatif") == "Negatif"
    assert normalize_action("Surveillance Review") == "Güncelleme"
    assert normalize_action("Downgrade") == "Not Düşürümü"
    assert normalize_sector("Varlık Yönetim Şirketleri") == "Varlık Yönetim"
