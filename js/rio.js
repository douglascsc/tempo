// ===================== Rio dos Sinos (ANA) =====================
// Estações telemétricas da ANA: nível (cm), vazão e chuva a cada 5–15 min.
// A principal é Campo Bom (87380000). As outras mostram o rio acima (a água que ainda vai
// chegar) e abaixo. Algumas usam outra referência de altura, por isso nelas vale a VARIAÇÃO.
const RIVER_STATION = "87380000";
const FLOOD_CM = 680; // cota de inundação em Campo Bom: 6,80 m
const RIVER_OTHERS = [
  { code: "87318700", name: "Caraá",             where: "nascente do Sinos",      up: true },
  { code: "87351000", name: "Rolante",           where: "Rio Rolante (afluente)", up: true },
  { code: "87377500", name: "Araricá/Sapiranga", where: "logo acima de Campo Bom", up: true },
  { code: "87382000", name: "São Leopoldo",      where: "abaixo de Campo Bom",    up: false },
  { code: "87385010", name: "Esteio",            where: "perto de Sapucaia",      up: false },
];
const RISE_ALERT_CM = 20; // subida em 6 h rio acima que dispara o aviso
let riverOpen = !matchMedia("(max-width: 600px)").matches; // no celular a tabela começa fechada

const dmy = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const fmtCm = v => `${v > 0 ? "+" : ""}${Math.round(v)} cm`;
const fmtM = cm => (cm / 100).toFixed(2).replace(".", ",");

async function fetchStation(code, days, timeoutMs = 20000) {
  const end = new Date(), start = new Date(Date.now() - days * 86400e3);
  const url = `https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos?codEstacao=${code}&dataInicio=${dmy(start)}&dataFim=${dmy(end)}`;
  // tempo limite: uma estação lenta não pode travar o cartão inteiro
  const xml = new DOMParser().parseFromString(await (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).text(), "text/xml");
  const rows = [...xml.getElementsByTagName("DadosHidrometereologicos")].map(r => ({
    t: new Date(r.getElementsByTagName("DataHora")[0]?.textContent.trim().replace(" ", "T")),
    lvl: parseFloat(r.getElementsByTagName("Nivel")[0]?.textContent),
    rain: parseFloat(r.getElementsByTagName("Chuva")[0]?.textContent),
  })).filter(r => !isNaN(r.lvl) && !isNaN(r.t)).sort((a, b) => a.t - b.t);
  if (!rows.length) throw new Error("sem leituras recentes");
  return rows;
}

// O servidor da ANA às vezes falha por um instante: tenta de novo (após 3 s e 6 s)
// antes de mostrar "sem dados agora". Se a estação não tem leituras, não adianta repetir.
async function fetchStationRetry(code, days, timeoutMs, waits = [3000, 6000]) {
  for (let i = 0; ; i++) {
    try { return await fetchStation(code, days, timeoutMs); }
    catch (e) {
      if (i >= waits.length || e.message === "sem leituras recentes") throw e;
      await new Promise(r => setTimeout(r, waits[i]));
    }
  }
}

// Nível atual, variação em 6 h e 24 h e tendência
function riverStats(rows, stableCm = 3) {
  const last = rows[rows.length - 1];
  const at = hoursAgo => { // leitura mais próxima de X horas antes da última
    const target = last.t - hoursAgo * 3600e3;
    return rows.reduce((a, b) => (Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a));
  };
  const d6 = last.lvl - at(6).lvl, d24 = last.lvl - at(24).lvl;
  const trend = Math.abs(d6) < stableCm ? [uIcon("right"), "estável"] : d6 > 0 ? [uIcon("up"), "subindo"] : [uIcon("down"), "baixando"];
  return { last, d6, d24, trend, age: Math.round((Date.now() - last.t) / 60000) };
}

async function loadRiver() {
  const box = document.getElementById("river");
  const [main, ...others] = await Promise.allSettled([
    fetchStationRetry(RIVER_STATION, 3, 30000), ...RIVER_OTHERS.map(s => fetchStationRetry(s.code, 2, 15000)),
  ]);
  if (main.status !== "fulfilled") {
    box.innerHTML = `<h2>${uIcon("wave", "u-ic h-ic")}Rio dos Sinos em Campo Bom</h2><div class="muted">Não foi possível buscar os dados da ANA (${main.reason.message}). <button class="linkbtn" onclick="loadRiver()">Tentar de novo</button></div>`;
    return;
  }
  renderRiver(main.value, others.map((r, i) => ({ ...RIVER_OTHERS[i], stats: r.status === "fulfilled" ? riverStats(r.value, 5) : null })));
}

function renderRiver(rows, others) {
  const s = riverStats(rows);
  const last = s.last;
  const rain24 = rows.filter(r => r.t > last.t - 24 * 3600e3).reduce((acc, r) => acc + (r.rain || 0), 0);

  // mini gráfico dos últimos 3 dias
  const W = 600, H = 70, min = Math.min(...rows.map(r => r.lvl)), max = Math.max(...rows.map(r => r.lvl));
  const t0 = rows[0].t, t1 = last.t, span = Math.max(1, max - min);
  const yOf = v => H - 6 - (v - min) / span * (H - 12);
  const ticks = [max, (max + min) / 2, min]; // eixo Y: máximo, meio e mínimo
  const yAxis = ticks.map(v => `<span style="top:${yOf(v).toFixed(1)}px">${fmtM(v)} m</span>`).join("");
  const grid = ticks.map(v => `<line x1="0" x2="${W}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}"/>`).join("");
  const pts = rows.map(r => `${((r.t - t0) / (t1 - t0 || 1) * W).toFixed(1)},${(H - 6 - (r.lvl - min) / span * (H - 12)).toFixed(1)}`).join(" ");

  // aviso antecipado: água subindo rio acima tende a chegar a Campo Bom horas depois
  const rising = others.filter(o => o.up && o.stats && o.stats.d6 >= RISE_ALERT_CM);
  const upAlert = rising.length
    ? `<div class="alert lv1">${uIcon("alert")} <b>Rio subindo rio acima</b> (${rising.map(o => `${o.name} ${fmtCm(o.stats.d6)} em 6 h`).join(", ")}): o nível em Campo Bom tende a subir nas próximas horas.</div>`
    : "";

  const table = `<table class="rtable">
    <thead><tr><th>Estação</th><th>Tendência</th><th>6 h</th><th>24 h</th><th>Leitura</th></tr></thead>
    <tbody>${others.map(o => o.stats ? `<tr>
        <td><b>${o.name}</b><div class="muted">${o.up ? uIcon("up") + " rio acima" : uIcon("down") + " rio abaixo"} · ${o.where}</div></td>
        <td>${o.stats.trend[0]} ${o.stats.trend[1]}</td>
        <td>${fmtCm(o.stats.d6)}</td><td>${fmtCm(o.stats.d24)}</td>
        <td class="muted">${hhmm(o.stats.last.t)}</td></tr>`
      : `<tr><td><b>${o.name}</b></td><td colspan="4" class="muted">sem dados agora</td></tr>`).join("")}
    </tbody></table>`;

  document.getElementById("river").innerHTML = `
    <h2>${uIcon("wave", "u-ic h-ic")}Rio dos Sinos em Campo Bom</h2>
    <div class="river-grid">
      <div><div class="big">${fmtM(last.lvl)} m</div><div class="muted">nível ${atAgo(last.t)}</div></div>
      <div><div class="big">${s.trend[0]} ${s.trend[1]}</div><div class="muted">${fmtCm(s.d6)} em 6 h · ${fmtCm(s.d24)} em 24 h</div></div>
      <div><div class="big">${fmtMm(rain24)} mm</div><div class="muted">chuva medida na estação em 24 h</div></div>
    </div>
    <div class="flood">
      <div class="flood-txt">Cota de inundação: <b>6,80 m</b> · ${last.lvl >= FLOOD_CM
        ? `<b class="flood-over">${uIcon("alert")} acima da cota em ${fmtM(last.lvl - FLOOD_CM)} m</b>`
        : `faltam <b>${fmtM(FLOOD_CM - last.lvl)} m</b> (${Math.round(last.lvl / FLOOD_CM * 100)}% da cota)`}</div>
      <div class="flood-bar"><div style="width:${Math.min(100, last.lvl / FLOOD_CM * 100)}%;background:${last.lvl >= FLOOD_CM ? "#e5534b" : last.lvl >= FLOOD_CM * 0.8 ? "#d4a72c" : "var(--accent)"}"></div></div>
    </div>
    <div class="spark-wrap"><div class="spark-y" aria-hidden="true">${yAxis}</div>
      <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Nível do rio nos últimos 3 dias, de ${fmtM(min)} m a ${fmtM(max)} m">${grid}<polyline points="${pts}"/></svg></div>
    <div class="muted">Últimos 3 dias · de ${fmtM(min)} m a ${fmtM(max)} m</div>
    ${upAlert}
    <details class="rdet" ${riverOpen ? "open" : ""} ontoggle="riverOpen = this.open">
      <summary class="rh3">Ao longo do rio</summary>
      <div class="rwrap">${table}</div>
      <div class="muted">Nas outras estações a referência de altura é diferente da de Campo Bom, por isso aparece só a variação.</div>
    </details>
    ${srcLine(`nível e chuva medidos pelas estações da <a href="https://www.snirh.gov.br/hidrotelemetria/" target="_blank" rel="noopener">ANA</a> (Campo Bom: ${RIVER_STATION}) ·
      cota de inundação de 6,80 m informada para Campo Bom · tendência calculada por este site · em emergência, siga a Defesa Civil`)}`;
}
