// ===================== Configuração =====================
const CITIES = [
  { id: "cb", slug: "campo-bom", name: "Campo Bom",       short: "Campo Bom", lbl: "left", lat: -29.6789, lon: -51.0528, color: "#ff9f1c" },
  { id: "sp", slug: "sapiranga", name: "Sapiranga",       short: "Sapiranga", lbl: "top", lat: -29.6383, lon: -51.0069, color: "#577590" },
  { id: "ss", slug: "sapucaia", name: "Sapucaia do Sul", short: "Sapucaia",  lat: -29.8276, lon: -51.1450, color: "#e040fb" },
  { id: "nt", slug: "nova-tramandai", alias: "tramandai", name: "Nova Tramandaí", short: "Nova Tramandaí", lat: -30.0370, lon: -50.1611, color: "#00e5ff" },
  { id: "poa", slug: "porto-alegre", name: "Porto Alegre",   short: "Porto Alegre", lat: -30.0346, lon: -51.2177, color: "#8ac926" },
  { id: "gr", slug: "gramado",  name: "Gramado",        short: "Gramado",   lat: -29.3789, lon: -50.8742, color: "#b5651d" },
  { id: "tq", slug: "taquara",  name: "Taquara",        short: "Taquara",   lat: -29.6505, lon: -50.7808, color: "#3a86ff" },
  { id: "fi", slug: "fialho",  name: "Fialho (Taquara)", short: "Fialho",  lat: -29.7467, lon: -50.8966, color: "#2b9348" },
  { id: "gv", slug: "gravatai",  name: "Gravataí",       short: "Gravataí",  lat: -29.9440, lon: -50.9919, color: "#ef476f" },
];

// Área coberta pela imagem do radar (projeção lat/lon simples)
const RADAR_BOUNDS = { west: -54.30, east: -48.10, north: -28.21, south: -31.97 };
const RADAR_URL = i => `https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_${i}.png`;
const RADAR_FRAMES = 24;           // 1 = mais recente, 24 = mais antiga (1 quadro a cada 5 min)
const REFRESH_MS = 5 * 60 * 1000;  // 5 minutos (mesmo ritmo do radar)

const RAIN_MIN = 0.1;  // mm em 15 min para considerar "chuva"
let forecasts = {};    // id -> dados da Open-Meteo
// Link direto para a cidade: douglasc.top/tempo/#gramado (também aceita ?cidade=gramado).
// Sem link, abre a última cidade vista neste aparelho.
function cityFromUrl() {
  const key = (location.hash.slice(1) || new URLSearchParams(location.search).get("cidade") || "").toLowerCase();
  return CITIES.find(c => c.slug === key || c.alias === key || c.id === key)?.id || null; // alias: links antigos continuam valendo
}
const FROM_LINK = cityFromUrl();
let selected = FROM_LINK || localStorageGet("cidade") || "cb";

// Textos de ajuda que no celular ficam escondidos atrás de um botão ⓘ
const openInfo = new Set();
const infoBtn = id => `<button class="ibtn" onclick="toggleInfo('${id}')" aria-label="Mais informações">ⓘ</button>`;
const infoCls = id => `phone-info${openInfo.has(id) ? " show" : ""}`;
function toggleInfo(id) {
  openInfo.has(id) ? openInfo.delete(id) : openInfo.add(id);
  document.getElementById(id)?.classList.toggle("show", openInfo.has(id));
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

const IS_PHONE = matchMedia("(max-width: 600px)").matches;
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

// fetch com tempo limite: uma fonte lenta não pode travar a página
async function fetchWithTimeout(url, ms = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${new URL(url).host} respondeu ${res.status}`);
  return res;
}

const hhmm = d => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
// Rodapé "Fonte:" de cada card
const SRC = {
  rv: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
  ct: '<a href="https://www.climatempo.com.br/" target="_blank" rel="noopener">Climatempo</a>',
  om: '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>',
  osm: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
};
const srcLine = html => `<div class="src-line">${uIcon("info")} <b>Fonte:</b> ${html}</div>`;

// formato único de horário em toda a página: "às 13:50 (há 6 min)"
function agoTxt(d) {
  const min = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h${min % 60 ? " " + String(min % 60).padStart(2, "0") : ""}`;
}
const atAgo = d => `às ${hhmm(d)} (${agoTxt(d)})`;
const hh = d => d.getHours() + "h";
const fmtMm = v => v < 1 ? v.toFixed(1).replace(".", ",") : Math.round(v).toString();
// Open-Meteo devolve horário local sem fuso; a página assume que quem abre está no mesmo fuso (Brasília)
const parseT = s => new Date(s);

