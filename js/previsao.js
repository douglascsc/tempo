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
  const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  if (!res.ok) throw new Error("Open-Meteo " + res.status);
  const data = await res.json();
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
  if (thunder) { items.push(`⛈️ Possível trovoada a partir das ${hh(thunder.t)}`); level = Math.max(level, 1); }
  const g = h.reduce((a, b) => (b.gust > a.gust ? b : a));
  if (g.gust >= 60) {
    items.push(`💨 Rajadas de até ${Math.round(g.gust)} km/h por volta das ${hh(g.t)}`);
    level = Math.max(level, g.gust >= 80 ? 2 : 1);
  }
  const c = h.reduce((a, b) => (b.cape > a.cape ? b : a));
  if (!thunder && c.cape >= 1500 && c.prob >= 40) {
    items.push(`⚡ Atmosfera instável à tarde/noite (CAPE ${Math.round(c.cape)})`);
    level = Math.max(level, 1);
  }
  if (thunder && (c.cape >= 2500 || g.gust >= 80)) level = 2;
  return { level, items, maxGust: Math.round(g.gust) };
}

// ===================== Tempo agora e 5 dias =====================
// Códigos WMO usados pela Open-Meteo -> ícone e texto
function wx(code, isDay = 1) {
  if (code === 0) return [isDay ? "☀️" : "🌙", "Céu limpo"];
  if (code === 1) return [isDay ? "🌤️" : "🌙", "Predomínio de sol"];
  if (code === 2) return ["⛅", "Parcialmente nublado"];
  if (code === 3) return ["☁️", "Nublado"];
  if (code === 45 || code === 48) return ["🌫️", "Neblina"];
  if (code >= 51 && code <= 57) return ["🌦️", "Garoa"];
  if (code >= 61 && code <= 67) return ["🌧️", "Chuvoso"];
  if (code >= 71 && code <= 77) return ["🌨️", "Neve"];
  if (code >= 80 && code <= 82) return ["🌦️", "Pancadas de chuva"];
  if (code === 85 || code === 86) return ["🌨️", "Pancadas de neve"];
  if (code >= 95) return ["⛈️", "Tempestade"];
  return ["🌡️", "—"];
}
const deg = v => `${(Math.round(v * 10) / 10).toString().replace(".", ",")}°`;

function daysHtml(f) {
  const d = f.daily;
  return `<div class="wx-days">${d.time.slice(0, 5).map((t, i) => {
    const date = new Date(t + "T12:00");
    const name = i === 0 ? "hoje" : date.toLocaleDateString("pt-BR", { weekday: "short" });
    return `<div><div class="muted">${name}</div><div class="wx-di">${wx(d.weather_code[i])[0]}</div>
      <div>${deg(d.temperature_2m_max[i])}</div><div class="muted">${deg(d.temperature_2m_min[i])}</div></div>`;
  }).join("")}</div>`;
}

// ----- Bloco "próxima hora" vindo do radar -----
const INT = [ // dBZ mínimo -> rótulo e cor
  [48, "muito forte", "#a040ff"], [39, "forte", "#e5534b"], [28, "moderada", "#f0883e"], [15, "fraca", "#3fb950"],
];
const intensity = dbz => INT.find(([m]) => dbz >= m) || [0, "sem chuva", "var(--line)"];

function nowcastHtml(n) {
  if (!n) return `<div class="nc muted">Radar: calculando tendência…</div>`;
  if (n.error) return `<div class="nc muted">Radar indisponível no momento.</div>`;
  let head;
  if (n.firstMin === 0) head = `🌧️ <b>Possível chuva agora</b> — ${intensity(n.firstDbz)[1]}`;
  else if (n.firstMin != null) head = `🌧️ <b>Possível chuva em ~${n.firstMin} min</b> — ${intensity(n.firstDbz)[1]}`;
  else head = `🌤️ <b>Sem chuva se aproximando</b> na próxima hora`;
  const near = n.nearKm == null ? "nenhuma num raio de 120 km"
    : n.nearKm < 2 ? "sobre a cidade" : `<b>${Math.round(n.nearKm)} km</b> ao ${n.nearDir}`;
  return `<div class="nc">
    <div>${head}</div>
    <div class="nc-near">Chuva mais próxima: ${near}</div>
    <div class="nc-lbl">Próxima hora (tendência)${radarMotion ? ` <span class="muted">· radar das ${hhmm(radarMotion.time)}</span>` : ""}:</div>
    <div class="nc-blocks">${n.blocks.map((v, i) => {
      const [, lbl, col] = intensity(v);
      return `<div><div class="muted">${i * 15}–${i * 15 + 15} min</div><span class="sq" style="background:${col}"></span><div>${lbl}</div></div>`;
    }).join("")}</div></div>`;
}

function renderCards() {
  const box = document.getElementById("cards"), det = document.getElementById("details");
  const keep = [box.scrollLeft, det.scrollLeft]; // no celular os cartões deslizam: mantém a posição
  box.innerHTML = ""; det.innerHTML = "";
  CITIES.forEach(c => {
    const f = forecasts[c.id];
    if (!f) return;
    const s = summarize(f);
    const a = stormAlert(f);
    const [icon, cond] = wx(f.current.weather_code, f.current.is_day);
    const alertHtml = a && a.level
      ? `<div class="alert lv${a.level}">${a.level === 2 ? "<b>Risco de temporal</b><br>" : ""}${a.items.join("<br>")}</div>`
      : (a ? `<div class="sub">💨 Rajadas até ${a.maxGust} km/h nas próximas 12 h</div>` : "");
    const card = document.createElement("div");
    card.className = "card" + (c.id === selected ? " active" : "");
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="wx-head">
        <div class="wx-icon">${icon}</div>
        <div class="wx-name"><div class="wx-cond">${cond}</div>
          <div class="muted"><span class="dot" style="background:${c.color}"></span>${c.name}</div></div>
        <div class="wx-now"><div class="wx-temp">${deg(f.current.temperature_2m)}C</div>
          <div class="muted">${deg(f.daily.temperature_2m_max[0])} / ${deg(f.daily.temperature_2m_min[0])}</div></div>
      </div>
      ${nowcastHtml(nowcast[c.id])}`;
    card.onclick = () => selectCity(c.id);
    card.onkeydown = e => { if (e.key === "Enter") selectCity(c.id); };
    box.appendChild(card);
    const dc = document.createElement("div");
    dc.className = "card" + (c.id === selected ? " active" : "");
    dc.innerHTML = `
      <div class="city"><span><span class="dot" style="background:${c.color}"></span>${c.name}</span></div>
      <div class="sub model">📈 Modelo: ${s.text} ${s.sub}</div>
      ${alertHtml}
      ${daysHtml(f)}`;
    dc.onclick = () => selectCity(c.id);
    det.appendChild(dc);
  });
  box.scrollLeft = keep[0]; det.scrollLeft = keep[1];
}

function selectCity(id) {
  selected = id;
  focusAll = false;
  localStorageSet("cidade", id);
  renderCards();
  renderChart();
  applyZoom();
}

