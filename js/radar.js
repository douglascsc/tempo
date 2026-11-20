// ===================== 2. Radar =====================
// Duas fontes: Climatempo (imagens do radar de POA, 1 a cada 5 min, sem horário legível pelo código)
// e RainViewer (mapa com horário exato de cada imagem, 1 a cada 10 min).
// Em ambas, o quadro 1 é o mais recente.
let src = localStorageGet("radarSrc") || "ct";
let spanMin = 15;      // minutos animados: 15 ou 120
let frame = 1;
let playing = true, timer = null, frames = [];
let rv = { map: null, layers: [], times: [], markers: [], future: [], arrow: null };
let rvFuture = null;       // preenchido pelo nowcast: imagem mais nova + velocidade da chuva
const FUTURE_STEPS = [10, 20, 30, 40, 50, 60]; // minutos após a imagem mais nova

const STEP_MIN = () => (src === "ct" ? 5 : 10);
const available = () => (src === "ct" ? RADAR_FRAMES : rv.layers.length);
const nFrames = () => Math.max(1, Math.min(available(), Math.floor(spanMin / STEP_MIN()) + 1));
// quadros <= 0 são a previsão (0 = +10 min, -1 = +20 min ...), só no RainViewer
const minFrame = () => (src === "rv" && rv.future.length ? 1 - rv.future.length : 1);

function cityPos(c) {
  const b = RADAR_BOUNDS;
  return { x: (c.lon - b.west) / (b.east - b.west) * 100, y: (b.north - c.lat) / (b.north - b.south) * 100 };
}

function buildMarkers() {
  document.getElementById("markers").innerHTML = CITIES.map(c => {
    const p = cityPos(c);
    return `<div class="marker" style="left:${p.x}%;top:${p.y}%">
      <div class="pin" style="background:${c.color}"></div><div class="lbl">${c.name}</div></div>`;
  }).join("");
}

// ----- Climatempo -----
// Cada imagem tem ~740 KB. Só baixa os quadros que a animação vai usar
// (4 no padrão "últimos 15 min"); os outros só se a pessoa escolher "2 h".
const preloaded = new Set();
function loadClimatempo() {
  const stamp = Math.floor(Date.now() / REFRESH_MS); // muda a cada 5 min: evita cache velho
  frames = [];
  for (let i = 1; i <= RADAR_FRAMES; i++) frames[i] = `${RADAR_URL(i)}?v=${stamp}`;
  preloaded.clear();
  preloadClimatempo();
}
function preloadClimatempo() {
  if (src !== "ct") return; // aba RainViewer aberta: não baixa nada da Climatempo
  for (let i = 1; i <= nFrames(); i++) {
    if (preloaded.has(frames[i])) continue;
    preloaded.add(frames[i]);
    new Image().src = frames[i];
  }
}

// ----- RainViewer -----
function initRainViewerMap() {
  if (rv.map) return;
  const c = CITIES.find(x => x.id === selected);
  rv.map = L.map("rvMap", { zoomControl: true }).setView([c.lat, c.lon], 8);
  if (focusAll) rv.map.fitBounds(FOCUS.map(x => [x.lat, x.lon]), { padding: [60, 60], maxZoom: 10 });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Radar <a href="https://www.rainviewer.com/">RainViewer</a>',
  }).addTo(rv.map);
  CITIES.forEach(c => L.circleMarker([c.lat, c.lon], { radius: 7, color: "#fff", weight: 2, fillColor: c.color, fillOpacity: 1 })
    .bindTooltip(c.name, { permanent: true, direction: "right", className: "city-tip" }).addTo(rv.map));
}

async function loadRainViewer() {
  initRainViewerMap();
  const d = await (await fetchWithTimeout("https://api.rainviewer.com/public/weather-maps.json", 15000)).json();
  rv.layers.forEach(l => rv.map.removeLayer(l));
  const past = d.radar.past;                // mais antiga -> mais recente
  rv.times = past.map(p => new Date(p.time * 1000)).reverse(); // índice 0 = mais recente
  rv.layers = past.map((p, k) => L.tileLayer(`${d.host}${p.path}/256/{z}/{x}/{y}/2/1_1.png`, {
    opacity: 0, maxNativeZoom: 7, maxZoom: 12, zIndex: 10 + k,
  }).addTo(rv.map)).reverse();
}

// ----- Previsão desenhada no mapa -----
// Desloca a imagem mais recente do radar ao longo do vetor de movimento (extrapolação).
function buildFuture() {
  if (!rv.map) return;
  rv.future.forEach(l => rv.map.removeLayer(l));
  rv.future = [];
  if (rv.arrow) { rv.arrow.forEach(l => rv.map.removeLayer(l)); rv.arrow = null; }
  if (!rvFuture) return;
  const f = rvFuture, un = (x, y) => rv.map.unproject(L.point(x, y), Z);
  rv.future = FUTURE_STEPS.map(m => {
    const dx = f.vx * m, dy = f.vy * m;
    return L.imageOverlay(f.url, [un(f.ox + dx, f.oy + dy), un(f.ox + f.W + dx, f.oy + f.H + dy)],
      { opacity: 0, className: "rv-future" }).addTo(rv.map);
  });
  drawArrow();
  if (src === "rv") showFrame(frame);
}

// Seta mostrando de onde vem a chuva, terminando na cidade selecionada (trajeto de 60 min)
function drawArrow() {
  if (!rv.map || !rvFuture || !rvFuture.from) return;
  if (rv.arrow) rv.arrow.forEach(l => rv.map.removeLayer(l));
  const c = CITIES.find(x => x.id === selected), f = rvFuture;
  const end = rv.map.project([c.lat, c.lon], Z);
  const start = rv.map.unproject(L.point(end.x - f.vx * 60, end.y - f.vy * 60), Z);
  const ang = Math.atan2(f.vy, f.vx) * 180 / Math.PI;
  const line = L.polyline([start, [c.lat, c.lon]], { color: "#111", weight: 3, dashArray: "6 6", interactive: false });
  const head = L.marker([c.lat, c.lon], { interactive: false, icon: L.divIcon({ className: "rv-arrow",
    html: `<div style="transform:rotate(${ang}deg)">${uIcon("right")}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) });
  // rótulo do lado de fora da seta (oposto à cidade)
  const ox = Math.cos(ang * Math.PI / 180) > 0 ? "calc(-100% - 8px)" : "8px";
  const lbl = L.marker(start, { interactive: false, icon: L.divIcon({ className: "",
    html: `<div class="rv-arrow-lbl" style="transform:translate(${ox},-50%)">vindo do ${f.from} · ${Math.round(f.speed)} km/h</div>`,
    iconSize: [0, 0] }) });
  rv.arrow = [line, head, lbl].map(l => l.addTo(rv.map));
}

// ----- Controles comuns -----
function showFrame(i) {
  frame = Math.min(Math.max(minFrame(), i), nFrames());
  const n = nFrames();
  const t = document.getElementById("radarTime");
  if (src === "ct") {
    if (frames[frame]) document.getElementById("radarImg").src = frames[frame];
    const ago = frame === 1 ? "imagem mais recente" : `${(frame - 1) * 5} min antes da mais recente`;
    document.getElementById("frameInfo").textContent = `· ${ago}`;
    t.className = "";
    // no celular o zoom esconde o canto da imagem: mostra o horário recortado da própria imagem
    t.innerHTML = IS_PHONE && frames[frame]
      ? `${uIcon("clock")} Horário da imagem: <span class="ct-time" style="background-image:url('${frames[frame]}')"></span> ${infoBtn("ctNote")}<div id="ctNote" class="muted ${infoCls("ctNote")}">Pode ter até ~1 h de atraso; para o horário exato, use o RainViewer.</div>`
      : `${uIcon("clock")} O horário está no canto inferior direito da imagem. Este radar pode chegar com <b>até ~1 h de atraso</b>; para o horário exato, use o RainViewer.`;
  } else if (rv.layers.length && frame <= 0) {
    rv.layers.forEach(l => l.setOpacity(0));
    rv.future.forEach((l, k) => l.setOpacity(k === -frame ? 0.75 : 0));
    const m = FUTURE_STEPS[-frame], when = new Date(rvFuture.t0 + m * 60e3);
    const fromNow = Math.round((when - Date.now()) / 60000);
    document.getElementById("frameInfo").textContent = `· previsão ${hhmm(when)}`;
    t.className = "future";
    t.innerHTML = `${uIcon("sparkle")} <b>Previsão para ${hhmm(when)}</b> (${fromNow >= 0 ? `daqui ~${fromNow} min` : "agora"}) · extrapolação do movimento, pode mudar`;
  } else if (rv.layers.length) {
    rv.future.forEach(l => l.setOpacity(0));
    rv.layers.forEach((l, k) => l.setOpacity(k === frame - 1 ? 0.75 : 0));
    const when = rv.times[frame - 1];
    const newestAge = Math.round((Date.now() - rv.times[0]) / 60000);
    document.getElementById("frameInfo").textContent = `· ${hhmm(when)}`;
    t.className = newestAge > 25 ? "stale" : "";
    t.innerHTML = `${uIcon("clock")} Imagem <b>${atAgo(when)}</b>` +
      (newestAge > 25 ? ` · ${uIcon("alert")} a imagem mais nova já tem ${newestAge} min` : "");
  }
  const s = document.getElementById("frame");
  s.max = n - minFrame();
  s.value = n - frame; // slider: esquerda = antiga, direita = previsão
}

function step(dir) { // dir = +1 avança no tempo
  const n = nFrames();
  let i = frame - dir;
  if (i < minFrame()) i = n; if (i > n) i = minFrame();
  showFrame(i);
}

function tick() {
  // velocidade conforme a quantidade de quadros: poucos quadros andam mais devagar
  // Climatempo 15 min (4 quadros): 1 s cada · 2 h (24 quadros): 0,4 s · RainViewer: 0,8 s
  const per = src === "rv" ? 800 : nFrames() <= 4 ? 1000 : 400;
  const hold = 2500; // pausa no último quadro (mais recente, ou fim da previsão)
  const delay = frame === minFrame() ? hold : frame === 1 && minFrame() < 1 ? 1200 : per;
  // com a aba em segundo plano a animação não avança (economiza bateria)
  timer = setTimeout(() => { if (playing) { if (!document.hidden) step(1); tick(); } }, delay);
}

function setPlaying(p) {
  playing = p; clearTimeout(timer);
  document.getElementById("playBtn").innerHTML = uIcon(p ? "pause" : "play");
  if (p) tick();
}

async function setSource(s) {
  src = s;
  localStorageSet("radarSrc", s);
  document.querySelectorAll("#srcTabs button").forEach(b => b.classList.toggle("on", b.dataset.src === s));
  document.getElementById("radarBox").hidden = s !== "ct";
  document.getElementById("rvMap").hidden = s !== "rv";
  document.querySelector("label.zoom").hidden = s !== "ct";
  if (s === "ct") preloadClimatempo();
  if (s === "rv") {
    initRainViewerMap();
    rv.map.invalidateSize();
    if (!rv.future.length) buildFuture();
    if (!rv.layers.length) {
      try { await loadRainViewer(); }
      catch (e) { document.getElementById("radarTime").textContent = "Erro ao carregar RainViewer: " + e.message; }
    }
  }
  showFrame(nFrames());
}

async function loadRadar() {
  loadClimatempo();
  if (rv.map) { try { await loadRainViewer(); } catch {} }
  showFrame(frame);
}

// No celular o radar abre com zoom máximo em Campo Bom + Sapucaia; ao escolher uma cidade, centraliza nela.
let focusAll = IS_PHONE;
const FOCUS = CITIES.filter(c => ["cb", "ss"].includes(c.id)); // cidades principais
const CENTER_ALL = { lat: FOCUS.reduce((s, c) => s + c.lat, 0) / FOCUS.length, lon: FOCUS.reduce((s, c) => s + c.lon, 0) / FOCUS.length };

function applyZoom() {
  const c = focusAll ? CENTER_ALL : CITIES.find(x => x.id === selected);
  if (rv.map) {
    if (focusAll) rv.map.fitBounds(FOCUS.map(x => [x.lat, x.lon]), { padding: [60, 60], maxZoom: 10 });
    else rv.map.setView([c.lat, c.lon], rv.map.getZoom());
    drawArrow();
  }
  const z = parseFloat(document.getElementById("zoom").value);
  const p = cityPos(c);
  const layer = document.getElementById("radarLayer");
  if (IS_PHONE) {
    // celular: põe o ponto de foco no centro do quadro, sem deixar sobrar borda vazia
    const box = document.getElementById("radarBox");
    const bw = box.clientWidth, bh = box.clientHeight, lw = layer.offsetWidth, lh = layer.offsetHeight, m = layer.offsetLeft;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const tx = clamp(bw / 2 - m - z * p.x / 100 * lw, bw - m - z * lw, -m);
    const ty = clamp(bh / 2 - z * p.y / 100 * lh, bh - z * lh, 0);
    layer.style.transformOrigin = "0 0";
    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
  } else {
    layer.style.transformOrigin = `${p.x}% ${p.y}%`;
    layer.style.transform = `scale(${z})`;
  }
  // marcadores mantêm o tamanho na tela
  document.querySelectorAll(".marker").forEach(m => m.style.transform = `translate(-50%,-50%) scale(${1 / z})`);
}

document.getElementById("playBtn").onclick = () => setPlaying(!playing);
document.getElementById("prevBtn").onclick = () => { setPlaying(false); step(-1); };
document.getElementById("nextBtn").onclick = () => { setPlaying(false); step(1); };
document.getElementById("frame").oninput = e => { setPlaying(false); showFrame(nFrames() - +e.target.value); };
document.getElementById("span").onchange = e => { spanMin = +e.target.value; preloadClimatempo(); showFrame(nFrames()); };
document.getElementById("zoom").oninput = applyZoom;
document.querySelectorAll("#srcTabs button").forEach(b => b.onclick = () => setSource(b.dataset.src));

