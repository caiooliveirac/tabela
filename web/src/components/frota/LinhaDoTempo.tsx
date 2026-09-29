// ═══════════════════════════════════════════════════════════════
// Linha do tempo por hospital: cada barra é uma viatura parada no raio de
// 150 m, da entrada à saída. Uma linha por hospital (ordem fixa do painel),
// depois as UPAs — só as que tiveram parada na janela;
// viaturas ao mesmo tempo no mesmo hospital empilham em faixas.
//
// Cor = quanto tempo durou (azul até 29 min, âmbar 30–39, vermelho 40+),
// sempre com o número escrito na barra ou no detalhe — nunca só a cor.
// O traço branco dentro das barras longas marca onde elas cruzaram os 40 min.
//
// Com o Acolhimentos ligado, embaixo de cada barra vem o que a equipe
// NOTIFICOU: faixa cinza da chegada à liberação (tique na passagem do
// paciente) e faixa roxa da maca retida. Notificação sem parada no GPS
// aparece vazada; USA 40+ min sem notificação ganha a marca "sem notificação".
// ═══════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import type { LinhaDoTempoFrota, NotificacaoAcolhimento, ParadaHistorico } from "../../lib/types";
import { useLinhaDoTempoFrota } from "../../hooks/useFrota";
import { artigo, hora } from "./formato";

const JANELAS = [6, 12, 24] as const;
const FAIXA_PX = 24;
/** Validado (dataviz): azul/âmbar/vermelho separáveis também para daltônicos. */
const COR_BARRA = { curta: "#1d4ed8", chegando: "#d97706", longa: "#b91c1c" } as const;
const COR_NOTIFICADO = "#334155";
const COR_MACA = "#7c3aed";
/** Parada na própria base, que fica no hospital: sem alerta, em cinza. */
const COR_BASE = "#94a3b8";
const FUSO_MS = -3 * 3_600_000; // America/Bahia, sem horário de verão

type Solta = LinhaDoTempoFrota["acolhimentos"]["soltas"][number];
type Item =
  | { tipo: "parada"; chave: string; entrada: string; fim: string; p: ParadaHistorico }
  | { tipo: "solta"; chave: string; entrada: string; fim: string; n: Solta };

function corDaBarra(min: number, alertaMin: number): string {
  if (min >= alertaMin) return COR_BARRA.longa;
  if (min >= alertaMin - 10) return COR_BARRA.chegando;
  return COR_BARRA.curta;
}

/** Faixas: item que começa antes do anterior terminar desce uma faixa. */
function emFaixas(itens: Item[]): { item: Item; faixa: number }[] {
  const fins: number[] = [];
  return [...itens]
    .sort((a, b) => Date.parse(a.entrada) - Date.parse(b.entrada))
    .map((item) => {
      const ini = Date.parse(item.entrada);
      let faixa = fins.findIndex((f) => f <= ini);
      if (faixa < 0) faixa = fins.length;
      fins[faixa] = Date.parse(item.fim);
      return { item, faixa };
    });
}

function notificado(n: NotificacaoAcolhimento): string {
  const partes = [
    n.chegada && `chegada ${hora(n.chegada)}`,
    n.passagem && `passagem ${hora(n.passagem)}`,
    n.liberada ? `liberada ${hora(n.liberada)}` : "sem liberação",
    n.maca && `maca retida ${hora(n.maca.inicio)}–${n.maca.fim ? hora(n.maca.fim) : "…"}`,
  ].filter(Boolean);
  return partes.join(" · ");
}

function descricao(i: Item, hospitalNome: string): string {
  if (i.tipo === "solta") {
    return `${i.n.unidade} notificou no Acolhimentos (${hospitalNome}): ${notificado(i.n)} — sem parada no GPS (sem sinal ou fora do raio)`;
  }
  const p = i.p;
  const quem = `${p.nome}${p.tipo ? ` (${p.tipo}${p.base ? ` · ${p.base}` : ""})` : ""}`;
  const fim = p.aberta ? "ainda lá" : p.motivoFim === "sem-sinal" ? `sem sinal desde ${hora(p.fim)}` : `saiu ${hora(p.fim)}`;
  const gps = `${quem} ${p.naBase ? "na própria base, junto d" : "n"}${artigo(hospitalNome)} ${hospitalNome} · entrou ${hora(p.entrada)} · ${p.minutos} min · ${fim}`;
  if (p.acolhimento) return `${gps}. Acolhimentos: ${notificado(p.acolhimento)}`;
  if (p.semNotificacao) return `${gps}. Sem notificação no Acolhimentos.`;
  return gps;
}

export default function LinhaDoTempo({ onHospital }: { onHospital?: (id: string) => void }) {
  const [horas, setHoras] = useState<number>(() => Number(localStorage.getItem("tabela:frotaHoras")) || 12);
  const { data, isLoading } = useLinhaDoTempoFrota(horas);
  const [sel, setSel] = useState<string | null>(null);

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
    const itens: Item[] = [
      ...data.paradas.map((p): Item => ({ tipo: "parada", chave: `p${p.id}`, entrada: p.entrada, fim: p.fim, p })),
      ...data.acolhimentos.soltas.map(
        (n, i): Item => ({
          tipo: "solta",
          chave: `n${i}`,
          entrada: (n.chegada ?? n.passagem)!,
          fim: n.fim,
          n,
        }),
      ),
    ];
    const linhas = data.hospitais.flatMap((h) => {
      const doHospital = itens.filter((i) => (i.tipo === "parada" ? i.p.hospitalId : i.n.hospitalId) === h.id);
      const paradas = data.paradas.filter((p) => p.hospitalId === h.id && !p.naBase);
      if (h.tipo === "upa" && !doHospital.length) return [];
      const barras = emFaixas(doHospital);
      return {
        ...h,
        barras,
        faixas: Math.max(1, ...barras.map((b) => b.faixa + 1)),
        maior: Math.max(0, ...paradas.map((p) => p.minutos)),
        longas: paradas.filter((p) => p.minutos >= data.alertaMin).length,
        semNotificacao: paradas.filter((p) => p.semNotificacao).length,
        total: paradas.length,
      };
    });
    return { x, marcas, linhas, itens };
  }, [data, horas]);

  const selecionado = vista?.itens.find((i) => i.chave === sel) ?? null;
  const nomeHospital = (id: string) => data?.hospitais.find((h) => h.id === id)?.nome ?? id;
  const cruzando = Boolean(data?.acolhimentos.ligado && !data.acolhimentos.erro);

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 p-4">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">
          Linha do tempo nos hospitais
          {cruzando && <span className="normal-case font-bold text-slate-400"> · GPS × Acolhimentos</span>}
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

      {data?.acolhimentos.erro && (
        <div className="text-[11px] text-amber-700 mb-2">Acolhimentos indisponível agora ({data.acolhimentos.erro}) — mostrando só o GPS.</div>
      )}

      {/* Detalhe do item tocado — funciona com mouse e com dedo */}
      <div className="min-h-[20px] text-[12px] mb-2" style={{ color: selecionado ? "#0f172a" : "#94a3b8" }}>
        {selecionado
          ? descricao(selecionado, nomeHospital(selecionado.tipo === "parada" ? selecionado.p.hospitalId : selecionado.n.hospitalId))
          : "Passe o mouse ou toque numa barra para ver a parada."}
      </div>

      {isLoading || !vista || !data ? (
        <div className="text-[13px] text-slate-400 py-6">Carregando…</div>
      ) : (
        <>
          <div className="grid grid-cols-[112px_minmax(0,1fr)_104px] gap-x-2 text-[11px]">
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

            {vista.linhas.map((l) => {
              const altura = l.faixas * FAIXA_PX + 6;
              return (
                <div key={l.id} className="contents">
                  <button
                    onClick={() => onHospital?.(l.id)}
                    className="text-left font-extrabold text-slate-700 bg-transparent border-none border-t border-slate-100 p-0 cursor-pointer hover:underline truncate"
                    style={{ height: altura }}
                    title={onHospital ? "Ver no mapa" : undefined}
                  >
                    {l.nome}
                  </button>
                  <div className="relative border-t border-slate-100" style={{ height: altura }}>
                    {vista.marcas.map((m) => (
                      <div key={m.pos} className="absolute top-0 bottom-0 w-px bg-slate-100" style={{ left: `${m.pos}%` }} />
                    ))}
                    {l.barras.map(({ item, faixa }) => {
                      const ini = vista.x(Date.parse(item.entrada));
                      const fim = vista.x(Date.parse(item.fim));
                      const top = 3 + faixa * FAIXA_PX;
                      const comum = {
                        onMouseEnter: () => setSel(item.chave),
                        onFocus: () => setSel(item.chave),
                        onClick: () => setSel(item.chave),
                        "aria-label": descricao(item, l.nome),
                      };
                      const largura = `max(6px, calc(${fim - ini}% - 2px))`;
                      const contorno = sel === item.chave ? "2px solid #0f172a" : "none";

                      if (item.tipo === "solta") {
                        return (
                          <button
                            key={item.chave}
                            {...comum}
                            className="absolute cursor-pointer overflow-hidden whitespace-nowrap text-left font-bold p-0 bg-white"
                            style={{
                              left: `${ini}%`, width: largura, top, height: FAIXA_PX - 6,
                              border: `2px dashed ${COR_NOTIFICADO}`, borderRadius: 4, color: COR_NOTIFICADO,
                              outline: contorno, outlineOffset: 1, fontSize: 10, lineHeight: `${FAIXA_PX - 10}px`,
                            }}
                          >
                            <span className="px-[4px]">{item.n.unidade} 📋 sem GPS</span>
                          </button>
                        );
                      }

                      const p = item.p;
                      const n = p.acolhimento;
                      const cor = p.naBase ? COR_BASE : corDaBarra(p.minutos, data.alertaMin);
                      const alturaBarra = cruzando ? FAIXA_PX - 10 : FAIXA_PX - 6;
                      // Posição de um horário da notificação dentro do espaço da linha.
                      const px = (iso: string) => vista.x(Date.parse(iso));
                      return (
                        <div key={item.chave}>
                          <button
                            {...comum}
                            className="absolute border-none cursor-pointer overflow-hidden whitespace-nowrap text-left text-white font-bold p-0"
                            style={{
                              left: `${ini}%`, width: largura, top, height: alturaBarra,
                              backgroundColor: cor,
                              borderRadius: p.aberta ? "4px 0 0 4px" : 4,
                              opacity: p.motivoFim === "sem-sinal" ? 0.5 : 1,
                              outline: contorno, outlineOffset: 1, fontSize: 10, lineHeight: `${alturaBarra}px`,
                            }}
                          >
                            {!p.naBase && p.minutos > data.alertaMin && (
                              <span className="absolute top-0 bottom-0 w-[2px] bg-white/80" style={{ left: `${(data.alertaMin / p.minutos) * 100}%` }} />
                            )}
                            <span className="relative px-[4px]">
                              {p.nome} {p.naBase ? "base " : ""}{p.minutos}′{p.aberta ? " ▸" : ""}
                              {n ? " 📋" : p.semNotificacao ? " · sem notificação" : ""}
                            </span>
                          </button>
                          {n && (n.chegada || n.passagem) && (
                            <div
                              className="absolute rounded-full pointer-events-none"
                              style={{
                                left: `${px((n.chegada ?? n.passagem)!)}%`,
                                width: `max(4px, ${px(n.fim) - px((n.chegada ?? n.passagem)!)}%)`,
                                top: top + alturaBarra + 2, height: 3, backgroundColor: COR_NOTIFICADO,
                              }}
                            >
                              {n.passagem && n.chegada && (
                                <span
                                  className="absolute -top-[2px] w-[2px] h-[7px] bg-slate-900"
                                  style={{
                                    left: `${((Date.parse(n.passagem) - Date.parse(n.chegada)) / Math.max(1, Date.parse(n.fim) - Date.parse(n.chegada))) * 100}%`,
                                  }}
                                />
                              )}
                            </div>
                          )}
                          {n?.maca && (
                            <div
                              className="absolute rounded-full pointer-events-none"
                              style={{
                                left: `${px(n.maca.inicio)}%`,
                                width: `max(4px, ${px(n.maca.fim ?? data.ate) - px(n.maca.inicio)}%)`,
                                top: top + alturaBarra + 6, height: 3, backgroundColor: COR_MACA,
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-slate-500 tabular-nums border-t border-slate-100 pt-[4px] leading-tight" style={{ height: altura }}>
                    {l.total ? (
                      <>
                        {l.total} · máx {l.maior}′
                        {l.longas > 0 && <span className="font-bold" style={{ color: COR_BARRA.longa }}> · {l.longas}×40+</span>}
                        {l.semNotificacao > 0 && <div className="text-[10px] text-slate-400">{l.semNotificacao} sem notificação</div>}
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </div>
                </div>
              );
            })}
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
              <span className="inline-block w-[14px] h-[10px] rounded-[3px]" style={{ background: COR_BASE }} /> na própria base (sem alerta)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-[14px] h-[10px] rounded-[3px] opacity-50" style={{ background: COR_BARRA.curta }} /> fechou sem sinal
            </span>
            {cruzando && (
              <>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-[14px] h-[3px] rounded-full" style={{ background: COR_NOTIFICADO }} /> 📋 notificado no Acolhimentos (tique = passagem)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-[14px] h-[3px] rounded-full" style={{ background: COR_MACA }} /> maca retida
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-[14px] h-[10px] rounded-[3px] bg-white" style={{ border: `2px dashed ${COR_NOTIFICADO}` }} /> notificado sem parada no GPS
                </span>
              </>
            )}
            {data.paradas.length === 0 && <span className="ml-auto">Nenhuma parada em hospital nas últimas {horas} h.</span>}
          </div>
        </>
      )}
    </div>
  );
}
