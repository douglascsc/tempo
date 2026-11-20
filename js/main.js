// ===================== Inicialização =====================
async function refresh() {
  loadRadar();
  loadRiver();
  try {
    await loadForecast();
    renderCards();
    renderChart();
    runNowcast().then(renderCards);
    document.getElementById("updated").textContent = "Atualizado às " + hhmm(new Date());
  } catch (e) {
    document.getElementById("updated").textContent = "Erro ao buscar previsão: " + e.message;
  }
}

if (!CITIES.some(c => c.id === selected)) selected = CITIES[0].id;
buildMarkers();
// no celular o radar já abre aproximado em Campo Bom + Sapucaia
if (IS_PHONE) document.getElementById("zoom").value = 4; // zoom máximo
applyZoom();
document.getElementById("radarImg").addEventListener("load", () => IS_PHONE && applyZoom(), { once: true });
addEventListener("resize", () => IS_PHONE && applyZoom());
refresh();
setSource(src === "rv" ? "rv" : "ct");
setPlaying(true);
setInterval(refresh, REFRESH_MS);
