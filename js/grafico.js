// ===================== 3. Gráfico =====================
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

function renderChart() {
  const c = CITIES.find(x => x.id === selected);
  const f = forecasts[c.id];
  const now = Date.now();
  const h = f.hourly.time.map((t, i) => ({
    t: parseT(t), p: f.hourly.precipitation[i] ?? 0, prob: f.hourly.precipitation_probability[i] ?? 0,
    temp: f.hourly.temperature_2m[i],
  })).filter(x => x.t.getTime() + 3600e3 > now).slice(0, 48);

  document.getElementById("chartTitle").innerHTML =
    `<span class="dot" style="background:${c.color}"></span>${c.name} · próximas 48 h`;

  const dry = bestDryWindow(h);
  const dw = document.getElementById("dryWindow");
  if (dry) {
    const end = new Date(h[dry.end].t.getTime() + 3600e3);
    const dia = h[dry.start].t.getDate() === new Date().getDate() ? "hoje" : "amanhã";
    dw.innerHTML = `☀️ Melhor janela seca: <b>${dia}, ${hh(h[dry.start].t)}–${hh(end)}</b> (${dry.end - dry.start + 1} h)`;
  } else {
    dw.innerHTML = "🌧️ Nenhuma janela seca (6h–22h) nas próximas 24 h.";
  }

  const W = 900, H = 280, L = 34, R = 34, T = 14, B = 30;
  const pw = W - L - R, ph = H - T - B, n = h.length, bw = pw / n;
  const maxP = Math.max(2, ...h.map(x => x.p));
  const tMin = Math.floor(Math.min(...h.map(x => x.temp)) - 1), tMax = Math.ceil(Math.max(...h.map(x => x.temp)) + 1);
  const X = i => L + i * bw + bw / 2;
  const yP = v => T + ph - v / maxP * ph;
  const yT = v => T + ph - (v - tMin) / (tMax - tMin) * ph;
  const yPr = v => T + ph - v / 100 * ph;
  const css = getComputedStyle(document.documentElement);
  const col = k => css.getPropertyValue(k).trim();

  let s = "";
  if (dry) s += `<rect x="${L + dry.start * bw}" y="${T}" width="${(dry.end - dry.start + 1) * bw}" height="${ph}" fill="${col("--dry-bg")}" stroke="${col("--dry")}" stroke-dasharray="3 3"/>`;
  // linhas de grade e rótulos de hora
  h.forEach((x, i) => {
    if (x.t.getHours() % 6 === 0) {
      s += `<line x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${T + ph}" stroke="${col("--line")}"/>`;
      const label = x.t.getHours() === 0 ? x.t.toLocaleDateString("pt-BR", { weekday: "short" }) : hh(x.t);
      s += `<text x="${X(i)}" y="${H - 10}" text-anchor="middle">${label}</text>`;
    }
  });
  // barras de chuva
  h.forEach((x, i) => { if (x.p > 0) s += `<rect x="${L + i * bw + 1}" y="${yP(x.p)}" width="${bw - 2}" height="${T + ph - yP(x.p)}" fill="${col("--rain")}" rx="1"><title>${hh(x.t)}: ${fmtMm(x.p)} mm</title></rect>`; });
  // probabilidade (tracejada) e temperatura
  s += `<polyline fill="none" stroke="${col("--prob")}" stroke-width="1.5" stroke-dasharray="4 3" points="${h.map((x, i) => `${X(i)},${yPr(x.prob)}`).join(" ")}"/>`;
  s += `<polyline fill="none" stroke="${col("--temp")}" stroke-width="2.5" points="${h.map((x, i) => `${X(i)},${yT(x.temp)}`).join(" ")}"/>`;
  // eixos: mm à esquerda, °C à direita
  [0, 0.5, 1].forEach(f => {
    s += `<text x="${L - 6}" y="${yP(maxP * f) + 4}" text-anchor="end">${fmtMm(maxP * f)}</text>`;
    s += `<text x="${W - R + 6}" y="${yT(tMin + (tMax - tMin) * f) + 4}">${Math.round(tMin + (tMax - tMin) * f)}°</text>`;
  });
  s += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="${col("--line")}"/>`;
  document.getElementById("chart").innerHTML = s;
}

