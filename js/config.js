// ===================== Configuração =====================
const CITIES = [
  { id: "cb", name: "Campo Bom",       short: "Campo Bom", lat: -29.6789, lon: -51.0528, color: "#ff9f1c" },
  { id: "ss", name: "Sapucaia do Sul", short: "Sapucaia",  lat: -29.8276, lon: -51.1450, color: "#e040fb" },
  { id: "nt", name: "Nova Tramandaí",  short: "Tramandaí", lat: -29.9925, lon: -50.1380, color: "#00e5ff" },
  { id: "poa", name: "Porto Alegre",   short: "Porto Alegre", lat: -30.0346, lon: -51.2177, color: "#8ac926" },
  { id: "gr",  name: "Gramado",        short: "Gramado",   lat: -29.3789, lon: -50.8742, color: "#b5651d" },
  { id: "tq",  name: "Taquara",        short: "Taquara",   lat: -29.6505, lon: -50.7808, color: "#3a86ff" },
];

// Área coberta pela imagem do radar (projeção lat/lon simples)
const RADAR_BOUNDS = { west: -54.30, east: -48.10, north: -28.21, south: -31.97 };
const RADAR_URL = i => `https://statics.climatempo.com.br/radar_poa/pngs/latest/radar_poa_${i}.png`;
const RADAR_FRAMES = 24;           // 1 = mais recente, 24 = mais antiga (1 quadro a cada 5 min)
const REFRESH_MS = 5 * 60 * 1000;  // 5 minutos (mesmo ritmo do radar)

const RAIN_MIN = 0.1;  // mm em 15 min para considerar "chuva"
let forecasts = {};    // id -> dados da Open-Meteo
let selected = localStorageGet("cidade") || "cb";

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

