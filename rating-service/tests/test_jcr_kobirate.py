from __future__ import annotations

from pathlib import Path

from app.scrapers.base import FetchedPage
from app.scrapers.jcr import JCRScraper
from app.scrapers.kobirate import KobiRateScraper


def test_jcr_table_parser_extracts_long_short_rows() -> None:
    html = """
    <table>
      <tr><th>DERECELENDIRILEN KURULUS</th></tr>
      <tr>
        <td>Ornek Finansman A.S.</td><td>UZUN VADE</td><td>BB</td><td>BB</td>
        <td>Stable</td><td>AA (tr)</td><td>Stable</td><td></td><td></td>
        <td>12.05.2026</td><td>Faktoring</td>
        <td><a href="/tr/report?documentId=abc">Rapor</a></td>
      </tr>
      <tr>
        <td></td><td>KISA VADE</td><td></td><td></td><td>J1 (tr)</td>
        <td>Stable</td><td></td><td></td>
      </tr>
    </table>
    """
    page = FetchedPage(
        url="https://www.jcrer.com.tr/tr/derecelendirme/raporlar/kredi-derecelendirme",
        content=html,
        raw_path=Path("sample.html"),
    )

    scraper = JCRScraper(urls=[])
    rows = scraper.parse([page])
    records = scraper.normalize(rows)

    assert len(records) == 1
    assert records[0].company_name_raw == "Ornek Finansman A.S."
    assert records[0].long_term_rating_raw == "AA (tr)"
    assert records[0].short_term_rating_raw == "J1 (tr)"
    assert records[0].outlook_normalized == "Durağan"
    assert records[0].sector_normalized == "Faktoring"
    assert records[0].report_url == "https://www.jcrer.com.tr/tr/report?documentId=abc"


def test_jcr_parser_skips_rows_without_rating_values() -> None:
    html = """
    <table>
      <tr>
        <td>Ornek Menkul A.S.</td><td>UZUN VADE</td><td></td><td></td>
        <td></td><td></td><td></td><td></td><td></td>
        <td>15.06.2026</td><td>Araci Kurum</td>
        <td><a href="/tr/report?documentId=empty">Rapor</a></td>
      </tr>
      <tr>
        <td></td><td>KISA VADE</td><td></td><td></td><td></td>
        <td></td><td></td><td></td>
      </tr>
    </table>
    """
    page = FetchedPage(
        url="https://www.jcrer.com.tr/tr/derecelendirme/raporlar/kredi-derecelendirme",
        content=html,
        raw_path=Path("sample.html"),
    )

    scraper = JCRScraper(urls=[])
    rows = scraper.parse([page])
    records = scraper.normalize(rows)

    assert rows
    assert records == []


def test_kobirate_detail_parser_extracts_rating_history() -> None:
    html = """
    <table>
      <tr><td>Şirket Ünvanı</td><td>:</td><td>DENIZ FAKTORING A.S.</td></tr>
      <tr><td>Sektörü</td><td>:</td><td>Faktoring Şirketleri</td></tr>
    </table>
    <table>
      <tr><td>Derecelendirme Rapor Tarihi</td><td>:</td><td>25.05.2026</td></tr>
      <tr><td>Geçerlilik Tarihi</td><td>:</td><td>25.05.2026 - 25.05.2027</td></tr>
      <tr><td>Uzun Vadeli Derecelendirme Notu</td><td>:</td><td>KR AAA</td></tr>
      <tr><td>Kısa Vadeli Derecelendirme Notu</td><td>:</td><td>KR-1</td></tr>
      <tr><td>Görünümü</td><td>:</td><td>DURAĞAN</td></tr>
    </table>
    <table>
      <tr><td>Derecelendirme Rapor Tarihi</td><td>:</td><td>29.05.2025</td></tr>
      <tr><td>Geçerlilik Tarihi</td><td>:</td><td>29.05.2025 - 29.05.2026</td></tr>
      <tr><td>Uzun Vadeli Derecelendirme Notu</td><td>:</td><td>KR AA</td></tr>
      <tr><td>Kısa Vadeli Derecelendirme Notu</td><td>:</td><td>KR A-1</td></tr>
      <tr><td>Görünümü</td><td>:</td><td>Stable</td></tr>
    </table>
    """
    page = FetchedPage(
        url="https://www.kobirate.com.tr/Kredi-Derecelendirme-Raporlari/detay.aspx?id=4311",
        content=html,
        raw_path=Path("sample.html"),
    )

    scraper = KobiRateScraper(urls=[])
    rows = scraper.parse([page])
    records = scraper.normalize(rows)

    assert len(records) == 2
    assert records[0].company_name_raw == "DENIZ FAKTORING A.S."
    assert records[0].long_term_rating_raw == "KR AAA"
    assert records[0].short_term_rating_raw == "KR-1"
    assert records[0].valid_until and records[0].valid_until.isoformat() == "2027-05-25"
    assert records[1].long_term_rating_raw == "KR AA"
    assert records[1].outlook_normalized == "Durağan"
