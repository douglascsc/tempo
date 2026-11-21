// ===================== Nowcast pelo radar (RainViewer) =====================
// Lê os pixels das imagens do radar (zoom 7, ~1 km por pixel), converte cor -> dBZ,
// estima o deslocamento da chuva entre duas imagens e extrapola para a próxima hora.
const RV_COLORS = {15:"88ddee",16:"6cd1eb",17:"51c5e8",18:"36bae5",19:"1baee2",20:"00a3e0",21:"009ad5",22:"0091ca",23:"0088bf",24:"007fb4",25:"0077aa",26:"0070a3",27:"00699c",28:"006295",29:"005b8e",30:"005588",31:"005180",32:"004e78",33:"004a70",34:"004768",35:"ffee00",36:"ffe000",37:"ffd200",38:"ffc500",39:"ffb700",40:"ffaa00",41:"ff9f00",42:"ff9500",43:"ff8b00",44:"ff8100",45:"ff4400",46:"f23600",47:"e62800",48:"d91b00",49:"cd0d00",50:"c10000",51:"a80000",52:"8f0000",53:"760000",54:"5d0000",55:"ffaaff",56:"ff9fff",57:"ff95ff",58:"ff8bff",59:"ff81ff",60:"ff77ff",61:"ff6cff",62:"ff62ff",63:"ff58ff",64:"ff4eff",65:"ffffff"};
const COLOR_DBZ = new Map(Object.entries(RV_COLORS).map(([d, h]) => [parseInt(h, 16), +d]));
const Z = 7, TILE = 256, WORLD = TILE * 2 ** Z;
const NC_BOX = { west: -52.6, east: -48.8, north: -28.4, south: -31.3 }; // área analisada
const lonToX = lon => (lon + 180) / 360 * WORLD;
const latToY = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * WORLD; };
const PX_KM = 40075 * Math.cos(29.8 * Math.PI / 180) / WORLD; // ~1,06 km por pixel
const DIRS = ["norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste"];
// direção para onde a chuva vai (oposta à de onde vem)
const toDir = from => DIRS[(DIRS.indexOf(from) + 4) % 8];
const dirName = bearing => DIRS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
let nowcast = {}, radarMotion = null;

// Monta uma grade de dBZ (Uint8Array) a partir dos tiles de um quadro
async function radarGrid(host, path) {
  const x0 = Math.floor(lonToX(NC_BOX.west) / TILE), x1 = Math.floor(lonToX(NC_BOX.east) / TILE);
  const y0 = Math.floor(latToY(NC_BOX.north) / TILE), y1 = Math.floor(latToY(NC_BOX.south) / TILE);
  const W = (x1 - x0 + 1) * TILE, H = (y1 - y0 + 1) * TILE;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const jobs = [];
  for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.src = `${host}${path}/256/${Z}/${tx}/${ty}/2/0_0.png`;
    // tempo limite por imagem: um tile que não responde não trava o cálculo
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000));
    jobs.push(Promise.race([img.decode(), timeout]).then(() => ctx.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE)).catch(() => {}));
  }
  await Promise.all(jobs);
  const px = ctx.getImageData(0, 0, W, H).data, g = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    if (px[i + 3] < 250) continue; // tons translúcidos = abaixo de 15 dBZ
    g[j] = COLOR_DBZ.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]) || 0;
  }
  return { g, W, H, ox: x0 * TILE, oy: y0 * TILE, cv };
}

// Procura o deslocamento (em pixels) que melhor leva a imagem antiga até a nova
function estimateShift(A, B, W, H) {
  let wet = 0;
  for (let i = 0; i < A.length; i += 7) if (A[i] && B[i]) wet++;
  if (wet < 60) return null; // pouca chuva para estimar movimento
  const M = 45, ST = 4;
  const score = (sx, sy) => {
    let sum = 0, n = 0;
    for (let y = M; y < H - M; y += ST) for (let x = M; x < W - M; x += ST) {
      const a = A[y * W + x], b = B[(y + sy) * W + x + sx];
      if (a || b) { sum += Math.abs(a - b); n++; }
    }
    return n ? sum / n : 1e9;
  };
  let best = [0, 0, score(0, 0)];
  for (let sy = -40; sy <= 40; sy += 2) for (let sx = -40; sx <= 40; sx += 2) {
    const v = score(sx, sy); if (v < best[2]) best = [sx, sy, v];
  }
  const [bx, by] = best;
  for (let sy = by - 1; sy <= by + 1; sy++) for (let sx = bx - 1; sx <= bx + 1; sx++) {
    const v = score(sx, sy); if (v < best[2]) best = [sx, sy, v];
  }
  return { dx: best[0], dy: best[1] };
}

// intensidade do radar (dBZ) -> chuva em mm/h (fórmula de Marshall-Palmer: Z = 200·R^1,6). É estimativa.
const dbzToMmH = dbz => dbz < 15 ? 0 : Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6);
let radarVec = null;     // movimento da chuva em pixels/min (para a seta do mini-radar)
let radarLatest = null;  // imagem mais nova do radar (canvas) para o mini-radar

// valor de um ponto de uma grade: maior (max) ou média (mean) num raio de r pixels
function sampleGrid(G, x, y, r = 2, mode = "max") {
  let m = 0, s = 0, n = 0; x = Math.round(x); y = Math.round(y);
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const X = x + i, Y = y + j;
    if (X < 0 || Y < 0 || X >= G.W || Y >= G.H) continue;
    const v = G.g[Y * G.W + X]; m = Math.max(m, v); s += v; n++;
  }
  return mode === "max" ? m : (n ? s / n : 0);
}

// média do dBZ dos pixels com chuva num raio (para saber se a chuva se fortalece ou enfraquece)
function rainMean(G, x, y, r) {
  let s = 0, n = 0; x = Math.round(x); y = Math.round(y);
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    if (i * i + j * j > r * r) continue;
    const X = x + i, Y = y + j;
    if (X < 0 || Y < 0 || X >= G.W || Y >= G.H) continue;
    const v = G.g[Y * G.W + X]; if (v >= 15) { s += v; n++; }
  }
  return { mean: n ? s / n : 0, n };
}

async function runNowcast(attempt = 1) {
  try {
    const d = await (await fetchWithTimeout("https://api.rainviewer.com/public/weather-maps.json", 15000)).json();
    const past = d.radar.past.slice(-13);         // até 2 h de imagens (1 a cada 10 min)
    const grids = await Promise.all(past.map(f => radarGrid(d.host, f.path)));
    const N = grids[grids.length - 1], newF = past[past.length - 1];
    // Movimento: compara a imagem mais nova com as de 10, 20 e 30 min antes e combina os três
    let sdx = 0, sdy = 0, sdt = 0;
    [2, 3, 4].forEach(k => {
      const i = past.length - k; if (i < 0) return;
      const s = estimateShift(grids[i].g, N.g, N.W, N.H);
      if (s) { sdx += s.dx; sdy += s.dy; sdt += (newF.time - past[i].time) / 60; }
    });
    const shift = sdt > 0;
    const vx = shift ? sdx / sdt : 0, vy = shift ? sdy / sdt : 0; // pixels por minuto
    const speed = Math.hypot(vx, vy) * PX_KM * 60;
    const ageMin = Math.max(0, Math.round((Date.now() / 1000 - newF.time) / 60));
    radarMotion = { time: new Date(newF.time * 1000), ageMin, speed,
      from: shift && speed >= 5 ? dirName(Math.atan2(-vx, vy) * 180 / Math.PI) : null };
    radarVec = shift && speed >= 5 ? { vx, vy } : null;
    radarLatest = { cv: N.cv, ox: N.ox, oy: N.oy };
    rvFuture = shift ? { url: N.cv.toDataURL(), ox: N.ox, oy: N.oy, W: N.W, H: N.H, vx, vy,
      t0: newF.time * 1000, speed, from: radarMotion.from } : null;
    buildFuture();

    const R50 = Math.round(50 / PX_KM); // 50 km em pixels
    const i20 = Math.max(0, past.length - 3), dt20 = (newF.time - past[i20].time) / 60;
    CITIES.forEach(c => {
      const cx = lonToX(c.lon) - N.ox, cy = latToY(c.lat) - N.oy;
      const up = k => [cx - vx * k, cy - vy * k]; // onde está hoje a chuva que chega daqui k min

      // 1) próximas 2 h minuto a minuto: 4 blocos de 30 min, início, fim e mm
      // bloco = null quando a chuva que chegaria ainda está fora da área que o radar enxerga
      const blocks = [0, 0, 0, 0], v = [];
      const blockOf = t => Math.floor(t / 30);
      const inside = (x, y) => x >= 3 && y >= 3 && x < N.W - 3 && y < N.H - 3;
      let firstMin = null, firstDbz = 0, mm = 0;
      for (let t = 0; t < 125; t++) {
        const [x, y] = up(t + ageMin);
        v[t] = inside(x, y) ? sampleGrid(N, x, y, 2, "max") : null;
        if (t >= 120) continue;
        const b = blockOf(t);
        if (v[t] == null) { blocks[b] = null; continue; }
        if (blocks[b] != null) blocks[b] = Math.max(blocks[b], v[t]);
        if (t < 60) mm += dbzToMmH(sampleGrid(N, x, y, 1, "mean")) / 60;
        if (v[t] >= 15 && firstMin == null) firstMin = t;
        if (firstMin != null && t < firstMin + 15) firstDbz = Math.max(firstDbz, v[t]);
      }
      // fim: primeiro momento após o início com 5 min seguidos sem chuva
      let endMin = null;
      if (firstMin != null) for (let t = firstMin + 1; t < 120; t++) {
        const w = v.slice(t, t + 5);
        if (w.every(x => x != null && x < 15)) { endMin = t; break; }
      }

      // 3) fortalecendo ou enfraquecendo: a chuva que chega em ~15 min, agora x 20 min atrás
      let trend = null;
      if (radarVec) {
        const [px, py] = up(ageMin + 15);
        const now = rainMean(N, px, py, 8), before = rainMean(grids[i20], px - vx * dt20, py - vy * dt20, 8);
        if (now.n >= 15 && before.n >= 15) {
          const dd = now.mean - before.mean;
          trend = dd >= 3 ? "up" : dd <= -3 ? "down" : "same";
        }
      }

      // 4) chuva estimada nas últimas 2 h sobre a cidade
      let pastMm = 0;
      grids.forEach((G, i) => {
        const dtm = i < grids.length - 1 ? (past[i + 1].time - past[i].time) / 60 : 10;
        pastMm += dbzToMmH(sampleGrid(G, cx, cy, 1, "mean")) * dtm / 60;
      });
      const pastHours = Math.round((newF.time - past[0].time) / 3600 + 1 / 6);

      // 2) chuva mais próxima, 5) célula forte (≥ 45 dBZ) até 50 km e 9) chuva espalhada ou isolada
      let best = null, cell = null, wet = 0, tot = 0;
      const R = 113; // ~120 km
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const X = Math.round(cx) + i, Y = Math.round(cy) + j;
        if (X < 0 || Y < 0 || X >= N.W || Y >= N.H) continue;
        const val = N.g[Y * N.W + X], dist = Math.hypot(i, j);
        if (dist <= R50) { tot++; if (val >= 15) wet++; }
        if (val < 15 || dist > R) continue;
        if (!best || dist < best.dist) best = { dist, i, j };
        if (val >= 45 && dist <= R50) {
          if (!cell || dist < cell.dist) cell = { dist, i, j, max: Math.max(val, cell?.max || 0) };
          else cell.max = Math.max(cell.max, val);
        }
      }
      if (cell) { // chega à cidade? procura quando a parte forte passa sobre ela
        cell.km = cell.dist * PX_KM;
        cell.dir = dirName(Math.atan2(cell.i, -cell.j) * 180 / Math.PI);
        cell.eta = null;
        for (let t = 0; t < 90; t++) { const [x, y] = up(t + ageMin); if (sampleGrid(N, x, y, 3, "max") >= 45) { cell.eta = t; break; } }
      }

      nowcast[c.id] = { blocks, firstMin, firstDbz, endMin, mm, trend, pastMm, pastHours, cell,
        spread: tot ? wet / tot : 0,
        nearKm: best ? best.dist * PX_KM : null,
        nearDir: best ? dirName(Math.atan2(best.i, -best.j) * 180 / Math.PI) : null };
    });
  } catch (e) {
    console.error(e);
    // falha de rede passageira: tenta mais uma vez sozinho antes de mostrar o erro
    if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); return runNowcast(attempt + 1); }
    CITIES.forEach(c => nowcast[c.id] = { error: true });
    radarMotion = null;
  }
  renderRadarMotion();
}

// ----- 8) Mini-radar: recorte de ~70 km em volta da cidade, com mapa de fundo e seta -----
const osmCache = new Map();
function osmTile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (!osmCache.has(k)) {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.src = `https://tile.openstreetmap.org/${k}.png`;
    osmCache.set(k, img.decode().then(() => img).catch(() => null));
  }
  return osmCache.get(k);
}

// span = largura do recorte em pixels do mapa no zoom 8 (128 ≈ 68 km; 192 ≈ 100 km)
async function drawMini(cv, c, span = 128) {
  if (!cv || !radarLatest) return;
  const ctx = cv.getContext("2d"), S = cv.width, h = span / 2;
  const cx8 = lonToX(c.lon) * 2, cy8 = latToY(c.lat) * 2, x0 = cx8 - h, y0 = cy8 - h, sc = S / span;
  const tiles = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + span) / 256); tx++)
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + span) / 256); ty++)
      tiles.push(osmTile(8, tx, ty).then(img => img && ctx.drawImage(img, (tx * 256 - x0) * sc, (ty * 256 - y0) * sc, 256 * sc, 256 * sc)));
  ctx.fillStyle = "#e8eef3"; ctx.fillRect(0, 0, S, S);
  await Promise.all(tiles);
  // chuva (zoom 7) por cima do mapa
  const r = radarLatest, sx = lonToX(c.lon) - r.ox - h / 2, sy = latToY(c.lat) - r.oy - h / 2;
  ctx.globalAlpha = 0.8; ctx.imageSmoothingEnabled = true;
  ctx.drawImage(r.cv, sx, sy, h, h, 0, 0, S, S);
  ctx.globalAlpha = 1;
  // seta: de onde vem a chuva até a cidade
  if (radarVec) {
    const L = Math.hypot(radarVec.vx, radarVec.vy), ux = radarVec.vx / L, uy = radarVec.vy / L;
    const k = S / 256; // traços proporcionais ao tamanho do canvas
    const ex = S / 2 - ux * 16 * k, ey = S / 2 - uy * 16 * k, bx = S / 2 - ux * 96 * k, by = S / 2 - uy * 96 * k;
    ctx.strokeStyle = "#111"; ctx.fillStyle = "#111"; ctx.lineWidth = 5 * k; ctx.setLineDash([10 * k, 8 * k]);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ex + ux * 6 * k, ey + uy * 6 * k);
    ctx.lineTo(ex - (ux * 14 + uy * 10) * k, ey - (uy * 14 - ux * 10) * k); ctx.lineTo(ex - (ux * 14 - uy * 10) * k, ey - (uy * 14 + ux * 10) * k);
    ctx.closePath(); ctx.fill();
  }
  // cidade
  const k2 = S / 256;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, 10 * k2, 0, 7); ctx.fillStyle = c.color; ctx.fill();
  ctx.lineWidth = 4 * k2; ctx.strokeStyle = "#fff"; ctx.stroke();
  ctx.font = `${16 * k2}px system-ui, sans-serif`; ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.textAlign = "right"; ctx.fillText("© OpenStreetMap", S - 8 * k2, S - 8 * k2); ctx.textAlign = "left";
}

// Mini-radar ampliado numa janela (abre ao tocar no mini-radar do cartão)
function openMini() {
  const c = CITIES.find(x => x.id === selected), dlg = document.getElementById("miniDlg");
  dlg.querySelector("h3").textContent = `Radar em volta de ${c.name}`;
  dlg.querySelector(".mini-dot").style.background = c.color;
  dlg.querySelector(".ct-time").style.backgroundImage = `url('${frames[1]}')`;
  dlg.showModal();
  ctCrop(dlg.querySelector(".ct-big"), c, 670); // ~200 km
}

function renderRadarMotion() {
  const el = document.getElementById("radarMotion");
  // esta linha é do RainViewer: só aparece na aba RainViewer (na Climatempo confundia)
  el.hidden = src !== "rv";
  if (!radarMotion) { el.textContent = ""; return; }
  const m = radarMotion;
  const mov = m.from ? ` · chuva andando de <b>${m.from}</b> para <b>${toDir(m.from)}</b> a ~${Math.round(m.speed)} km/h`
    : " · movimento da chuva: parado ou chuva insuficiente para estimar";
  el.innerHTML = `${uIcon("compass")} Radar RainViewer · imagem <b>${atAgo(m.time)}</b>${mov}`;
}
