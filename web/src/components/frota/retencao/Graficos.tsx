// ═══════════════════════════════════════════════════════════════
// Gráficos da análise de retenção — SVG/HTML próprios, sem biblioteca.
//
// Regras (skill de dataviz): um eixo por gráfico (nunca dois), mediana em
// azul e P90 em laranja (par validado para daltonismo), sequencial de um
// matiz só no mapa de calor, limite de 40 min sempre tracejado e rotulado,
// amostra pequena esmaecida e fora do traço, dica ao passar o mouse e a
// tabela por trás de cada gráfico.
// ═══════════════════════════════════════════════════════════════
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AMOSTRA_MIN, DIAS_SEMANA, ORDENS, dataCurta, minutos, pct,
  type LinhaGrupo, type Ordem, type PontoSerie, type Resumo,
} from "./estatistica";

export const COR = {
  mediana: "#2a78d6",
  p90: "#eb6834",
  iqr: "#b7d3f6",
  abaixo: "#86b6ef",
  acima: "#eb6834",
  n: "#94a3b8",
  limite: "#64748b",
  grade: "#e2e8f0",
} as const;
/** Azul sequencial, claro → escuro (rampa validada da skill). */
const RAMPA = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Topo "redondo" do eixo de minutos e o passo das marcas. */
function escalaMin(max: number): { topo: number; passo: number } {
  const passo = max <= 60 ? 10 : max <= 120 ? 20 : max <= 240 ? 40 : max <= 480 ? 60 : 120;
  return { topo: Math.max(passo, Math.ceil(max / passo) * passo), passo };
}
function escalaN(max: number): { topo: number; passo: number } {
  const bruto = Math.max(1, max) / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= bruto) ?? 10 * mag;
  return { topo: Math.ceil(Math.max(1, max) / passo) * passo, passo };
}

/** Barra com cantos de cima arredondados, presa à linha de base. */
function barra(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function Dica({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="absolute z-20 pointer-events-none bg-slate-900 text-white text-[11px] leading-[1.45] rounded-md px-[9px] py-[6px] shadow-lg whitespace-nowrap"
      style={{ left: x, top: y, transform: "translate(-50%, calc(-100% - 10px))" }}
    >
      {children}
    </div>
  );
}

function Legenda({ itens }: { itens: { cor: string; rotulo: string; tracejado?: boolean; ponto?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
      {itens.map((i) => (
        <span key={i.rotulo} className="inline-flex items-center gap-[6px]">
          {i.ponto ? (
            <span className="w-[10px] h-[10px] rounded-sm" style={{ background: i.cor }} />
          ) : (
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="18" y2="3" stroke={i.cor} strokeWidth="2" strokeDasharray={i.tracejado ? "4 3" : undefined} />
            </svg>
          )}
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

// ── Tendência ──
export type MetricaTempo = "tempo" | "retidas" | "paradas";

export function Tendencia({ pontos, metrica, alertaMin, balde }: {
  pontos: PontoSerie[];
  metrica: MetricaTempo;
  alertaMin: number;
  balde: "dia" | "semana";
}) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(280, largura);
  const H = 230;
  const HN = metrica === "paradas" ? 0 : 54;
  const m = { l: 44, r: 12, t: 12, b: 22 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const bw = iw / Math.max(1, pontos.length);
  const cx = (i: number) => m.l + (i + 0.5) * bw;
  const ok = (p: PontoSerie) => p.resumo.n >= AMOSTRA_MIN;
  const porDia = (p: PontoSerie) => (balde === "semana" ? p.resumo.n / Math.max(1, p.dias) : p.resumo.n);

  const valores = pontos.flatMap((p) =>
    metrica === "tempo" ? (ok(p) ? [p.resumo.p90] : []) : metrica === "retidas" ? (ok(p) ? [p.resumo.fracAlerta * 100] : []) : [porDia(p)],
  );
  const esc = metrica === "tempo" ? escalaMin(Math.max(alertaMin * 1.25, ...valores)) : metrica === "retidas" ? { topo: 100, passo: 25 } : escalaN(Math.max(...valores, 1));
  const y = (v: number) => m.t + ih - (v / esc.topo) * ih;
  const marcas: number[] = [];
  for (let v = 0; v <= esc.topo + 1e-9; v += esc.passo) marcas.push(v);

  const traco = (val: (p: PontoSerie) => number) => {
    let d = "";
    let aberto = false;
    pontos.forEach((p, i) => {
      if (!ok(p)) {
        aberto = false;
        return;
      }
      d += `${aberto ? "L" : "M"}${cx(i)},${y(val(p))}`;
      aberto = true;
    });
    return d;
  };
  // Ponto isolado (vizinhos sem amostra) não vira traço: desenha um ponto.
  const isolados = pontos.map((p, i) => ok(p) && !ok(pontos[i - 1] ?? ({ resumo: { n: 0 } } as PontoSerie)) && !ok(pontos[i + 1] ?? ({ resumo: { n: 0 } } as PontoSerie)));
  const passoRotulo = Math.max(1, Math.ceil((pontos.length * 46) / iw));
  const maxN = Math.max(1, ...pontos.map(porDia));
  const rotulo = (p: PontoSerie) => (balde === "semana" ? `sem. ${dataCurta(p.inicio)}` : dataCurta(p.inicio));
  const hp = hover != null ? pontos[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg width={W} height={H + HN} role="img" aria-label="Tendência da retenção no período" onMouseLeave={() => setHover(null)}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={COR.grade} />
            <text x={m.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">
              {metrica === "tempo" ? (v >= 60 && v % 60 === 0 ? `${v / 60} h` : v) : metrica === "retidas" ? `${v}%` : v}
            </text>
          </g>
        ))}
        {metrica === "tempo" && (
          <g>
            <line x1={m.l} x2={W - m.r} y1={y(alertaMin)} y2={y(alertaMin)} stroke={COR.limite} strokeDasharray="5 4" />
            <text x={W - m.r} y={y(alertaMin) - 4} textAnchor="end" fontSize="10" fontWeight="700" fill={COR.limite}>
              limite {alertaMin} min
            </text>
          </g>
        )}
        {hp && <line x1={cx(hover!)} x2={cx(hover!)} y1={m.t} y2={m.t + ih} stroke="#cbd5e1" />}
        {metrica === "paradas" &&
          pontos.map((p, i) => {
            const v = porDia(p);
            const w = Math.max(2, Math.min(28, bw - 2));
            return <path key={p.chave} d={barra(cx(i) - w / 2, y(v), w, m.t + ih - y(v))} fill={COR.mediana} opacity={hover == null || hover === i ? 1 : 0.55} />;
          })}
        {metrica === "tempo" && (
          <>
            <path d={traco((p) => p.resumo.p90)} fill="none" stroke={COR.p90} strokeWidth="2" strokeLinejoin="round" />
            <path d={traco((p) => p.resumo.mediana)} fill="none" stroke={COR.mediana} strokeWidth="2" strokeLinejoin="round" />
            {pontos.map((p, i) =>
              isolados[i] || hover === i ? (
                <g key={p.chave}>
                  <circle cx={cx(i)} cy={y(p.resumo.p90)} r="4" fill={COR.p90} stroke="#fff" strokeWidth="2" />
                  <circle cx={cx(i)} cy={y(p.resumo.mediana)} r="4" fill={COR.mediana} stroke="#fff" strokeWidth="2" />
                </g>
              ) : null,
            )}
          </>
        )}
        {metrica === "retidas" && (
          <>
            <path d={traco((p) => p.resumo.fracAlerta * 100)} fill="none" stroke={COR.p90} strokeWidth="2" strokeLinejoin="round" />
            {pontos.map((p, i) =>
              isolados[i] || hover === i ? <circle key={p.chave} cx={cx(i)} cy={y(p.resumo.fracAlerta * 100)} r="4" fill={COR.p90} stroke="#fff" strokeWidth="2" /> : null,
            )}
          </>
        )}
        {pontos.map((p, i) =>
          i % passoRotulo === 0 ? (
            <text key={p.chave} x={cx(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">
              {rotulo(p)}
            </text>
          ) : null,
        )}
        {HN > 0 && (
          <g transform={`translate(0, ${H})`}>
            <text x={m.l - 6} y={12} textAnchor="end" fontSize="9" fill="#94a3b8">N</text>
            {pontos.map((p, i) => {
              const v = porDia(p);
              const h = (v / maxN) * (HN - 18);
              const w = Math.max(2, Math.min(28, bw - 2));
              return <path key={p.chave} d={barra(cx(i) - w / 2, HN - 6 - h, w, h, 2)} fill={COR.n} opacity={ok(p) ? 1 : 0.4} />;
            })}
          </g>
        )}
        {pontos.map((p, i) => (
          <rect key={p.chave} x={m.l + i * bw} y={0} width={bw} height={H + HN} fill="transparent" onMouseMove={() => setHover(i)} />
        ))}
      </svg>
      {hp && (
        <Dica x={Math.min(Math.max(cx(hover!), 90), W - 90)} y={m.t + 10}>
          <div className="font-bold">{balde === "semana" ? `Semana de ${dataCurta(hp.inicio)}` : dataCurta(hp.inicio)}</div>
          <div>{hp.resumo.n} paradas{balde === "semana" ? ` · ${(hp.resumo.n / Math.max(1, hp.dias)).toFixed(1)}/dia` : ""}</div>
          {ok(hp) ? (
            <>
              <div>Mediana {minutos(hp.resumo.mediana)} · P90 {minutos(hp.resumo.p90)}</div>
              <div>{pct(hp.resumo.fracAlerta)} com {alertaMin}+ min</div>
            </>
          ) : (
            hp.resumo.n > 0 && <div className="text-slate-300">amostra pequena (menos de {AMOSTRA_MIN})</div>
          )}
        </Dica>
      )}
    </div>
  );
}

export function LegendaTendencia({ metrica, alertaMin, balde }: { metrica: MetricaTempo; alertaMin: number; balde: "dia" | "semana" }) {
  if (metrica === "paradas") return <Legenda itens={[{ cor: COR.mediana, rotulo: balde === "semana" ? "Paradas por dia (média da semana)" : "Paradas no dia", ponto: true }]} />;
  return (
    <Legenda
      itens={[
        ...(metrica === "tempo"
          ? [
              { cor: COR.mediana, rotulo: "Mediana (metade espera menos)" },
              { cor: COR.p90, rotulo: "P90 (9 em 10 esperam menos)" },
              { cor: COR.limite, rotulo: `Limite ${alertaMin} min`, tracejado: true },
            ]
          : [{ cor: COR.p90, rotulo: `% das paradas com ${alertaMin}+ min` }]),
        { cor: COR.n, rotulo: "N de paradas (embaixo)", ponto: true },
      ]}
    />
  );
}

// ── Distribuição ──
export function Distribuicao({ faixas, alertaMin, total }: { faixas: { rotulo: string; de: number; n: number }[]; alertaMin: number; total: number }) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(280, largura);
  const H = 220;
  const m = { l: 40, r: 8, t: 26, b: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const bw = iw / faixas.length;
  const esc = escalaN(Math.max(...faixas.map((f) => f.n), 1));
  const y = (v: number) => m.t + ih - (v / esc.topo) * ih;
  const marcas: number[] = [];
  for (let v = 0; v <= esc.topo; v += esc.passo) marcas.push(v);
  const corte = faixas.findIndex((f) => f.de >= alertaMin);
  const hf = hover != null ? faixas[hover] : null;
  return (
    <div ref={ref} className="relative">
      <svg width={W} height={H} role="img" aria-label="Distribuição do tempo de parada" onMouseLeave={() => setHover(null)}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={COR.grade} />
            <text x={m.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">{v}</text>
          </g>
        ))}
        {faixas.map((f, i) => {
          const w = Math.min(56, bw - 6);
          const x = m.l + i * bw + (bw - w) / 2;
          return (
            <g key={f.rotulo} opacity={hover == null || hover === i ? 1 : 0.6}>
              <path d={barra(x, y(f.n), w, m.t + ih - y(f.n))} fill={f.de >= alertaMin ? COR.acima : COR.abaixo} />
              {f.n > 0 && (
                <text x={x + w / 2} y={y(f.n) - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#334155">
                  {pct(f.n / Math.max(1, total))}
                </text>
              )}
              <text x={m.l + i * bw + bw / 2} y={H - 18} textAnchor="middle" fontSize="10" fill="#64748b">{f.rotulo}</text>
              <rect x={m.l + i * bw} y={0} width={bw} height={H} fill="transparent" onMouseMove={() => setHover(i)} />
            </g>
          );
        })}
        <text x={m.l + iw / 2} y={H - 3} textAnchor="middle" fontSize="10" fill="#94a3b8">minutos parada no local</text>
        {corte > 0 && (
          <g>
            <line x1={m.l + corte * bw} x2={m.l + corte * bw} y1={m.t - 14} y2={m.t + ih} stroke={COR.limite} strokeDasharray="5 4" />
            <text x={m.l + corte * bw + 4} y={m.t - 6} fontSize="10" fontWeight="700" fill={COR.limite}>{alertaMin} min</text>
          </g>
        )}
      </svg>
      {hf && (
        <Dica x={Math.min(Math.max(m.l + (hover! + 0.5) * bw, 80), W - 80)} y={y(hf.n)}>
          <div className="font-bold">{hf.rotulo} {hf.rotulo.includes("h") ? "" : "min"}</div>
          <div>{hf.n} paradas · {pct(hf.n / Math.max(1, total))}</div>
        </Dica>
      )}
    </div>
  );
}

// ── Ranking (local, perfil, viatura, base) ──
export function Ranking({ linhas, alertaMin, ordem, setOrdem, selecionados, onEscolher, rotuloGrupo }: {
  linhas: LinhaGrupo[];
  alertaMin: number;
  ordem: Ordem;
  setOrdem: (o: Ordem) => void;
  selecionados?: string[];
  onEscolher?: (chave: string) => void;
  rotuloGrupo: string;
}) {
  const [todos, setTodos] = useState(false);
  const [hover, setHover] = useState<{ chave: string; x: number; y: number } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const LIMITE = 15;
  const vis = todos ? linhas : linhas.slice(0, LIMITE);
  const { topo } = escalaMin(Math.max(alertaMin * 1.5, ...linhas.filter((l) => l.resumo.n >= AMOSTRA_MIN).map((l) => l.resumo.p90)));
  const x = (v: number) => `${(Math.min(v, topo) / topo) * 100}%`;
  const hl = hover ? linhas.find((l) => l.chave === hover.chave) : null;
  return (
    <div ref={caixa} className="relative">
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] text-slate-500">
        Ordenar por
        {ORDENS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOrdem(o.id)}
            aria-pressed={ordem === o.id}
            className={`px-2 py-[2px] rounded-full border font-bold ${ordem === o.id ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
      <Legenda
        itens={[
          { cor: COR.iqr, rotulo: "Metade do meio (P25–P75)", ponto: true },
          { cor: COR.mediana, rotulo: "Mediana", ponto: true },
          { cor: COR.p90, rotulo: "P90", ponto: true },
          { cor: COR.limite, rotulo: `${alertaMin} min`, tracejado: true },
        ]}
      />
      <div className="mt-2 grid grid-cols-[minmax(92px,190px)_1fr] sm:grid-cols-[minmax(110px,210px)_1fr_auto] gap-x-3 text-[12px]">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 py-1">{rotuloGrupo}</div>
        <div className="relative text-[10px] text-slate-400 py-1">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2" style={{ left: x(topo / 2) }}>{minutos(topo / 2)}</span>
          <span className="absolute right-0">{minutos(topo)}</span>
        </div>
        <div className="hidden sm:grid grid-cols-[44px_62px_62px_52px_56px] text-[10px] font-bold uppercase tracking-wide text-slate-400 py-1 text-right">
          <span>N</span><span>Mediana</span><span>P90</span><span>{alertaMin}+</span><span>h além</span>
        </div>
        {vis.map((l) => {
          const pequena = l.resumo.n < AMOSTRA_MIN;
          const ativo = selecionados?.includes(l.chave);
          const r = l.resumo;
          return (
            <div
              key={l.chave}
              className={`contents ${onEscolher ? "cursor-pointer" : ""}`}
              onClick={() => onEscolher?.(l.chave)}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => {
                const b = caixa.current?.getBoundingClientRect();
                if (b) setHover({ chave: l.chave, x: e.clientX - b.left, y: e.clientY - b.top });
              }}
            >
              <div className={`py-[5px] border-t border-slate-100 min-w-0 ${ativo ? "bg-blue-50" : ""}`}>
                <div className={`font-bold truncate ${pequena ? "text-slate-400" : "text-slate-800"}`}>{l.rotulo}</div>
                <div className="text-[10px] text-slate-400 truncate">
                  {l.extra}
                  <span className="sm:hidden"> · {r.n} · med {minutos(r.mediana)}</span>
                </div>
              </div>
              <div className={`relative border-t border-slate-100 ${ativo ? "bg-blue-50" : ""}`}>
                <div className="absolute inset-y-0 border-l border-dashed" style={{ left: x(alertaMin), borderColor: COR.limite }} />
                {pequena ? (
                  <div className="absolute top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pl-1">amostra pequena</div>
                ) : (
                  <>
                    <div className="absolute top-1/2 -translate-y-1/2 h-[10px] rounded" style={{ left: x(r.p25), width: `calc(${x(r.p75)} - ${x(r.p25)})`, background: COR.iqr, minWidth: 2 }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-[2px] h-[16px]" style={{ left: x(r.p90), background: COR.p90 }} />
                    <div className="absolute top-1/2 w-[10px] h-[10px] rounded-full ring-2 ring-white -translate-x-1/2 -translate-y-1/2" style={{ left: x(r.mediana), background: COR.mediana }} />
                    {r.p90 > topo && <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[11px] font-black" style={{ color: COR.p90 }}>›</div>}
                  </>
                )}
              </div>
              <div className={`hidden sm:grid grid-cols-[44px_62px_62px_52px_56px] items-center text-right tabular-nums border-t border-slate-100 ${pequena ? "text-slate-400" : "text-slate-700"} ${ativo ? "bg-blue-50" : ""}`}>
                <span>{r.n}</span>
                <span>{pequena ? "—" : minutos(r.mediana)}</span>
                <span>{pequena ? "—" : minutos(r.p90)}</span>
                <span>{pequena ? "—" : pct(r.fracAlerta)}</span>
                <span>{r.horasAlem.toFixed(r.horasAlem < 10 ? 1 : 0)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {linhas.length > LIMITE && (
        <button type="button" onClick={() => setTodos((t) => !t)} className="mt-2 text-[12px] font-bold text-blue-700 hover:underline">
          {todos ? "Mostrar só os 15 primeiros" : `Mostrar todos (${linhas.length})`}
        </button>
      )}
      {hl && hover && (
        <Dica x={Math.min(Math.max(hover.x, 110), (caixa.current?.clientWidth ?? 400) - 110)} y={hover.y}>
          <div className="font-bold">{hl.rotulo}</div>
          <div>{hl.resumo.n} paradas · {hl.resumo.horasTotal.toFixed(1)} h no local</div>
          {hl.resumo.n >= AMOSTRA_MIN && (
            <>
              <div>P25 {minutos(hl.resumo.p25)} · mediana {minutos(hl.resumo.mediana)} · P75 {minutos(hl.resumo.p75)}</div>
              <div>P90 {minutos(hl.resumo.p90)} · maior {minutos(hl.resumo.maior)}</div>
              <div>{pct(hl.resumo.fracAlerta)} com {alertaMin}+ min · {pct(hl.resumo.frac60)} com 60+</div>
            </>
          )}
          {onEscolher && <div className="text-slate-300">clique para filtrar</div>}
        </Dica>
      )}
    </div>
  );
}

// ── Dia da semana × hora da chegada ──
export type MetricaCalor = "n" | "mediana" | "fracAlerta";

export function Calor({ grade, metrica, alertaMin, semanas }: { grade: Resumo[][]; metrica: MetricaCalor; alertaMin: number; semanas: number }) {
  const minimo = metrica === "n" ? 1 : 3;
  const val = (r: Resumo) => (metrica === "n" ? r.n / Math.max(1, semanas) : metrica === "mediana" ? r.mediana : r.fracAlerta);
  const validos = grade.flat().filter((r) => r.n >= minimo).map(val);
  // Escala do menor ao maior valor observado: com 0–100% fixo, 40–60% viram a mesma cor.
  const lo = metrica === "n" ? 0 : Math.min(...validos);
  const hi = Math.max(...validos, lo + (metrica === "fracAlerta" ? 0.01 : 1));
  const passo = (v: number) => Math.max(0, Math.min(RAMPA.length - 1, Math.floor(((v - lo) / (hi - lo)) * RAMPA.length)));
  const texto = (r: Resumo) =>
    metrica === "n" ? (val(r) >= 10 ? Math.round(val(r)) : val(r).toFixed(1)) : metrica === "mediana" ? Math.round(r.mediana) : Math.round(r.fracAlerta * 100);
  const rotulo = (r: Resumo) =>
    `${r.n} paradas${r.n >= 3 ? ` · mediana ${minutos(r.mediana)} · ${pct(r.fracAlerta)} com ${alertaMin}+ min` : ""}`;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-[10px] min-w-[520px] w-full" role="grid">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 12 }, (_, h) => (
              <th key={h} className="font-semibold text-slate-400 text-left pl-[2px]">{String(h * 2).padStart(2, "0")}h</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grade.map((linha, d) => (
            <tr key={DIAS_SEMANA[d]}>
              <th className="font-bold text-slate-500 text-left pr-1">{DIAS_SEMANA[d]}</th>
              {linha.map((r, h) => {
                const vazio = r.n < minimo;
                const i = vazio ? 0 : passo(val(r));
                return (
                  <td
                    key={h}
                    title={`${DIAS_SEMANA[d]} ${String(h * 2).padStart(2, "0")}h–${String(h * 2 + 1).padStart(2, "0")}h59: ${rotulo(r)}`}
                    className="h-[30px] rounded text-center font-bold tabular-nums"
                    style={
                      vazio
                        ? { background: "repeating-linear-gradient(45deg,#f8fafc,#f8fafc 3px,#e2e8f0 3px,#e2e8f0 4px)", color: "#94a3b8" }
                        : { background: RAMPA[i], color: i >= 4 ? "#fff" : "#0f172a" }
                    }
                  >
                    {vazio ? (r.n ? "·" : "") : texto(r)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
        <span>
          {metrica === "n" ? "0" : metrica === "mediana" ? minutos(lo) : pct(lo)}
        </span>
        <div className="flex">
          {RAMPA.map((c) => (
            <span key={c} className="w-[22px] h-[10px]" style={{ background: c }} />
          ))}
        </div>
        <span>
          {metrica === "n" ? `${hi.toFixed(1)} por semana` : metrica === "mediana" ? minutos(hi) : pct(hi)}
        </span>
        <span className="ml-3 inline-flex items-center gap-1">
          <span className="w-[14px] h-[10px] rounded-sm" style={{ background: "repeating-linear-gradient(45deg,#f8fafc,#f8fafc 3px,#e2e8f0 3px,#e2e8f0 4px)" }} />
          {metrica === "n" ? "nenhuma" : "menos de 3 paradas"}
        </span>
      </div>
    </div>
  );
}
