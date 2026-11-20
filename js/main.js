// ===================== Inicialização =====================
let lastOk = null;      // horário da última atualização da previsão que deu certo
let lastRefresh = 0;

async function refresh() {
  lastRefresh = Date.now();
  loadRadar();
  loadRiver();
  const st = document.getElementById("updated");
  try {
    await loadForecast();
    renderCards();
    renderChart();
    syncCarousels(null, "auto");
    runNowcast().then(() => { renderCards(); });
    lastOk = new Date();
    st.className = "muted";
    st.textContent = "Atualizado às " + hhmm(lastOk);
  } catch (e) {
    // erro: avisa se os dados na tela estão velhos e oferece tentar de novo
    st.className = "stale-msg";
    st.innerHTML = (lastOk ? `⚠️ Sem atualização desde ${hhmm(lastOk)} (${agoTxt(lastOk)})` : `⚠️ Não foi possível buscar a previsão`) +
      ` <button class="linkbtn" onclick="refresh()">Tentar de novo</button>`;
    console.error(e);
  }
}

if (!CITIES.some(c => c.id === selected)) selected = CITIES[0].id;
renderCitySel();
buildMarkers();
// no celular o radar já abre aproximado em Campo Bom + Sapucaia
if (IS_PHONE) document.getElementById("zoom").value = 4; // zoom máximo
applyZoom();
document.getElementById("radarImg").addEventListener("load", () => IS_PHONE && applyZoom(), { once: true });
let resizeT;
addEventListener("resize", () => {
  if (IS_PHONE) applyZoom();
  clearTimeout(resizeT); resizeT = setTimeout(renderChart, 200); // gráfico acompanha a largura da tela
});
watchCarousel(document.getElementById("cards"));
watchCarousel(document.getElementById("details"));
refresh();
setSource(src === "rv" ? "rv" : "ct");
// quem pediu ao sistema "reduzir movimento" recebe o radar parado no quadro mais recente
setPlaying(!REDUCED_MOTION);

// Atualiza a cada 5 min, mas não com a aba em segundo plano (economiza dados e bateria).
// Ao voltar para a aba, atualiza na hora se já passou do tempo.
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastRefresh > REFRESH_MS) refresh();
});
