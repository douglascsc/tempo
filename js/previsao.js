// ===================== 1. Previsão =====================
async function loadForecast() {
  const params = new URLSearchParams({
    latitude: CITIES.map(c => c.lat).join(","),
    longitude: CITIES.map(c => c.lon).join(","),
    current: "temperature_2m,precipitation,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    minutely_15: "precipitation",
    hourly: "temperature_2m,precipitation,precipitation_probability,wind_gusts_10m,cape,weather_code",
    forecast_days: 5,
    timezone: "America/Sao_Paulo",
  });
  const data = await (await fetchWithTimeout("https://api.open-meteo.com/v1/forecast?" + params, 20000)).json();
  const list = Array.isArray(data) ? data : [data];
  CITIES.forEach((c, i) => forecasts[c.id] = list[i]);
}

// Frase direta: está chovendo? quando começa/para?
function summarize(f) {
  const now = Date.now();
  const m = f.minutely_15.time.map((t, i) => ({ t: parseT(t), p: f.minutely_15.precipitation[i] ?? 0 }))
    .filter(x => x.t.getTime() + 15 * 60e3 > now);
  const h = f.hourly.time.map((t, i) => ({
    t: parseT(t), p: f.hourly.precipitation[i] ?? 0, prob: f.hourly.precipitation_probability[i] ?? 0,
  })).filter(x => x.t.getTime() + 3600e3 > now);

  const next1h = m.slice(0, 4).reduce((s, x) => s + x.p, 0);
  const rainingNow = (m[0] && m[0].p >= RAIN_MIN) || (f.current.precipitation ?? 0) >= RAIN_MIN;

  if (rainingNow) {
    const stop = m.findIndex(x => x.p < RAIN_MIN);
    const until = stop > 0 && stop < 12 ? `; a previsão indica parar por volta das ${hhmm(m[stop].t)}` : "";
    return { wet: true, badge: "Possível chuva", text: `Possivelmente chovendo agora${until}.`,
      sub: `~${fmtMm(next1h)} mm previstos na próxima hora · confira no radar` };
  }
  const start = m.slice(0, 12).find(x => x.p >= RAIN_MIN); // próximas 3 h
  if (start) {
    const i = m.indexOf(start);
    const mm = m.slice(i, i + 4).reduce((s, x) => s + x.p, 0);
    return { wet: true, badge: "Chuva em breve?", text: `Pode chover a partir das ${hhmm(start.t)}.`,
      sub: `~${fmtMm(mm)} mm previstos na primeira hora` };
  }
  const later = h.slice(0, 12).find(x => x.p >= 0.2 || x.prob >= 60);
  if (later) {
    return { wet: false, badge: "Seco por ora", text: `Sem chuva prevista nas próximas 3 h.`,
      sub: `Possível chuva a partir das ${hh(later.t)} (${later.prob}%)` };
  }
  const maxProb = Math.max(0, ...h.slice(0, 12).map(x => x.prob));
  return { wet: false, badge: "Seco", text: "Sem chuva prevista nas próximas 12 h.",
    sub: `Probabilidade máxima: ${maxProb}%` };
}

// O modelo prevê chuva na próxima hora? (usado para comparar com o radar)
function modelWetNextHour(f) {
  const now = Date.now();
  const m = f.minutely_15.time.map((t, i) => ({ t: parseT(t), p: f.minutely_15.precipitation[i] ?? 0 }))
    .filter(x => x.t.getTime() + 15 * 60e3 > now).slice(0, 4);
  return m.reduce((a, x) => a + x.p, 0) >= 0.3;
}

// Radar (o que existe agora) x modelo (simulação). Para a próxima hora vale o radar;
// quando os dois discordam, a página avisa em vez de mostrar duas respostas diferentes.
function confidence(n, f) {
  if (!n || n.error) return null;
  const radarWet = n.firstMin != null, modelWet = modelWetNextHour(f);
  if (radarWet === modelWet) return { ok: true, txt: `${uIcon("check")} radar e previsão do modelo concordam` };
  return { ok: false, txt: radarWet
    ? `${uIcon("alert")} O radar vê chuva chegando, mas o modelo não previa: confiança média`
    : `${uIcon("alert")} O modelo previa chuva, mas o radar não vê chuva por perto: confiança baixa` };
}

// ===================== Alerta de temporal =====================
// Olha as próximas 12 h: trovoada (código 95–99), rajadas fortes e instabilidade (CAPE)
function stormAlert(f) {
  const now = Date.now();
  const h = f.hourly.time.map((t, i) => ({
    t: parseT(t), gust: f.hourly.wind_gusts_10m[i] ?? 0, cape: f.hourly.cape[i] ?? 0,
    code: f.hourly.weather_code[i] ?? 0, prob: f.hourly.precipitation_probability[i] ?? 0,
  })).filter(x => x.t.getTime() + 3600e3 > now).slice(0, 12);
  if (!h.length) return null;

  const items = [];
  let level = 0; // 0 nada, 1 atenção, 2 forte
  const thunder = h.find(x => x.code >= 95);
  if (thunder) { items.push(`${wIcon("storm", "w-in")} Possível trovoada a partir das ${hh(thunder.t)}`); level = Math.max(level, 1); }
  const g = h.reduce((a, b) => (b.gust > a.gust ? b : a));
  if (g.gust >= 60) {
    items.push(`${uIcon("wind")} Rajadas de até ${Math.round(g.gust)} km/h por volta das ${hh(g.t)}`);
    level = Math.max(level, g.gust >= 80 ? 2 : 1);
  }
  const c = h.reduce((a, b) => (b.cape > a.cape ? b : a));
  if (!thunder && c.cape >= 1500 && c.prob >= 40) {
    items.push(`${uIcon("bolt")} Atmosfera instável: risco de temporal por volta das ${hh(c.t)}`);
    level = Math.max(level, 1);
  }
  if (thunder && (c.cape >= 2500 || g.gust >= 80)) level = 2;
  return { level, items, maxGust: Math.round(g.gust) };
}

// ===================== Tempo agora e 5 dias =====================
// Códigos WMO usados pela Open-Meteo -> ícone e texto
function wx(code, isDay = 1) {
  if (code === 0) return [isDay ? "sun" : "moon", "Céu limpo"];
  if (code === 1) return [isDay ? "partly" : "partlyNight", "Predomínio de sol"];
  if (code === 2) return [isDay ? "partly" : "partlyNight", "Parcialmente nublado"];
  if (code === 3) return ["cloud", "Nublado"];
  if (code === 45 || code === 48) return ["fog", "Neblina"];
  if (code >= 51 && code <= 57) return ["drizzle", "Garoa"];
  if (code >= 61 && code <= 67) return ["rain", "Chuvoso"];
  if (code >= 71 && code <= 77) return ["snow", "Neve"];
  if (code >= 80 && code <= 82) return ["showers", "Pancadas de chuva"];
  if (code === 85 || code === 86) return ["snow", "Pancadas de neve"];
  if (code >= 95) return ["storm", "Tempestade"];
  return ["cloud", "—"];
}
const deg = v => `${(Math.round(v * 10) / 10).toString().replace(".", ",")}°`;

function daysHtml(f) {
  const d = f.daily;
  return `<div class="wx-days">${d.time.slice(0, 5).map((t, i) => {
    const date = new Date(t + "T12:00");
    const name = i === 0 ? "hoje" : date.toLocaleDateString("pt-BR", { weekday: "short" });
    return `<div><div class="muted">${name}</div><div class="wx-di" title="${wx(d.weather_code[i])[1]}">${wIcon(wx(d.weather_code[i])[0])}<span class="vh">${wx(d.weather_code[i])[1]}</span></div>
      <div>${deg(d.temperature_2m_max[i])}</div><div class="muted">${deg(d.temperature_2m_min[i])}</div></div>`;
  }).join("")}</div>`;
}

// ----- Bloco "próxima hora" vindo do radar -----
// Escala da Defesa Civil para o radar: azul/verde = fraca, amarelo/laranja = moderada,
// vermelho/rosa = intensa, roxo a preto = muito intensa (limites em dBZ da legenda do radar)
const INT = [ // dBZ mínimo -> rótulo e cor
  // cores tiradas da própria legenda do radar: verde (fraca), laranja (moderada), vermelho (intensa), roxo (muito intensa)
  [60, "muito intensa", "#7a1fa2"], [45, "intensa", "#d81b1b"], [30, "moderada", "#ff9800"], [15, "fraca", "#1fa34a"],
];
const intensity = dbz => INT.find(([m]) => dbz >= m) || [0, "sem chuva", "var(--line)"];

function nowcastHtml(n) {
  if (!n) return `<div class="nc"><div class="skel-line"></div><div class="skel-line short"></div><div class="nc-blocks skel-blocks"></div></div>`;
  if (n.error) return `<div class="nc muted">Radar indisponível no momento. <button class="linkbtn" onclick="refresh()">Tentar de novo</button></div>`;
  let head;
  // a imagem do radar tem alguns minutos: chuva a poucos km pode já estar chegando
  if (n.firstMin === 0 && n.nearKm != null && n.nearKm >= 2) head = `${wIcon("rain", "w-in")} <b>Chuva chegando agora</b> — ${intensity(n.firstDbz)[1]}`;
  else if (n.firstMin === 0) head = `${wIcon("rain", "w-in")} <b>Possível chuva agora</b> — ${intensity(n.firstDbz)[1]}`;
  else if (n.firstMin != null) head = `${wIcon("rain", "w-in")} <b>Possível chuva em ~${n.firstMin} min</b> — ${intensity(n.firstDbz)[1]}`;
  else head = `${wIcon("partly", "w-in")} <b>Sem sinal de chuva</b> na próxima hora`;
  const near = n.nearKm == null ? "nenhuma num raio de 120 km"
    : n.nearKm < 2 ? "sobre a cidade" : `<b>${Math.round(n.nearKm)} km</b> ao ${n.nearDir}`;
  return `<div class="nc">
    <div>${head} <span class="src">· radar</span></div>
    <div class="nc-near">Chuva mais próxima: ${near}</div>
    <div class="nc-lbl">Próxima hora em min (tendência)${radarMotion ? ` <span class="muted">· radar às ${hhmm(radarMotion.time)}</span>` : ""}:</div>
    <div class="nc-blocks">${n.blocks.map((v, i) => {
      const [, lbl, col] = intensity(v);
      return `<div><div class="muted nc-t">${i * 15}–${i * 15 + 15}</div><span class="sq" style="background:${col}"></span><div>${lbl}</div></div>`;
    }).join("")}</div></div>`;
}

function renderCards() {
  const box = document.getElementById("cards"), det = document.getElementById("details");
  const keep = [box.scrollLeft, det.scrollLeft]; // no celular os cartões deslizam: mantém a posição
  box.innerHTML = ""; det.innerHTML = "";
  CITIES.forEach(c => {
    const f = forecasts[c.id];
    if (!f) return;
    const a = stormAlert(f);
    const conf = confidence(nowcast[c.id], f);
    const [icon, cond] = wx(f.current.weather_code, f.current.is_day);
    const alertHtml = a && a.level
      ? `<div class="alert lv${a.level}">${a.level === 2 ? "<b>Risco de temporal</b><br>" : ""}${a.items.join("<br>")}</div>`
      : (a ? `<div class="sub">${uIcon("wind")} Rajadas até ${a.maxGust} km/h nas próximas 12 h</div>` : "");
    const confHtml = conf ? `<div class="conf ${conf.ok ? "ok" : "warn"}">${conf.txt}${conf.ok ? "" : ` ${infoBtn("conf-" + c.id)}
      <div id="conf-${c.id}" class="muted ${infoCls("conf-" + c.id)}">O radar mostra a chuva que existe agora; o modelo é uma simulação do tempo.
      Para a próxima hora, confie mais no radar.</div>`}</div>` : "";
    // cartões: o clique do mouse seleciona a cidade; teclado e leitor de tela usam o seletor de cidades (botões reais)
    const card = document.createElement("article");
    card.className = "card city-top" + (c.id === selected ? " active" : "");
    card.style.setProperty("--city", c.color); // borda colorida no topo identifica a cidade (mesma cor do seletor)
    card.dataset.id = c.id;
    card.innerHTML = `
      <div class="wx-head">
        <div class="wx-icon">${wIcon(icon)}</div>
        <div class="wx-name"><div class="wx-cond">${cond}</div>
          <h3 class="vh">${c.name}</h3></div>
        <div class="wx-now"><div class="wx-temp">${deg(f.current.temperature_2m)}C</div>
          <div class="muted">máx ${deg(f.daily.temperature_2m_max[0])} / mín ${deg(f.daily.temperature_2m_min[0])}</div></div>
      </div>
      ${nowcastHtml(nowcast[c.id])}
      ${confHtml}`;
    card.onclick = e => { if (!e.target.closest("button")) selectCity(c.id); };
    box.appendChild(card);
    const dc = document.createElement("article");
    dc.className = "card" + (c.id === selected ? " active" : "");
    dc.dataset.id = c.id;
    dc.innerHTML = `
      <h3 class="city"><span><span class="dot" style="background:${c.color}"></span>${c.name}</span></h3>
      ${alertHtml}
      ${daysHtml(f)}`;
    dc.onclick = e => { if (!e.target.closest("button")) selectCity(c.id); };
    det.appendChild(dc);
  });
  box.scrollLeft = keep[0]; det.scrollLeft = keep[1];
}

// ----- Seletor de cidade: controla gráfico, radar e (no celular) os dois carrosséis -----
function renderCitySel() {
  document.getElementById("citySel").innerHTML = CITIES.map(c =>
    `<button data-id="${c.id}" aria-pressed="${c.id === selected}"><span class="dot" style="background:${c.color}"></span>${c.short || c.name}</button>`).join("");
  document.querySelectorAll("#citySel button").forEach(b => b.onclick = () => selectCity(b.dataset.id));
}

// No celular: leva os carrosséis até o cartão da cidade (exceto o que a pessoa acabou de deslizar)
function syncCarousels(except, behavior = "smooth") {
  if (!IS_PHONE) return;
  const idx = CITIES.findIndex(c => c.id === selected);
  for (const el of [document.getElementById("cards"), document.getElementById("details")]) {
    if (el === except || !el.children[idx]) continue;
    el.scrollTo({ left: el.children[idx].offsetLeft - el.children[0].offsetLeft, behavior });
  }
}

// Deslizar um carrossel escolhe a cidade que ficou na tela e alinha o outro carrossel
function watchCarousel(el) {
  let t;
  el.addEventListener("scroll", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!el.children.length || el.querySelector(".skel")) return;
      const w = el.children.length > 1 ? el.children[1].offsetLeft - el.children[0].offsetLeft : 1;
      const idx = Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollLeft / w)));
      const id = CITIES[idx]?.id;
      if (id && id !== selected) selectCity(id, el);
    }, 150);
  }, { passive: true });
}

function selectCity(id, fromCarousel = null) {
  selected = id;
  focusAll = false;
  localStorageSet("cidade", id);
  renderCitySel();
  if (Object.keys(forecasts).length) { renderCards(); renderChart(); }
  applyZoom();
  syncCarousels(fromCarousel);
}

