// ===================== Avisos oficiais do INMET =====================
// Lista de avisos ativos (hoje e próximos dias). Cada aviso traz os códigos IBGE dos
// municípios atingidos; o cartão mostra os da cidade escolhida.
let inmet = null; // null = ainda carregando; [] = sem avisos ou falhou
let inmetErr = false;
const INMET_LVL = { "Perigo Potencial": [1, "amarelo"], "Perigo": [2, "laranja"], "Grande Perigo": [3, "vermelho"] };
const parseInmet = s => new Date(s.trim().replace(" ", "T") + ":00-03:00"); // horário de Brasília

async function loadInmet() {
  try {
    const r = await (await fetchWithTimeout("https://apiprevmet3.inmet.gov.br/avisos/ativos", 15000)).json();
    inmet = [...(r.hoje || []), ...(r.futuro || [])].map(a => {
      const [lvl, cor] = INMET_LVL[a.severidade] || [1, "amarelo"];
      return { id: a.id_aviso, what: a.descricao, sev: a.severidade, lvl, cor, color: a.aviso_cor,
        start: parseInmet(a.inicio), end: parseInmet(a.fim), geo: new Set(String(a.geocodes).split(",")),
        riscos: a.riscos, instr: a.instrucoes };
    });
    inmetErr = false;
  } catch (e) {
    inmetErr = true;
    if (!inmet) inmet = [];
    console.error("INMET", e);
  }
}

// Avisos da cidade: primeiro os que já valem (o mais grave antes), depois os próximos
function inmetFor(c) {
  if (!inmet) return [];
  const now = new Date();
  return inmet.filter(a => a.geo.has(String(c.ibge)) && a.end > now)
    .sort((a, b) => (a.start > now) - (b.start > now) || b.lvl - a.lvl || a.start - b.start);
}

const dayTime = d => {
  const today = new Date(), tom = new Date(Date.now() + 86400e3);
  const day = d.toDateString() === today.toDateString() ? "hoje" : d.toDateString() === tom.toDateString() ? "amanhã"
    : d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return `${day} ${hhmm(d)}`;
};

function inmetHtml(c) {
  if (inmet === null) return "";
  const list = inmetFor(c);
  if (!list.length) return inmetErr ? "" : `<div class="inmet none">${uIcon("check")} Sem avisos do INMET para ${c.name}</div>`;
  const now = new Date();
  // o INMET costuma sobrepor amarelo e laranja do mesmo fenômeno: fica só o mais grave;
  // dos avisos futuros, só o próximo
  const seen = new Set(), show = [];
  list.filter(a => a.start <= now).forEach(a => { if (!seen.has(a.what)) { seen.add(a.what); show.push(a); } });
  const next = list.find(a => a.start > now);
  if (next) show.push(next);
  const rows = show.map(a => {
    const active = a.start <= now;
    const when = active ? `até ${dayTime(a.end)}` : `de ${dayTime(a.start)} até ${dayTime(a.end)}`;
    const id = `inmet-${a.id}`;
    return `<div class="inmet${active ? "" : " next"}" style="--ac:${a.color}">
      <span class="inmet-sq"></span>
      <div><b>${active ? "Aviso do INMET" : "Próximo aviso"}: ${a.what}</b> — ${a.sev} (${a.cor}) · ${when}
        ${infoBtn(id).replace('class="ibtn"', 'class="ibtn always"')}
        <a href="https://alertas2.inmet.gov.br/${a.id}" target="_blank" rel="noopener">ver no INMET</a>
        <div id="${id}" class="muted all-info${openInfo.has(id) ? " show" : ""}">${a.riscos}</div></div>
    </div>`;
  });
  return rows.join("");
}
