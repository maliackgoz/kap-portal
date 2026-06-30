const statusNode = document.querySelector("#refresh-status");
const ratingsBody = document.querySelector("#ratings-body");
const ratingCount = document.querySelector("#rating-count");

document.querySelectorAll("[data-source]").forEach((button) => {
  button.addEventListener("click", async () => {
    const source = button.dataset.source;
    const label = button.dataset.sourceLabel || source;
    statusNode.textContent = `${label} güncelleniyor...`;
    button.disabled = true;
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: [source], force: true }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Yenileme başarısız.");
      }
      statusNode.textContent = `${payload.summary || "Yenileme tamamlandı."} Sayfa yenileniyor...`;
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      statusNode.textContent = `Yenileme hatası: ${error}`;
      button.disabled = false;
    } finally {
      if (!statusNode.textContent.includes("Sayfa yenileniyor")) {
        button.disabled = false;
      }
    }
  });
});

document.querySelector("#apply-filters")?.addEventListener("click", loadRatings);

async function loadRatings() {
  const params = new URLSearchParams();
  const company = document.querySelector("#company-filter").value.trim();
  const sector = document.querySelector("#sector-filter").value.trim();
  const agency = document.querySelector("#agency-filter").value.trim();
  const latestOnly = document.querySelector("#latest-filter").checked;
  if (company) params.set("company", company);
  if (sector) params.set("sector", sector);
  if (agency) params.set("agency", agency);
  params.set("latest_only", String(latestOnly));

  const response = await fetch(`/api/ratings?${params.toString()}`);
  const payload = await response.json();
  renderRatings(payload.data || []);
}

function renderRatings(rows) {
  ratingCount.textContent = `${rows.length} kayıt`;
  ratingsBody.innerHTML = "";
  if (!rows.length) {
    ratingsBody.innerHTML = `<tr class="empty-row"><td colspan="9">Kayıt bulunamadı.</td></tr>`;
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.company || "")}</td>
      <td>${escapeHtml(row.agency || "")}</td>
      <td>${escapeHtml(row.rating_date || "")}</td>
      <td>${escapeHtml(row.long_term_rating || "")}</td>
      <td>${escapeHtml(row.short_term_rating || "")}</td>
      <td>${escapeHtml(row.outlook || "")}</td>
      <td>${escapeHtml(row.sector || "")}</td>
      <td>${escapeHtml(row.action || "")}</td>
      <td>${sourceLink(row)}</td>
    `;
    ratingsBody.appendChild(tr);
  }
}

function sourceLink(row) {
  const url = row.report_url || row.source_url;
  if (!url) return "";
  const label = row.report_url ? "Rapor" : "Liste";
  return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${label}</a>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
