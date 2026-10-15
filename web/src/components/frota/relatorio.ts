// ═══════════════════════════════════════════════════════════════
// Relatório do plantão (07h–19h / 19h–07h): quanto tempo cada equipe passou
// parada em porta de hospital ou UPA. Página HTML sozinha (abre em aba nova,
// salva e imprime), montada no navegador com o que GET /frota/linha-do-tempo
// devolve — nada novo no servidor. Só GPS, nome de viatura e minuto: sem
// paciente, protocolo nem médico.
//
// Cores: azul/âmbar/vermelho = duração da parada (as mesmas da linha do
// tempo; claro e escuro validados no dataviz). Hospital × UPA = azul × verde.
// Todo número vem escrito — a cor nunca é a única pista.
// ═══════════════════════════════════════════════════════════════
import type { LinhaDoTempoFrota } from "../../lib/types";
import { duracao, hora } from "./formato";

const H = 3_600_000;
const FUSO_MS = -3 * H; // America/Bahia, sem horário de verão
const PLANTAO_MS = 12 * H;
/** Parada mais curta que isto é passagem, não porta (a mesma régua do histórico). */
const MIN_PARADA = 10;
const JANELA_MAX_H = 72; // limite de /frota/linha-do-tempo

export interface Plantao {
  ini: number;
  fim: number;
  rotulo: string;
  curto: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function descrever(ini: number): Plantao {
  const d = new Date(ini + FUSO_MS);
  const diurno = d.getUTCHours() === 7;
  const dia = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
  return {
    ini,
    fim: ini + PLANTAO_MS,
    rotulo: `Plantão ${diurno ? "diurno" : "noturno"} de ${dia} · ${diurno ? "07h às 19h" : "19h às 07h"}`,
    curto: `${dia} ${diurno ? "dia" : "noite"}`,
  };
}

/** O plantão de agora e os anteriores que ainda cabem na janela da API. */
export function plantoes(agora = Date.now()): Plantao[] {
  const local = agora + FUSO_MS;
  let ini = Math.floor((local - 7 * H) / PLANTAO_MS) * PLANTAO_MS + 7 * H - FUSO_MS;
  const lista: Plantao[] = [];
  while (agora - ini <= JANELA_MAX_H * H) {
    lista.push(descrever(ini));
    ini -= PLANTAO_MS;
  }
  return lista;
}

/** Horas que a linha do tempo precisa cobrir para pegar o plantão inteiro. */
export function horasPara(p: Plantao, agora = Date.now()): number {
  return Math.min(JANELA_MAX_H, Math.max(1, Math.ceil((agora - p.ini) / H)));
}

// ── Dados ─────────────────────────────────────────────────────────

type Faixa = "curta" | "chegando" | "longa";

interface Linha {
  id: number;
  nome: string;
  tipo: string | null;
  base: string | null;
  local: string;
  upa: boolean;
  /** Recortada no plantão. */
  ini: number;
  fim: number;
  min: number;
  /** A parada inteira, mesmo a parte fora do plantão. */
  total: number;
  entrada: number;
  saida: number;
  aberta: boolean;
  antes: boolean;
  faixa: Faixa;
}

function montar(data: LinhaDoTempoFrota, p: Plantao, agora: number): Linha[] {
  const locais = new Map(data.hospitais.map((h) => [h.id, h]));
  const corte = Math.min(p.fim, agora);
  return data.paradas
    .filter((x) => !x.naBase && locais.has(x.hospitalId) && x.minutos >= MIN_PARADA)
    .map((x): Linha => {
      const entrada = Date.parse(x.entrada);
      const saida = Date.parse(x.fim);
      const ini = Math.max(entrada, p.ini);
      const fim = Math.min(saida, corte);
      const l = locais.get(x.hospitalId)!;
      return {
        id: x.id, nome: x.nome, tipo: x.tipo, base: x.base, local: l.nome, upa: l.tipo === "upa",
        ini, fim, min: Math.round((fim - ini) / 60_000), total: x.minutos, entrada, saida,
        aberta: x.aberta && saida >= agora - 5 * 60_000 && p.fim > agora,
        antes: entrada < p.ini,
        faixa: x.minutos >= data.alertaMin ? "longa" : x.minutos >= data.alertaMin - 10 ? "chegando" : "curta",
      };
    })
    .filter((l) => l.min > 0)
    .sort((a, b) => a.ini - b.ini);
}

// ── HTML ──────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hm = (t: number) => hora(new Date(t).toISOString());
/** Nome de local que não cabe na coluna do rótulo ("6º Centro Rodrigo Argollo"). */
const corta = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const um = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** "2 h 05" em vez de "2 h" — no relatório o minuto importa. */
function tempo(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${pad(min % 60)}`;
}

function quem(l: Pick<Linha, "nome" | "tipo" | "base">): string {
  return l.tipo ? `${l.nome} (${l.tipo}${l.base ? ` · ${l.base}` : ""})` : l.nome;
}

function dica(l: Linha): string {
  const parte = l.antes ? ` (entrou ${hm(l.entrada)}, antes do plantão)` : "";
  const fim = l.aberta ? "ainda lá" : `saiu ${hm(l.saida)}`;
  return `${quem(l)} — ${l.local}: ${hm(l.ini)} a ${l.aberta ? "agora" : hm(l.fim)}${parte} · ${tempo(l.total)} · ${fim}`;
}

/** Marca com dica: <title> nativo + data-tip para o balão. */
function marca(svg: string, tip: string): string {
  return `<g data-tip="${esc(tip)}" tabindex="0"><title>${esc(tip)}</title>${svg}</g>`;
}

const W = 1000;

function eixoHoras(p: Plantao, x0: number, x1: number, y: number, altura: number): string {
  const x = (t: number) => x0 + ((t - p.ini) / PLANTAO_MS) * (x1 - x0);
  let s = "";
  for (let i = 0; i <= 12; i++) {
    const t = p.ini + i * H;
    const xi = x(t);
    s += `<line x1="${xi}" x2="${xi}" y1="${y}" y2="${y + altura}" class="grade${i % 3 ? "" : " forte"}"/>`;
    if (i % 2 === 0 || i === 12) s += `<text x="${xi}" y="${y - 6}" class="eixo" text-anchor="middle">${hm(t).slice(0, 2)}h</text>`;
  }
  return s;
}

function linhaAgora(p: Plantao, agora: number, x0: number, x1: number, y0: number, y1: number): string {
  if (agora >= p.fim) return "";
  const xa = x0 + ((agora - p.ini) / PLANTAO_MS) * (x1 - x0);
  return `<line x1="${xa}" x2="${xa}" y1="${y0}" y2="${y1}" class="agora"/><text x="${xa + 4}" y="${y0 + 10}" class="eixo agora-txt">agora ${hm(agora)}</text>`;
}

/** 1. Quanto das 12 h cada equipe passou em porta. Trilho = o plantão inteiro. */
function graficoEquipes(linhas: Linha[], p: Plantao, agora: number): string {
  const porEquipe = new Map<string, { l: Linha; hosp: number; upa: number; n: number; longas: number }>();
  for (const l of linhas) {
    const e = porEquipe.get(l.nome) ?? { l, hosp: 0, upa: 0, n: 0, longas: 0 };
    if (l.upa) e.upa += l.min;
    else e.hosp += l.min;
    e.n++;
    if (l.faixa === "longa") e.longas++;
    porEquipe.set(l.nome, e);
  }
  const equipes = [...porEquipe.values()].sort((a, b) => b.hosp + b.upa - (a.hosp + a.upa));
  if (!equipes.length) return `<p class="vazio">Nenhuma equipe parou ${MIN_PARADA} min ou mais em hospital ou UPA neste plantão.</p>`;
  const X0 = 92, X1 = 800, ROW = 30, BAR = 14, TOPO = 26;
  const total = 12 * 60;
  const decorrido = Math.min(PLANTAO_MS, agora - p.ini) / 60_000;
  const largura = (min: number) => (min / total) * (X1 - X0);
  const alt = TOPO + equipes.length * ROW + 6;
  // Grade a cada 10% do plantão, que é o que se lê aqui.
  let s = "";
  for (let i = 0; i <= 10; i++) {
    const xi = X0 + (i / 10) * (X1 - X0);
    s += `<line x1="${xi}" x2="${xi}" y1="${TOPO}" y2="${alt}" class="grade${i % 5 ? "" : " forte"}"/>`;
    if (i % 2 === 0) s += `<text x="${xi}" y="${TOPO - 8}" class="eixo" text-anchor="middle">${i * 10}%</text>`;
  }
  equipes.forEach((e, i) => {
    const y = TOPO + i * ROW + (ROW - BAR) / 2;
    const soma = e.hosp + e.upa;
    const wH = largura(e.hosp);
    const wU = largura(e.upa);
    const fracao = soma / decorrido;
    const partes = [
      e.hosp ? `${tempo(e.hosp)} em hospital` : "",
      e.upa ? `${tempo(e.upa)} em UPA` : "",
    ].filter(Boolean).join(" + ");
    const tip = `${quem(e.l)}: ${partes} · ${e.n} parada${e.n > 1 ? "s" : ""}${e.longas ? `, ${e.longas} de 40 min ou mais` : ""} · ${pct(soma / total)} das 12 h`;
    let barra = `<rect x="${X0}" y="${y}" width="${X1 - X0}" height="${BAR}" rx="4" class="trilho"/>`;
    if (wH) barra += `<rect x="${X0}" y="${y}" width="${Math.max(2, wH)}" height="${BAR}" rx="4" class="s-hosp"/>`;
    if (wU) barra += `<rect x="${X0 + wH + (wH ? 2 : 0)}" y="${y}" width="${Math.max(2, wU - (wH ? 2 : 0))}" height="${BAR}" rx="4" class="s-upa"/>`;
    barra += `<rect x="0" y="${TOPO + i * ROW}" width="${W}" height="${ROW}" class="alvo"/>`;
    s += marca(
      `<text x="${X0 - 10}" y="${y + BAR - 2}" class="rotulo" text-anchor="end">${esc(e.l.nome)}</text>${barra}` +
        `<text x="${X1 + 12}" y="${y + BAR - 2}" class="valor"><tspan class="forte-txt">${tempo(soma)}</tspan> · ${pct(soma / total)}${agora < p.fim ? ` <tspan class="mudo">(${pct(fracao)} do decorrido)</tspan>` : ""}</text>`,
      tip,
    );
  });
  if (agora < p.fim) {
    const xa = X0 + (decorrido / total) * (X1 - X0);
    s += `<line x1="${xa}" x2="${xa}" y1="${TOPO}" y2="${alt}" class="agora"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${alt}" role="img" aria-label="Tempo de cada equipe em porta, em proporção das 12 horas do plantão">${s}</svg>`;
}

/** 2. O plantão hora a hora: cada parada é uma fatia do tamanho do tempo que durou. */
function graficoLinhaDoTempo(linhas: Linha[], data: LinhaDoTempoFrota, p: Plantao, agora: number): string {
  const ordem = data.hospitais.map((h) => h.nome);
  const locais = [...new Set(linhas.map((l) => l.local))].sort((a, b) => {
    const ua = linhas.find((l) => l.local === a)!.upa;
    const ub = linhas.find((l) => l.local === b)!.upa;
    return Number(ua) - Number(ub) || ordem.indexOf(a) - ordem.indexOf(b);
  });
  if (!locais.length) return "";
  const X0 = 200, X1 = 990, FX = 22, BLOCO = 18, PAD = 7, TOPO = 30;
  const x = (t: number) => X0 + ((t - p.ini) / PLANTAO_MS) * (X1 - X0);
  let y = TOPO;
  let corpo = "";
  locais.forEach((nome, i) => {
    const doLocal = linhas.filter((l) => l.local === nome);
    const fins: number[] = [];
    const comFaixa = doLocal.map((l) => {
      let f = fins.findIndex((t) => t <= l.ini);
      if (f < 0) f = fins.length;
      fins[f] = l.fim;
      return { l, f };
    });
    const altura = Math.max(1, fins.length) * FX + PAD * 2;
    if (i % 2 === 0) corpo += `<rect x="0" y="${y}" width="${W}" height="${altura}" class="zebra"/>`;
    const soma = doLocal.reduce((a, l) => a + l.min, 0);
    corpo += `<text x="${X0 - 12}" y="${y + PAD + 13}" class="rotulo" text-anchor="end">${esc(corta(nome))}</text>`;
    corpo += `<text x="${X0 - 12}" y="${y + PAD + 27}" class="mudo-svg" text-anchor="end">${tempo(soma)} · ${doLocal.length}×</text>`;
    for (const { l, f } of comFaixa) {
      const bx = x(l.ini);
      const bw = Math.max(3, x(l.fim) - bx);
      const by = y + PAD + f * FX + (FX - BLOCO) / 2;
      let txt = "";
      if (bw >= 92) txt = `${esc(l.nome)} · ${tempo(l.total)}`;
      else if (bw >= 40) txt = esc(l.nome);
      corpo += marca(
        `<rect x="${bx}" y="${by}" width="${bw}" height="${BLOCO}" rx="4" class="b-${l.faixa} bloco"/>` +
          (l.antes ? `<rect x="${bx}" y="${by}" width="3" height="${BLOCO}" class="corte"/>` : "") +
          (txt ? `<text x="${bx + 6}" y="${by + 13}" class="no-bloco">${txt}</text>` : ""),
        dica(l),
      );
    }
    y += altura;
  });
  const grade = eixoHoras(p, X0, X1, TOPO, y - TOPO);
  return `<div class="rolagem"><svg viewBox="0 0 ${W} ${y + 4}" class="largo" role="img" aria-label="Paradas ao longo do plantão, por hospital">${grade}${corpo}${linhaAgora(p, agora, X0, X1, TOPO, y)}</svg></div>`;
}

/** 3. Os maiores tempos, do mais longo para baixo. */
function graficoMaiores(linhas: Linha[]): string {
  const top = [...linhas].sort((a, b) => b.total - a.total).slice(0, 12);
  if (!top.length) return "";
  const X0 = 300, X1 = 800, ROW = 32, BAR = 16;
  const max = Math.max(...top.map((l) => l.total));
  let s = "";
  top.forEach((l, i) => {
    const y = i * ROW + (ROW - BAR) / 2;
    const w = Math.max(3, (l.total / max) * (X1 - X0));
    s += marca(
      `<rect x="0" y="${i * ROW}" width="${W}" height="${ROW}" class="alvo"/>` +
        `<text x="0" y="${y + 12}" class="pos">${i + 1}</text>` +
        `<text x="26" y="${y + 12}" class="rotulo"><tspan class="forte-txt">${esc(l.nome)}</tspan> <tspan class="mudo">${esc(l.local)}</tspan></text>` +
        `<rect x="${X0}" y="${y}" width="${w}" height="${BAR}" rx="4" class="b-${l.faixa}"/>` +
        `<text x="${X0 + w + 10}" y="${y + 12}" class="valor"><tspan class="forte-txt">${tempo(l.total)}</tspan> · ${hm(l.entrada)}–${l.aberta ? "agora" : hm(l.saida)}</text>`,
      dica(l),
    );
  });
  return `<svg viewBox="0 0 ${W} ${top.length * ROW}" role="img" aria-label="As paradas mais longas do plantão">${s}</svg>`;
}

/** 4. Tempo somado por local, com quantas passaram de 40 min. */
function graficoLocais(linhas: Linha[], alertaMin: number): string {
  const por = new Map<string, { upa: boolean; min: number; n: number; longas: number; equipes: Set<string> }>();
  for (const l of linhas) {
    const e = por.get(l.local) ?? { upa: l.upa, min: 0, n: 0, longas: 0, equipes: new Set<string>() };
    e.min += l.min;
    e.n++;
    if (l.faixa === "longa") e.longas++;
    e.equipes.add(l.nome);
    por.set(l.local, e);
  }
  const locais = [...por.entries()].sort((a, b) => b[1].min - a[1].min);
  if (!locais.length) return "";
  const X0 = 190, X1 = 700, ROW = 30, BAR = 14;
  const max = Math.max(...locais.map(([, e]) => e.min));
  let s = "";
  locais.forEach(([nome, e], i) => {
    const y = i * ROW + (ROW - BAR) / 2;
    const w = Math.max(3, (e.min / max) * (X1 - X0));
    const tip = `${nome}: ${tempo(e.min)} de equipe parada · ${e.n} parada${e.n > 1 ? "s" : ""} de ${e.equipes.size} equipe${e.equipes.size > 1 ? "s" : ""}${e.longas ? ` · ${e.longas} de ${alertaMin} min ou mais` : ""}`;
    s += marca(
      `<rect x="0" y="${i * ROW}" width="${W}" height="${ROW}" class="alvo"/>` +
        `<text x="${X0 - 12}" y="${y + 12}" class="rotulo" text-anchor="end">${esc(corta(nome))}</text>` +
        `<rect x="${X0}" y="${y}" width="${w}" height="${BAR}" rx="4" class="${e.upa ? "s-upa" : "s-hosp"}"/>` +
        `<text x="${X0 + w + 10}" y="${y + 12}" class="valor"><tspan class="forte-txt">${tempo(e.min)}</tspan> · ${e.n} parada${e.n > 1 ? "s" : ""}${e.longas ? ` · <tspan class="alerta-txt">${e.longas} com ${alertaMin}+ min</tspan>` : ""}</text>`,
      tip,
    );
  });
  return `<svg viewBox="0 0 ${W} ${locais.length * ROW}" role="img" aria-label="Tempo somado de equipes paradas, por local">${s}</svg>`;
}

function tabela(linhas: Linha[]): string {
  const tr = linhas
    .map(
      (l) =>
        `<tr><td>${esc(l.nome)}</td><td>${esc(l.tipo ?? "")}</td><td>${esc(l.local)}${l.upa ? ' <span class="tag">UPA</span>' : ""}</td>` +
        `<td class="num">${hm(l.entrada)}${l.antes ? "*" : ""}</td><td class="num">${l.aberta ? "ainda lá" : hm(l.saida)}</td>` +
        `<td class="num"><span class="ponto b-${l.faixa}-bg"></span>${tempo(l.total)}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Viatura</th><th>Tipo</th><th>Local</th><th class="num">Entrada</th><th class="num">Saída</th><th class="num">Tempo</th></tr></thead><tbody>${tr}</tbody></table>`;
}

const CSS = `
:root{color-scheme:light;
  --bg:#f4f5f7;--surface:#ffffff;--surface-2:#f8fafc;--line:#e5e7eb;--line-2:#d1d5db;
  --ink:#0f172a;--ink-2:#475569;--ink-3:#94a3b8;
  --hosp:#2a78d6;--upa:#1baf7a;--curta:#1d4ed8;--chegando:#d97706;--longa:#b91c1c;
  --track:#eef1f5;--zebra:#f8fafc;--agora:#0f172a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
  --bg:#111111;--surface:#1a1a19;--surface-2:#202020;--line:#2c2c2a;--line-2:#3a3a37;
  --ink:#f5f5f4;--ink-2:#c3c2b7;--ink-3:#8a897f;
  --hosp:#3987e5;--upa:#199e70;--curta:#3987e5;--chegando:#c98500;--longa:#e34948;
  --track:#262624;--zebra:#1f1f1e;--agora:#f5f5f4}}
:root[data-theme="dark"]{color-scheme:dark;
  --bg:#111111;--surface:#1a1a19;--surface-2:#202020;--line:#2c2c2a;--line-2:#3a3a37;
  --ink:#f5f5f4;--ink-2:#c3c2b7;--ink-3:#8a897f;
  --hosp:#3987e5;--upa:#199e70;--curta:#3987e5;--chegando:#c98500;--longa:#e34948;
  --track:#262624;--zebra:#1f1f1e;--agora:#f5f5f4}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.capa{background:linear-gradient(135deg,#1e3a5f 0%,#0f172a 100%);color:#fff;padding:36px 16px 72px}
.capa .in,.corpo{max-width:1080px;margin:0 auto}
.sobre{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8}
h1{font-size:clamp(26px,4vw,38px);line-height:1.1;font-weight:900;margin:8px 0 6px;letter-spacing:-.02em}
.sub{color:#cbd5e1;font-size:15px}
.acoes{float:right;display:flex;gap:8px}
.acoes button{font:inherit;font-size:13px;font-weight:700;color:#fff;background:#ffffff1a;border:1px solid #ffffff33;border-radius:8px;padding:6px 12px;cursor:pointer}
.acoes button:hover{background:#ffffff2e}
.corpo{padding:0 16px 48px;margin-top:-48px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 1px 2px #0000000d,0 8px 24px -12px #0f172a26}
.kpi .n{font-size:32px;font-weight:900;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi .r{font-size:13px;font-weight:700;color:var(--ink-2);margin-top:2px}
.kpi .d{font-size:12px;color:var(--ink-3);margin-top:6px}
.kpi.destaque{border-color:transparent;background:linear-gradient(160deg,var(--surface) 0%,var(--surface-2) 100%);box-shadow:inset 4px 0 0 var(--hosp),0 1px 2px #0000000d,0 8px 24px -12px #0f172a26}
section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px 22px 18px;margin-bottom:18px}
h2{font-size:18px;font-weight:800;margin:0 0 4px;letter-spacing:-.01em}
.leg{color:var(--ink-2);font-size:13px;margin:0 0 16px;max-width:760px}
.chaves{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--ink-2);margin:-6px 0 14px}
.chaves span{display:inline-flex;align-items:center;gap:6px}
.chaves i{width:12px;height:12px;border-radius:3px;display:inline-block}
svg{display:block;width:100%;height:auto;overflow:visible}
.rolagem{overflow-x:auto;-webkit-overflow-scrolling:touch}
.rolagem svg.largo{min-width:760px}
text{font-family:inherit}
.eixo{font-size:11px;fill:var(--ink-3);font-variant-numeric:tabular-nums}
.rotulo{font-size:13px;font-weight:700;fill:var(--ink)}
.valor{font-size:12.5px;fill:var(--ink-2);font-variant-numeric:tabular-nums}
.forte-txt{font-weight:800;fill:var(--ink)}
.mudo,.mudo-svg{fill:var(--ink-3);font-weight:500}
.mudo-svg{font-size:11px}
.alerta-txt{fill:var(--longa);font-weight:700}
.pos{font-size:12px;font-weight:800;fill:var(--ink-3)}
.grade{stroke:var(--line);stroke-width:1}
.grade.forte{stroke:var(--line-2)}
.agora{stroke:var(--agora);stroke-width:1.5;stroke-dasharray:4 3}
.agora-txt{fill:var(--ink-2);font-weight:700}
.trilho{fill:var(--track)}
.zebra{fill:var(--zebra)}
.alvo{fill:transparent}
.s-hosp{fill:var(--hosp)}.s-upa{fill:var(--upa)}
.b-curta{fill:var(--curta)}.b-chegando{fill:var(--chegando)}.b-longa{fill:var(--longa)}
.bloco{stroke:var(--surface);stroke-width:1.5}
.corte{fill:var(--surface);opacity:.7}
.no-bloco{font-size:11px;font-weight:700;fill:#fff;pointer-events:none}
[data-tip]{cursor:default;outline:none}
[data-tip]:hover rect:not(.alvo):not(.trilho),[data-tip]:focus rect:not(.alvo):not(.trilho){filter:brightness(1.12)}
#tip{position:fixed;z-index:9;max-width:340px;background:#0f172a;color:#f8fafc;font-size:12.5px;line-height:1.4;padding:8px 10px;border-radius:8px;box-shadow:0 8px 24px #0006;pointer-events:none}
.vazio{color:var(--ink-3);font-size:14px;margin:8px 0}
details summary{cursor:pointer;font-weight:800;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);border-bottom:1px solid var(--line-2);padding:6px 8px}
td{border-bottom:1px solid var(--line);padding:6px 8px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tag{font-size:10px;font-weight:800;color:var(--upa);border:1px solid currentColor;border-radius:4px;padding:0 4px;margin-left:4px}
.ponto{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}
.b-curta-bg{background:var(--curta)}.b-chegando-bg{background:var(--chegando)}.b-longa-bg{background:var(--longa)}
.rodape{color:var(--ink-3);font-size:12px;line-height:1.6;max-width:800px}
@media (max-width:640px){.acoes{float:none;margin-bottom:16px}section{padding:16px 14px}.kpi .n{font-size:26px}}
@media print{body{background:#fff}.capa{padding:20px 0 24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.corpo{margin-top:16px}.acoes,#tip{display:none}
  section,.kpi{break-inside:avoid;box-shadow:none}.rolagem{overflow:visible}.rolagem svg.largo{min-width:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

const SCRIPT = `
const tip=document.getElementById('tip');
function mostra(el,x,y){tip.textContent=el.dataset.tip;tip.hidden=false;
  const r=tip.getBoundingClientRect();tip.style.left=Math.min(innerWidth-r.width-8,x+14)+'px';tip.style.top=(y+r.height+24>innerHeight?y-r.height-12:y+16)+'px'}
document.addEventListener('pointermove',e=>{const el=e.target.closest&&e.target.closest('[data-tip]');if(!el){tip.hidden=true;return}mostra(el,e.clientX,e.clientY)});
document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest('[data-tip]');if(!el)return;const r=el.getBoundingClientRect();mostra(el,r.left,r.bottom)});
document.addEventListener('focusout',()=>{tip.hidden=true});
`;

export function relatorioHtml(data: LinhaDoTempoFrota, p: Plantao, agora = Date.now()): string {
  const linhas = montar(data, p, agora);
  const emCurso = agora < p.fim;
  const somaMin = linhas.reduce((a, l) => a + l.min, 0);
  const somaHosp = linhas.filter((l) => !l.upa).reduce((a, l) => a + l.min, 0);
  const longas = linhas.filter((l) => l.faixa === "longa").length;
  const equipes = new Set(linhas.map((l) => l.nome)).size;
  const maior = [...linhas].sort((a, b) => b.total - a.total)[0];
  const horasPlantao = emCurso ? (agora - p.ini) / H : 12;
  const equivalentes = somaMin / 60 / horasPlantao;
  const gerado = new Date(agora).toLocaleString("pt-BR", { timeZone: "America/Bahia", dateStyle: "short", timeStyle: "short" });

  const kpis = `
    <div class="kpi destaque"><div class="n">${tempo(somaMin)}</div><div class="r">de equipe parada em porta</div>
      <div class="d">${tempo(somaHosp)} em hospital · ${tempo(somaMin - somaHosp)} em UPA</div></div>
    <div class="kpi"><div class="n">${um(equivalentes)}</div><div class="r">viaturas fora o plantão inteiro</div>
      <div class="d">é como se ${um(equivalentes)} equipe${equivalentes >= 1.95 ? "s" : ""} passasse${equivalentes >= 1.95 ? "m" : ""} ${emCurso ? `as ${duracao(Math.round(horasPlantao * 60))} decorridas` : "as 12 h"} na porta</div></div>
    <div class="kpi"><div class="n">${linhas.length}</div><div class="r">paradas de ${MIN_PARADA} min ou mais</div>
      <div class="d">${equipes} equipe${equipes === 1 ? "" : "s"} · ${longas} passaram de ${data.alertaMin} min${linhas.length ? ` (${pct(longas / linhas.length)})` : ""}</div></div>
    <div class="kpi"><div class="n">${maior ? tempo(maior.total) : "—"}</div><div class="r">maior parada</div>
      <div class="d">${maior ? `${esc(maior.nome)} · ${esc(maior.local)} · entrou ${hm(maior.entrada)}` : "nenhuma"}</div></div>`;

  const chavesFaixa = `<div class="chaves"><span><i style="background:var(--curta)"></i>até ${data.alertaMin - 11} min</span><span><i style="background:var(--chegando)"></i>${data.alertaMin - 10}–${data.alertaMin - 1} min</span><span><i style="background:var(--longa)"></i>${data.alertaMin} min ou mais</span></div>`;
  const chavesLocal = `<div class="chaves"><span><i style="background:var(--hosp)"></i>hospital</span><span><i style="background:var(--upa)"></i>UPA</span></div>`;

  const corpo = linhas.length
    ? `
  <section><h2>Quanto do plantão cada equipe passou em porta</h2>
    <p class="leg">Cada trilho é o plantão inteiro (12 h). A parte pintada é o tempo que a equipe ficou parada em hospital ou UPA — tempo em que não estava disponível para a próxima ocorrência.${emCurso ? " O tracejado marca agora." : ""}</p>
    ${chavesLocal}${graficoEquipes(linhas, p, agora)}</section>

  <section><h2>O plantão hora a hora, por local</h2>
    <p class="leg">Cada fatia é uma parada, do tamanho do tempo que durou, na hora em que aconteceu. Fatias empilhadas = equipes ao mesmo tempo na mesma porta. Passe o mouse ou toque para ver o detalhe.</p>
    ${chavesFaixa}${graficoLinhaDoTempo(linhas, data, p, agora)}</section>

  <section><h2>Os maiores tempos</h2>
    <p class="leg">As paradas mais longas do plantão, com a hora de chegada e de saída.</p>
    ${chavesFaixa}${graficoMaiores(linhas)}</section>

  <section><h2>Tempo somado por local</h2>
    <p class="leg">Onde as equipes mais ficaram presas, somando todas as paradas.</p>
    ${chavesLocal}${graficoLocais(linhas, data.alertaMin)}</section>

  <section><details><summary>Todas as paradas (${linhas.length})</summary>${tabela(linhas)}
    ${linhas.some((l) => l.antes) ? '<p class="rodape">* entrou antes do início do plantão; nos gráficos conta só a parte dentro dele.</p>' : ""}</details></section>`
    : `<section><p class="vazio">Nenhuma equipe parou ${MIN_PARADA} min ou mais em hospital ou UPA neste plantão.</p></section>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Equipes em porta — ${esc(p.curto)}</title><style>${CSS}</style></head><body>
<header class="capa"><div class="in">
  <div class="acoes"><button onclick="print()">Imprimir / PDF</button></div>
  <div class="sobre">SAMU 192 Salvador · Rastreador de Equipes</div>
  <h1>Equipes em porta de hospital</h1>
  <div class="sub">${esc(p.rotulo)}${emCurso ? ` · em andamento, até ${hm(agora)}` : ""}</div>
</div></header>
<main class="corpo">
  <div class="kpis">${kpis}</div>
  ${corpo}
  <p class="rodape">Fonte: posições do SAMU+ lidas a cada 2 min. Parada = viatura a até 150 m de um hospital ou UPA (ou de um estacionamento aprendido dele), por ${MIN_PARADA} min ou mais; a própria base não conta. Sem sinal, o tempo para de contar. Gerado em ${gerado}.</p>
</main>
<div id="tip" hidden></div>
<script>${SCRIPT}</script>
</body></html>`;
}
