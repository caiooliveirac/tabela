// ═══════════════════════════════════════════════════════════════
// Tabela embaixo do mapa: toda viatura que está agora no raio de um
// hospital ou UPA, com a hora em que entrou e há quanto tempo está lá.
//
// Primeiro as que contam para a retenção (mais antigas no topo), depois as
// que estão na própria base — Pau Miúdo, junto do HGESF/Mário Leal, e
// Cajazeiras, no Municipal — em cinza: a hora de entrada aparece, mas não
// geram alerta. Clicar na linha leva o mapa até a viatura.
// ═══════════════════════════════════════════════════════════════
import { useMemo } from "react";
import type { PainelFrota, ViaturaFrota } from "../../lib/types";
import { useLinhaDoTempoFrota } from "../../hooks/useFrota";
import { COR, corDaParada, duracao, estadoOcorrencia, hora } from "./formato";

interface Props {
  painel: PainelFrota;
  noMapa: ViaturaFrota[];
  onVer: (v: ViaturaFrota) => void;
}

function Situacao({ v, alertaMin }: { v: ViaturaFrota; alertaMin: number }) {
  const n = v.noHospital!;
  const est = estadoOcorrencia(v);
  // Na base: livre é disponível; em ocorrência no endereço da base, não.
  const [cor, texto] = n.naBase
    ? est === "ocorrencia"
      ? [COR.ocorrencia, "base · em ocorrência"]
      : est === "retornando"
        ? [COR.vazio, "base · encerrando"]
        : est === "livre"
          ? [COR.livre, "base · livre"]
          : [COR.vazio, "base no hospital"]
    : n.alerta
      ? [COR.alerta, `⚠ ${alertaMin} min ou mais`]
      : n.minutos >= alertaMin - 10
        ? [COR.atrasada, `perto dos ${alertaMin}`]
        : [COR.hospital, "no hospital"];
  return (
    <span
      className="inline-block px-[6px] py-[1px] rounded-[4px] text-[11px] font-extrabold whitespace-nowrap"
      style={{ color: cor, backgroundColor: `color-mix(in srgb, ${cor} 10%, white)`, border: `1px solid color-mix(in srgb, ${cor} 35%, white)` }}
    >
      {texto}
    </span>
  );
}

/** Na própria base, mas o mapa de equipes ainda a dá em ocorrência (ou retornando). */
function ocupadaNaBase(v: ViaturaFrota): boolean {
  const est = estadoOcorrencia(v);
  return Boolean(v.noHospital?.naBase) && (est === "ocorrencia" || est === "retornando");
}

/** Conta para a leitura da tabela: fora da base, ou na base ainda em ocorrência. */
function pesa(v: ViaturaFrota): boolean {
  return !v.noHospital!.naBase || ocupadaNaBase(v);
}

export default function TabelaHospitais({ painel, noMapa, onVer }: Props) {
  // As paradas abertas sempre vêm na linha do tempo, com o cruzamento do Acolhimentos.
  const { data: historico } = useLinhaDoTempoFrota(6);
  const acolhimentoPorId = useMemo(
    () => new Map((historico?.paradas ?? []).map((p) => [p.id, p])),
    [historico],
  );
  const cruzando = Boolean(historico?.acolhimentos.ligado && !historico.acolhimentos.erro);
  const L = painel.limites;
  // Só com o coletor do mapa de equipes mandando (api/src/frota/ocorrencias.ts).
  const comOcorrencia = noMapa.some((v) => v.ocorrencia);

  const linhas = useMemo(
    () =>
      noMapa
        .filter((v) => v.noHospital)
        .sort((a, b) => {
          // Na base em ocorrência entra na ordem das que contam; só a base livre vai para o fim.
          const pa = pesa(a);
          const pb = pesa(b);
          if (pa !== pb) return pa ? -1 : 1;
          return b.noHospital!.minutos - a.noHospital!.minutos;
        }),
    [noMapa],
  );

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 p-4">
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">
          Ambulâncias em hospital ou UPA agora
        </div>
        <div className="text-[11px] text-slate-400">
          a até {L.raioM} m do prédio · clique na linha para ver no mapa
        </div>
      </div>

      {!linhas.length ? (
        <div className="text-[13px] text-slate-400 py-2">Nenhuma viatura no raio de um hospital ou UPA agora.</div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-[13px] border-collapse min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wide">
                <th className="py-2 pr-3 font-extrabold">Viatura</th>
                <th className="py-2 pr-3 font-extrabold">Hospital / UPA</th>
                <th className="py-2 pr-3 font-extrabold">Entrou</th>
                <th className="py-2 pr-3 font-extrabold">Tempo</th>
                <th className="py-2 pr-3 font-extrabold">Situação</th>
                {comOcorrencia && <th className="py-2 pr-3 font-extrabold">Ocorrência</th>}
                {cruzando && <th className="py-2 pr-3 font-extrabold">Acolhimentos</th>}
                <th className="py-2 font-extrabold">Posição</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((v) => {
                const n = v.noHospital!;
                const destaque = ocupadaNaBase(v);
                const apagada = n.naBase && !destaque;
                const cor = apagada
                  ? COR.base
                  : destaque
                    ? n.minutos >= L.alertaMin ? COR.alerta : COR.ocorrencia
                    : corDaParada(n.minutos, L.alertaMin);
                const h = n.id != null ? acolhimentoPorId.get(n.id) : undefined;
                return (
                  <tr
                    key={v.chave}
                    onClick={() => onVer(v)}
                    className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
                    style={{
                      color: apagada ? "#64748b" : "#0f172a",
                      backgroundColor: destaque ? `color-mix(in srgb, ${COR.ocorrencia} 8%, white)` : undefined,
                    }}
                    title={destaque ? "Na própria base, mas o mapa de equipes ainda a dá em ocorrência" : undefined}
                  >
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="font-black">{v.nome}</span>
                      {v.tipo && <span className="text-slate-400 font-semibold"> {v.tipo}</span>}
                      {v.base && <div className="text-[11px] text-slate-400 truncate max-w-[180px]">{v.base}</div>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="font-bold">{n.hospitalNome}</span>
                      {n.distanciaM != null && <span className="text-slate-400"> · a {n.distanciaM} m</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{hora(n.entrada)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap min-w-[120px]">
                      <div className="font-bold tabular-nums" style={{ color: apagada ? undefined : cor }}>
                        {duracao(n.minutos)}
                      </div>
                      {!apagada && (
                        <div className="h-[4px] rounded-full bg-slate-100 overflow-hidden mt-[3px] w-[100px]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.min(100, (n.minutos / L.alertaMin) * 100)}%`, backgroundColor: cor }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Situacao v={v} alertaMin={L.alertaMin} />
                    </td>
                    {comOcorrencia && (
                      <td className="py-2 pr-3 text-[12px]">
                        {!v.ocorrencia ? (
                          <span className="text-slate-300">—</span>
                        ) : v.ocorrencia.ocorrencia ? (
                          <>
                            <div className="font-bold">
                              {v.ocorrencia.ocorrencia.protocolo ?? "em ocorrência"}
                              {v.ocorrencia.ocorrencia.medico && (
                                <span className="font-semibold capitalize"> · MR {v.ocorrencia.ocorrencia.medico.toLowerCase()}</span>
                              )}
                            </div>
                            {v.ocorrencia.ocorrencia.status && (
                              <div className="text-[11px] text-slate-500 lowercase">
                                {v.ocorrencia.ocorrencia.status}
                                {v.ocorrencia.ocorrencia.statusEm && ` às ${hora(v.ocorrencia.ocorrencia.statusEm)}`}
                              </div>
                            )}
                            {(v.ocorrencia.ocorrencia.queixa || v.ocorrencia.ocorrencia.bairro) && (
                              <div className="text-[11px] text-slate-600 max-w-[280px]">
                                {[v.ocorrencia.ocorrencia.queixa, v.ocorrencia.ocorrencia.bairro].filter(Boolean).join(" · ")}
                              </div>
                            )}
                            {(v.ocorrencia.ocorrencia.hma || v.ocorrencia.ocorrencia.endereco) && (
                              <details className="text-[11px] text-slate-600 max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                                <summary className="cursor-pointer text-slate-400">endereço e HMA</summary>
                                {v.ocorrencia.ocorrencia.endereco && <div className="font-semibold">{v.ocorrencia.ocorrencia.endereco}</div>}
                                {v.ocorrencia.ocorrencia.hma && <div className="whitespace-pre-wrap">{v.ocorrencia.ocorrencia.hma}</div>}
                              </details>
                            )}
                          </>
                        ) : (
                          <span className="font-bold" style={{ color: COR.alerta }}>sem ocorrência</span>
                        )}
                      </td>
                    )}
                    {cruzando && (
                      <td className="py-2 pr-3 text-[12px]">
                        {h?.acolhimento ? (
                          <span>
                            📋 {[
                              h.acolhimento.chegada && `chegada ${hora(h.acolhimento.chegada)}`,
                              h.acolhimento.passagem && `passagem ${hora(h.acolhimento.passagem)}`,
                              h.acolhimento.maca && "maca retida",
                            ]
                              .filter(Boolean)
                              .join(" · ") || "notificado"}
                          </span>
                        ) : h?.semNotificacao ? (
                          <span className="font-bold" style={{ color: COR.alerta }}>sem notificação</span>
                        ) : (
                          <span className="text-slate-300">{v.tipo === "USA" ? "—" : "só USA"}</span>
                        )}
                      </td>
                    )}
                    <td className="py-2 text-[12px] text-slate-500 whitespace-nowrap">
                      {v.posicao ? (v.posicao.idadeMin < 1 ? "agora" : `há ${duracao(v.posicao.idadeMin)}`) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
