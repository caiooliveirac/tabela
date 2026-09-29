// ═══════════════════════════════════════════════════════════════
// Linha do tempo por hospital: cada barra é uma viatura parada no raio de
// 150 m, da entrada à saída. Uma linha por hospital (ordem fixa do painel);
// viaturas ao mesmo tempo no mesmo hospital empilham em faixas.
//
// Cor = quanto tempo durou (azul até 29 min, âmbar 30–39, vermelho 40+),
// sempre com o número escrito na barra ou no detalhe — nunca só a cor.
// O traço branco dentro das barras longas marca onde elas cruzaram os 40 min.
// ═══════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import type { ParadaHistorico } from "../../lib/types";
import { useLinhaDoTempoFrota } from "../../hooks/useFrota";
import { hora } from "./formato";

const JANELAS = [6, 12, 24] as const;
const FAIXA_PX = 22;
/** Validado (dataviz): azul/âmbar/vermelho separáveis também para daltônicos. */
const COR_BARRA = { curta: "#1d4ed8", chegando: "#d97706", longa: "#b91c1c" } as const;
const FUSO_MS = -3 * 3_600_000; // America/Bahia, sem horário de verão

function corDaBarra(min: number, alertaMin: number): string {
  if (min >= alertaMin) return COR_BARRA.longa;
  if (min >= alertaMin - 10) return COR_BARRA.chegando;
  return COR_BARRA.curta;
}

/** Faixas: parada que começa antes da anterior terminar desce uma faixa. */
function emFaixas(paradas: ParadaHistorico[]): { p: ParadaHistorico; faixa: number }[] {
  const fins: number[] = [];
  return paradas.map((p) => {
    const ini = Date.parse(p.entrada);
    let faixa = fins.findIndex((f) => f <= ini);
    if (faixa < 0) faixa = fins.length;
    fins[faixa] = Date.parse(p.fim);
    return { p, faixa };
  });
}

function descricao(p: ParadaHistorico, hospitalNome: string): string {
  const quem = `${p.nome}${p.tipo ? ` (${p.tipo}${p.base ? ` · ${p.base}` : ""})` : ""}`;
  const fim = p.aberta ? "ainda lá" : p.motivoFim === "sem-sinal" ? `sem sinal desde ${hora(p.fim)}` : `saiu ${hora(p.fim)}`;
  return `${quem} no ${hospitalNome} · entrou ${hora(p.entrada)} · ${p.minutos} min · ${fim}`;
}

export default function LinhaDoTempo({ onHospital }: { onHospital?: (id: string) => void }) {
  const [horas, setHoras] = useState<number>(() => Number(localStorage.getItem("tabela:frotaHoras")) || 12);
  const { data, isLoading } = useLinhaDoTempoFrota(horas);
  const [sel, setSel] = useState<number | null>(null);

  const escolherHoras = (h: number) => {
    setHoras(h);
    localStorage.setItem("tabela:frotaHoras", String(h));
  };

  const vista = useMemo(() => {
    if (!data) return null;
    const t0 = Date.parse(data.desde);
    const t1 = Date.parse(data.ate);
    const x = (t: number) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100));
    const passo = (horas <= 12 ? 1 : 2) * 3_600_000;
    const marcas: { pos: number; rotulo: string }[] = [];
    for (let local = Math.ceil((t0 + FUSO_MS) / passo) * passo; local - FUSO_MS < t1; local += passo) {
      const t = local - FUSO_MS;
      marcas.push({ pos: x(t), rotulo: `${hora(new Date(t).toISOString()).slice(0, 2)}h` });
    }
    const linhas = data.hospitais.map((h) => {
      const doHospital = data.paradas.filter((p) => p.hospitalId === h.id);
      const barras = emFaixas(doHospital);
      const faixas = Math.max(1, ...barras.map((b) => b.faixa + 1));
      return {
        ...h,
        barras,
        faixas,
        maior: Math.max(0, ...doHospital.map((p) => p.minutos)),
        longas: doHospital.filter((p) => p.minutos >= data.alertaMin).length,
        total: doHospital.length,
      };
    });
    return { x, marcas, linhas };
  }, [data, horas]);

  const selecionada = data?.paradas.find((p) => p.id === sel) ?? null;
  const nomeHospital = (id: string) => data?.hospitais.find((h) => h.id === id)?.nome ?? id;

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 p-4">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">
          Linha do tempo nos hospitais
        </div>
        <div className="flex gap-[2px] bg-slate-100 rounded-lg p-[2px] ml-auto">
          {JANELAS.map((h) => (
            <button
              key={h}
              onClick={() => escolherHoras(h)}
              className="py-[3px] px-3 rounded-md border-none text-xs font-bold cursor-pointer"
              style={{ backgroundColor: horas === h ? "#fff" : "transparent", color: horas === h ? "#0f172a" : "#64748b" }}
            >
              {h} h
            </button>
          ))}
        </div>
      </div>

      {/* Detalhe da barra tocada — funciona com mouse e com dedo */}
      <div className="min-h-[20px] text-[12px] mb-2" style={{ color: selecionada ? "#0f172a" : "#94a3b8" }}>
        {selecionada
          ? descricao(selecionada, nomeHospital(selecionada.hospitalId))
          : "Passe o mouse ou toque numa barra para ver a parada."}
      </div>

      {isLoading || !vista || !data ? (
        <div className="text-[13px] text-slate-400 py-6">Carregando…</div>
      ) : (
        <>
          <div className="grid grid-cols-[112px_minmax(0,1fr)_88px] gap-x-2 text-[11px]">
            {/* régua de horas */}
            <div />
            <div className="relative h-[16px]">
              {vista.marcas.map((m) => (
                <span key={m.pos} className="absolute -translate-x-1/2 text-slate-400 tabular-nums" style={{ left: `${m.pos}%` }}>
                  {m.rotulo}
                </span>
              ))}
              <span className="absolute right-0 text-slate-500 font-bold">agora</span>
            </div>
            <div />

            {vista.linhas.map((l) => (
              <div key={l.id} className="contents">
                <button
                  onClick={() => onHospital?.(l.id)}
                  className="text-left font-extrabold text-slate-700 bg-transparent border-none p-0 cursor-pointer hover:underline truncate border-t border-slate-100"
                  style={{ height: l.faixas * FAIXA_PX + 6 }}
                  title={onHospital ? "Ver no mapa" : undefined}
                >
                  {l.nome}
                </button>
                <div className="relative border-t border-slate-100" style={{ height: l.faixas * FAIXA_PX + 6 }}>
                  {vista.marcas.map((m) => (
                    <div key={m.pos} className="absolute top-0 bottom-0 w-px bg-slate-100" style={{ left: `${m.pos}%` }} />
                  ))}
                  {l.barras.map(({ p, faixa }) => {
                    const ini = vista.x(Date.parse(p.entrada));
                    const fim = vista.x(Date.parse(p.fim));
                    const cor = corDaBarra(p.minutos, data.alertaMin);
                    return (
                      <button
                        key={p.id}
                        onMouseEnter={() => setSel(p.id)}
                        onFocus={() => setSel(p.id)}
                        onClick={() => setSel(p.id)}
                        aria-label={descricao(p, l.nome)}
                        className="absolute border-none cursor-pointer overflow-hidden whitespace-nowrap text-left text-white font-bold p-0"
                        style={{
                          left: `${ini}%`,
                          width: `max(6px, calc(${fim - ini}% - 2px))`,
                          top: 3 + faixa * FAIXA_PX,
                          height: FAIXA_PX - 4,
                          backgroundColor: cor,
                          borderRadius: p.aberta ? "4px 0 0 4px" : 4,
                          opacity: p.motivoFim === "sem-sinal" ? 0.5 : 1,
                          outline: sel === p.id ? "2px solid #0f172a" : "none",
                          outlineOffset: 1,
                          fontSize: 10,
                          lineHeight: `${FAIXA_PX - 4}px`,
                        }}
                      >
                        {p.minutos > data.alertaMin && (
                          <span
                            className="absolute top-0 bottom-0 w-[2px] bg-white/80"
                            style={{ left: `${(data.alertaMin / p.minutos) * 100}%` }}
                          />
                        )}
                        <span className="relative px-[4px]">
                          {p.nome} {p.minutos}′{p.aberta ? " ▸" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-slate-500 tabular-nums border-t border-slate-100 pt-[4px]" style={{ height: l.faixas * FAIXA_PX + 6 }}>
                  {l.total ? (
                    <>
                      {l.total} · máx {l.maior}′
                      {l.longas > 0 && <span className="font-bold" style={{ color: COR_BARRA.longa }}> · {l.longas}×40+</span>}
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-[14px] h-[10px] rounded-[3px]" style={{ background: COR_BARRA.curta }} /> até {data.alertaMin - 11} min
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-[14px] h-[10px] rounded-[3px]" style={{ background: COR_BARRA.chegando }} /> {data.alertaMin - 10}–{data.alertaMin - 1} min
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-[14px] h-[10px] rounded-[3px] relative" style={{ background: COR_BARRA.longa }}>
                <span className="absolute left-[6px] top-0 bottom-0 w-[2px] bg-white/80" />
              </span>
              {data.alertaMin} min ou mais (traço = quando passou dos {data.alertaMin})
            </span>
            <span>▸ ainda lá</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-[14px] h-[10px] rounded-[3px] opacity-50" style={{ background: COR_BARRA.curta }} /> fechou sem sinal
            </span>
            {data.paradas.length === 0 && <span className="ml-auto">Nenhuma parada em hospital nas últimas {horas} h.</span>}
          </div>
        </>
      )}
    </div>
  );
}
