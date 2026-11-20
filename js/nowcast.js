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
const DIRS = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
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
    jobs.push(img.decode().then(() => ctx.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE)).catch(() => {}));
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

async function runNowcast() {
  try {
    const d = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    const past = d.radar.past;
    // Compara a imagem mais nova com as de 10, 20 e 30 min antes e combina os três deslocamentos:
    // um par só pode errar bastante a velocidade (ex.: 64 x 90 km/h).
    const newF = past[past.length - 1];
    const olds = [2, 3, 4].map(k => past[past.length - k]).filter(Boolean);
    const [N, ...O] = await Promise.all([newF, ...olds].map(f => radarGrid(d.host, f.path)));
    let sdx = 0, sdy = 0, sdt = 0;
    olds.forEach((f, k) => {
      const s = estimateShift(O[k].g, N.g, N.W, N.H);
      if (s) { sdx += s.dx; sdy += s.dy; sdt += (newF.time - f.time) / 60; }
    });
    const shift = sdt > 0;
    const vx = shift ? sdx / sdt : 0, vy = shift ? sdy / sdt : 0; // pixels por minuto
    const speed = Math.hypot(vx, vy) * PX_KM * 60;
    const ageMin = Math.max(0, Math.round((Date.now() / 1000 - newF.time) / 60));
    radarMotion = { time: new Date(newF.time * 1000), ageMin, speed,
      from: shift && speed >= 5 ? dirName(Math.atan2(-vx, vy) * 180 / Math.PI) : null };
    // guarda a imagem mais nova e o vetor de movimento para desenhar a previsão no mapa
    rvFuture = shift ? { url: N.cv.toDataURL(), ox: N.ox, oy: N.oy, W: N.W, H: N.H, vx, vy,
      t0: newF.time * 1000, speed, from: radarMotion.from } : null;
    buildFuture();

    const at = (x, y, r = 2) => { // maior dBZ num raio de r pixels
      let m = 0; x = Math.round(x); y = Math.round(y);
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const X = x + i, Y = y + j;
        if (X >= 0 && Y >= 0 && X < N.W && Y < N.H) m = Math.max(m, N.g[Y * N.W + X]);
      }
      return m;
    };
    CITIES.forEach(c => {
      const cx = lonToX(c.lon) - N.ox, cy = latToY(c.lat) - N.oy;
      // 1) tendência: a chuva que chega daqui t min está hoje "rio acima" no vetor de movimento
      const blocks = [0, 0, 0, 0];
      let firstMin = null, firstDbz = 0;
      for (let t = 0; t < 60; t++) {
        const k = t + ageMin;
        const v = at(cx - vx * k, cy - vy * k);
        blocks[Math.floor(t / 15)] = Math.max(blocks[Math.floor(t / 15)], v);
        if (v >= 15 && firstMin == null) firstMin = t;
        if (firstMin != null && t < firstMin + 15) firstDbz = Math.max(firstDbz, v);
      }
      // 2) chuva mais próxima na imagem mais recente
      let best = null;
      const R = 113; // ~120 km
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const X = Math.round(cx) + i, Y = Math.round(cy) + j;
        if (X < 0 || Y < 0 || X >= N.W || Y >= N.H || N.g[Y * N.W + X] < 15) continue;
        const dist = Math.hypot(i, j);
        if (dist <= R && (!best || dist < best.dist)) best = { dist, i, j };
      }
      nowcast[c.id] = { blocks, firstMin, firstDbz,
        nearKm: best ? best.dist * PX_KM : null,
        nearDir: best ? dirName(Math.atan2(best.i, -best.j) * 180 / Math.PI) : null };
    });
  } catch (e) {
    console.error(e);
    CITIES.forEach(c => nowcast[c.id] = { error: true });
    radarMotion = null;
  }
  renderRadarMotion();
}

function renderRadarMotion() {
  const el = document.getElementById("radarMotion");
  if (!radarMotion) { el.textContent = ""; return; }
  const m = radarMotion;
  const mov = m.from ? ` · chuva vindo do <b>${m.from}</b> a <b>${Math.round(m.speed)} km/h</b>`
    : " · movimento da chuva: parado ou chuva insuficiente para estimar";
  el.innerHTML = `🧭 Radar RainViewer · imagem das <b>${hhmm(m.time)}</b> (${m.ageMin} min atrás)${mov}`;
}

