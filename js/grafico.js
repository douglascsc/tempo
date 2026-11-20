// ===================== 3. Gráfico =====================
// No celular abre em 24 h (cabe na tela sem rolar); no computador, 48 h. A pessoa pode trocar.
let chartHours = +(localStorageGet("chartHours") || (IS_PHONE ? 24 : 48));

// Maior sequência de horas secas (chuva < 0,1 mm e prob < 30%) entre 6h e 22h nas próximas 24 h
function bestDryWindow(h) {
  let best = null, cur = null;
  h.slice(0, 24).forEach((x, i) => {
    const hour = x.t.getHours();
    const ok = x.p < 0.1 && x.prob < 30 && hour >= 6 && hour < 22;
    if (ok) { cur = cur ? { ...cur, end: i } : { start: i, end: i }; if (!best || cur.end - cur.start > best.end - best.start) best = { ...cur }; }
    else cur = null;
  });
  return best;
}

// Resumo em texto do gráfico, para leitores de tela
function chartSummary(c, h) {
  const total = h.reduce((s, x) => s + x.p, 0);
  const wettest = h.reduce((a, b) => (b.p > a.p ? b : a));
  const probMax = h.reduce((a, b) => (b.prob > a.prob ? b : a));
  const temps = h.map(x => x.temp);
  return `${c.name}, próximas ${h.length} horas: chuva total de ${fmtMm(total)} mm` +
    (wettest.p > 0 ? `, mais forte às ${hh(wettest.t)} com ${fmtMm(wettest.p)} mm` : "") +
    `; maior chance de chuva ${probMax.prob}% às ${hh(probMax.t)}; temperatura de ${Math.round(Math.min(...temps))}° a ${Math.round(Math.max(...temps))}°.`;
}

// ----- 12 h em blocos de 1 h (previsão do tempo), depois das 2 h que o radar já cobre -----
// mm/h -> escala da Defesa Civil, usando a mesma fórmula do radar (30 dBZ ≈ 2,7 mm/h; 45 dBZ ≈ 24 mm/h; 60 dBZ ≈ 205 mm/h)
const mmToInt = mm => mm >= 205 ? INT[0] : mm >= 24 ? INT[1] : mm >= 2.7 ? INT[2] : mm >= 0.2 ? INT[3] : [0, "sem chuva", "var(--line)"];

function renderNext12() {
  const c = CITIES.find(x => x.id === selected), f = forecasts[c.id];
  if (!f) return;
  const now = Date.now();
  const h = f.hourly.time.map((t, i) => ({ t: parseT(t), p: f.hourly.precipitation[i] ?? 0, prob: f.hourly.precipitation_probability[i] ?? 0 }))
    .filter(x => x.t.getTime() + 3600e3 > now).slice(2, 14); // as 2 primeiras horas já estão no radar
  document.getElementById("next12").innerHTML = `
    <div class="nc-lbl">Depois das próximas 2 h <span class="muted">· previsão do tempo, hora a hora (${hh(h[0].t)} às ${hh(h[h.length - 1].t)})</span></div>
    <div class="nc-blocks n12">${h.map(x => {
      const [, lbl, col] = mmToInt(x.p);
      return `<div title="${fmtMm(x.p)} mm · ${x.prob}%"><div class="muted nc-t">${hh(x.t)}</div><span class="sq" style="background:${col}"></span>
        <div>${lbl}</div><div class="muted n12-p">${x.prob}%</div></div>`;
    }).join("")}</div>
    ${srcLine(`previsão do tempo ${SRC.om} · chuva prevista em mm convertida para a escala da Defesa Civil · % = chance de chover`)}`;
}

function renderChart() {
  renderNext12();
  const c = CITIES.find(x => x.id === selected);
  const f = forecasts[c.id];
  if (!f) return;
  const now = Date.now();
  const h = f.hourly.time.map((t, i) => ({
    t: parseT(t), p: f.hourly.precipitation[i] ?? 0, prob: f.hourly.precipitation_probability[i] ?? 0,
    temp: f.hourly.temperature_2m[i],
  })).filter(x => x.t.getTime() + 3600e3 > now).slice(0, chartHours);

  document.getElementById("chartTitle").innerHTML =
    `<span class="dot" style="background:${c.color}"></span>${c.name} · próximas ${chartHours} h`;
  document.querySelectorAll("#chartRange button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.h === chartHours));

  const dry = bestDryWindow(h);
  const dw = document.getElementById("dryWindow");
  if (dry) {
    const end = new Date(h[dry.end].t.getTime() + 3600e3);
    const dia = h[dry.start].t.getDate() === new Date().getDate() ? "hoje" : "amanhã";
    dw.innerHTML = `${wIcon("sun", "w-in")} Melhor janela seca: <b>${dia}, ${hh(h[dry.start].t)}–${hh(end)}</b> (${dry.end - dry.start + 1} h)`;
  } else {
    dw.innerHTML = `${wIcon("rain", "w-in")} Nenhuma janela seca (6h–22h) nas próximas 24 h.`;
  }

  // desenha no tamanho real da tela (texto nítido, sem distorção e sem rolagem lateral)
  const svg = document.getElementById("chart");
  const W = Math.max(280, svg.clientWidth || document.getElementById("chartWrap").clientWidth);
  const H = IS_PHONE ? 220 : 280, L = 30, R = 30, T = 12, B = 26;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.height = H + "px";
  svg.setAttribute("aria-label", chartSummary(c, h));

  const pw = W - L - R, ph = H - T - B, n = h.length, bw = pw / n;
  const maxP = Math.max(2, ...h.map(x => x.p));
  const tMin = Math.floor(Math.min(...h.map(x => x.temp)) - 1), tMax = Math.ceil(Math.max(...h.map(x => x.temp)) + 1);
  const X = i => L + i * bw + bw / 2;
  const yP = v => T + ph - v / maxP * ph;
  const yT = v => T + ph - (v - tMin) / (tMax - tMin) * ph;
  const yPr = v => T + ph - v / 100 * ph;
  const css = getComputedStyle(document.documentElement);
  const col = k => css.getPropertyValue(k).trim();
  const every = bw * 6 >= 38 ? 6 : 12; // rótulos a cada 6 h, ou 12 h se não couber

  let s = "";
  if (dry) s += `<rect x="${L + dry.start * bw}" y="${T}" width="${(dry.end - dry.start + 1) * bw}" height="${ph}" fill="${col("--dry-bg")}" stroke="${col("--dry")}" stroke-dasharray="3 3"/>`;
  h.forEach((x, i) => {
    if (x.t.getHours() % every === 0) {
      s += `<line x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${T + ph}" stroke="${col("--line")}"/>`;
      const label = x.t.getHours() === 0 ? x.t.toLocaleDateString("pt-BR", { weekday: "short" }) : hh(x.t);
      s += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    }
  });
  h.forEach((x, i) => { if (x.p > 0) s += `<rect x="${L + i * bw + 0.5}" y="${yP(x.p)}" width="${Math.max(1, bw - 1)}" height="${T + ph - yP(x.p)}" fill="${col("--rain")}" rx="1"><title>${hh(x.t)}: ${fmtMm(x.p)} mm</title></rect>`; });
  s += `<polyline fill="none" stroke="${col("--prob")}" stroke-width="1.5" stroke-dasharray="4 3" points="${h.map((x, i) => `${X(i)},${yPr(x.prob)}`).join(" ")}"/>`;
  s += `<polyline fill="none" stroke="${col("--temp")}" stroke-width="2.5" points="${h.map((x, i) => `${X(i)},${yT(x.temp)}`).join(" ")}"/>`;
  [0, 0.5, 1].forEach(fr => {
    s += `<text x="${L - 5}" y="${yP(maxP * fr) + 4}" text-anchor="end">${fmtMm(maxP * fr)}</text>`;
    s += `<text x="${W - R + 5}" y="${yT(tMin + (tMax - tMin) * fr) + 4}">${Math.round(tMin + (tMax - tMin) * fr)}°</text>`;
  });
  s += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="${col("--line")}"/>`;
  svg.innerHTML = s;
}

document.querySelectorAll("#chartRange button").forEach(b => b.onclick = () => {
  chartHours = +b.dataset.h;
  localStorageSet("chartHours", chartHours);
  renderChart();
});
