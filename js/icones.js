// ===================== Ícones SVG =====================
// Substituem os emojis, que mudam de desenho entre Android, iPhone e Windows.
// Cores vêm do CSS (--ic-sun, --ic-cloud ...) para funcionar no modo claro e escuro.

// ----- Ícones de tempo (coloridos, 64x64) -----
const CLOUD = "M18 46h28a10 10 0 0 0 1-19.9A14 14 0 0 0 20.5 24 11 11 0 0 0 18 46z";
const W_PARTS = {
  sun: `<g class="i-sun"><circle cx="32" cy="32" r="12"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a =>
    `<line x1="32" y1="13" x2="32" y2="7" transform="rotate(${a} 32 32)"/>`).join("")}</g>`,
  moon: `<path class="i-moon" d="M38 12a20 20 0 1 0 15 28A16 16 0 1 1 38 12z"/>`,
  cloud: (dy = 0, dark = false) => `<path class="${dark ? "i-cloud2" : "i-cloud"}" d="${CLOUD}" transform="translate(0 ${dy})"/>`,
  drops: (xs, y = 46) => xs.map(x => `<line class="i-rain" x1="${x}" y1="${y}" x2="${x - 3}" y2="${y + 8}"/>`).join(""),
  dots: (xs, y = 50, cls = "i-rain-dot") => xs.map((x, i) => `<circle class="${cls}" cx="${x}" cy="${y + (i % 2) * 3}" r="2.4"/>`).join(""),
  bolt: `<path class="i-bolt" d="M35 38 26 51h7l-3 10 11-15h-7l4-8z"/>`,
};
const small = (svg, t) => `<g transform="${t}">${svg}</g>`;
const WEATHER = {
  sun: W_PARTS.sun,
  moon: W_PARTS.moon,
  partly: small(W_PARTS.sun, "translate(2 0) scale(.72)") + small(W_PARTS.cloud(), "translate(8 10) scale(.88)"),
  partlyNight: small(W_PARTS.moon, "translate(4 0) scale(.7)") + small(W_PARTS.cloud(), "translate(8 10) scale(.88)"),
  cloud: W_PARTS.cloud(2),
  fog: W_PARTS.cloud(-6) + `<line class="i-fog" x1="14" y1="48" x2="50" y2="48"/><line class="i-fog" x1="18" y1="55" x2="46" y2="55"/>`,
  drizzle: W_PARTS.cloud(-6) + W_PARTS.dots([24, 34, 44]),
  rain: W_PARTS.cloud(-6) + W_PARTS.drops([25, 35, 45], 45),
  showers: small(W_PARTS.sun, "translate(2 -2) scale(.6)") + small(W_PARTS.cloud(-6), "translate(6 6) scale(.9)") + W_PARTS.drops([30, 40], 48),
  snow: W_PARTS.cloud(-6) + W_PARTS.dots([24, 34, 44], 50, "i-snow"),
  storm: W_PARTS.cloud(-8, true) + W_PARTS.bolt + W_PARTS.drops([20, 46], 42),
};
const wIcon = (name, cls = "w-ic") => `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${WEATHER[name] || WEATHER.cloud}</svg>`;

// ----- Ícones de interface (um traço, cor do texto, 24x24) -----
const UI = {
  umbrella: `<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M12 12v7a2 2 0 0 1-4 0"/>`,
  wave: `<path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0 2 1 2 1"/><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0 2 1 2 1"/><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0 2 1 2 1"/>`,
  wind: `<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8"/>`,
  bolt: `<path d="M13 2 4 14h7l-1 8 10-13h-7z"/>`,
  alert: `<path d="M12 3 2 20h20z"/><path d="M12 9v5"/><path d="M12 17h.01"/>`,
  check: `<path d="m5 12 4 4L19 6"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  compass: `<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>`,
  sparkle: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16v4M17 18h4"/>`,
  up: `<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>`,
  down: `<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>`,
  right: `<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>`,
  play: `<path d="M7 5v14l12-7z" class="fill"/>`,
  pause: `<path d="M8 5v14M16 5v14"/>`,
  prev: `<path d="M18 6v12l-9-6z" class="fill"/><path d="M6 6v12"/>`,
  next: `<path d="M6 6v12l9-6z" class="fill"/><path d="M18 6v12"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>`,
};
const uIcon = (name, cls = "u-ic") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${UI[name]}</svg>`;
