from __future__ import annotations

from pathlib import Path

from app.scrapers.base import FetchedPage
from app.scrapers.turkrating import TurkRatingScraper
from app.services.ratings import filter_ratings, latest_ratings

SAMPLE_HTML = """
<html>
  <body>
    <table>
      <tr>
        <th>Firma</th><th>Tarih</th><th>U.V.D</th><th>K.V.D</th>
        <th>Görünüm</th><th>Sektör</th><th>Açıklama</th><th>Rapor</th>
      </tr>
      <tr>
        <td>Gelecek Varlık Yönetim A.Ş.</td><td>12.05.2025</td><td>TR A-</td><td>TR A1</td>
        <td>Durağan</td><td>Varlık Yönetim Şirketleri</td><td>Güncelleme</td>
        <td><a href="/rapor.pdf">Rapor</a></td>
      </tr>
      <tr>
        <td>A1 Capital Yatırım Menkul Değerler A.Ş.</td><td>01.04.2025</td>
        <td>TR BBB+</td><td>TR A2</td>
        <td>Pozitif</td><td>Aracı Kurum</td><td>İlk Kez</td><td></td>
      </tr>
    </table>
  </body>
</html>
"""


def test_turkrating_sample_html_parsing(tmp_path):
    scraper = TurkRatingScraper(urls=[])
    page = FetchedPage(
        url="https://turkrating.com/test",
        content=SAMPLE_HTML,
        raw_path=Path(tmp_path / "sample.html"),
    )
    rows = scraper.parse([page])
    records = scraper.normalize(rows)

    assert len(records) == 2
    gelecek = records[0]
    assert gelecek.company_name_normalized == "Gelecek Varlık Yönetim"
    assert gelecek.sector_normalized == "Varlık Yönetim"
    assert gelecek.long_term_rating_raw == "TR A-"
    assert gelecek.short_term_rating_raw == "TR A1"
    assert gelecek.outlook_normalized == "Durağan"


def test_sector_filtering_and_latest_selection():
    scraper = TurkRatingScraper(urls=[])
    page = FetchedPage(url="https://turkrating.com/test", content=SAMPLE_HTML, raw_path=Path("x"))
    records = scraper.normalize(scraper.parse([page]))

    sector_records = filter_ratings(sector="Varlık Yönetim", records=records)
    latest = latest_ratings(records)

    assert len(sector_records) == 1
    assert sector_records[0].company_name_normalized == "Gelecek Varlık Yönetim"
    assert len(latest) == 2
