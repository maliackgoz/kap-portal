from __future__ import annotations

from pathlib import Path

from app.scrapers.base import FetchedPage
from app.scrapers.saha import SAHAScraper

SAHA_SAMPLE_HTML = """
<html>
  <body>
    <table>
      <tr>
        <th>Firma</th>
        <th>Ulusal Uzun Vadeli</th>
        <th>Görünüm</th>
        <th>Ulusal Kısa Vadeli</th>
        <th>Görünüm</th>
        <th>Tarih</th>
        <th>Doküman</th>
      </tr>
      <tr>
        <td>Q Finans Faktoring A.Ş.</td>
        <td>(TR) A-</td>
        <td>Stabil</td>
        <td>(TR) A2</td>
        <td>Stabil</td>
        <td>17.04.2026</td>
        <td><a href="/qfinf.pdf">İncele</a></td>
      </tr>
    </table>
  </body>
</html>
"""


def test_saha_ulusal_rating_columns_are_mapped(tmp_path):
    scraper = SAHAScraper(urls=[])
    rows = scraper.parse(
        [
            FetchedPage(
                url="https://saharating.com/rating/kredi-derecelendirme-ratingler/",
                content=SAHA_SAMPLE_HTML,
                raw_path=Path(tmp_path / "saha.html"),
            )
        ]
    )
    records = scraper.normalize(rows)

    assert len(records) == 1
    record = records[0]
    assert record.company_name_normalized == "Q Faktoring"
    assert record.long_term_rating_raw == "(TR) A-"
    assert record.short_term_rating_raw == "(TR) A2"
    assert record.outlook_normalized == "Durağan"
    assert record.rating_date.isoformat() == "2026-04-17"
    assert record.pdf_url == "https://saharating.com/qfinf.pdf"
