// ═══════════════════════════════════════════════════════════════
// Aba Destino — para onde levar ESTE paciente.
//
// Duas entradas (bairro da ocorrência + perfil clínico) e um ranking.
//
// A ordem é SÓ tempo de carro dentro do que o perfil permite. O estado do
// hospital aparece na cor e na tag, mas não move ninguém de lugar: o regulador
// vê que o primeiro da lista tomou duas vagas zero e decide com isso na mão.
// Ordem previsível é ordem que dá para defender no telefone.
//
// A tag não diz "aceitando" nem "negando" — diz o fato que produziu a cor, com
// a contagem e a janela. "2 vagas zero · 3h" é verificável; "negando" é um
// rótulo que cada plantonista interpreta de um jeito.
//
// Quem ficou de fora aparece com o motivo. Some calado seria indistinguível
// de bug, e o regulador ficaria sem saber se confia na lista.
// ═══════════════════════════════════════════════════════════════
import { Suspense, lazy, useEffect, useState } from "react";
import type { HospitalData, CaseRow, DestinoRanqueado, TipoLocal } from "../lib/types";
import { SM } from "../lib/constants";
import {
  usePerfisEncaminhamento,
  useEncaminhamento,
  useHospitaisMapa,
  useEncaminhamentoConfig,
} from "../hooks/useEncaminhamento";
// Mapas sob demanda: quem nunca abre esta aba não paga pelo peso deles.
// Google quando o servidor tem GOOGLE_MAPS_BROWSER_KEY; Leaflet continua como
// fallback para LAB sem chave e para quando o script do Google não sobe.
const MapaSalvador = lazy(() => import("./MapaSalvador"));
const MapaGoogle = lazy(() => import("./MapaGoogle"));
import BuscaEndereco from "./BuscaEndereco";
import IntelChip from "./IntelChip";

function tempo(segundos: number | null): string {
  if (segundos === null) return "—";
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

function distancia(metros: number | null): string {
  if (metros === null) return "";
  return `${(metros / 1000).toFixed(1).replace(".", ",")} km`;
}

function haQuanto(ts: string): string {
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r > 0 ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

/** Rótulo do tipo — some no bairro, que é o caso comum e não precisa de aviso. */
const TIPO_LABEL: Record<TipoLocal, string> = {
  bairro: "",
  localidade: "localidade",
  largo: "largo",
  estacao: "estação",
  terminal: "terminal",
  ilha: "ilha",
  referencia: "referência",
};

const JANELA_ZERO_MS = 3 * 60 * 60 * 1000;
const JANELA_LOTACAO_MS = 3 * 60 * 60 * 1000;
const JANELA_ACEITE_MS = 60 * 60 * 1000;

type Cor = "red" | "yellow" | "green";

/**
 * Estado do hospital, em fato contado — não em rótulo.
 *
 * Escada de precedência, do mais duro ao mais brando:
 *   vermelho  já recusou paciente nas últimas 3h (fato consumado)
 *   amarelo   alguém avisou lotação há menos de 3h (relato, ainda não recusa)
 *   verde     nada disso; a tag só aparece se aceitou na última hora
 *
 * Vaga zero ganha da lotação porque uma é recusa registrada e a outra é
 * informação de corredor. Tudo além de 3h fica sem tag: no plantão, dado de
 * quatro horas atrás não descreve mais a porta do hospital.
 */
function situacao(
  h: HospitalData | undefined,
  casos: CaseRow[],
): { cor: Cor; tag: string | null } {
  if (!h) return { cor: "green", tag: null };
  const agora = Date.now();
  const desde = (ts: string, janela: number) => agora - new Date(ts).getTime() <= janela;

  const zeros = casos.filter((c) => c.situacao === "ZERO" && desde(c.timestamp, JANELA_ZERO_MS));
  if (zeros.length > 0) {
    return {
      cor: "red",
      tag: `${zeros.length} vaga${zeros.length > 1 ? "s" : ""} zero · 3h`,
    };
  }

  const lotacao = h.intel
    .filter((i) => i.tipo === "lotado" && desde(i.timestamp, JANELA_LOTACAO_MS))
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0];
  if (lotacao) {
    return { cor: "yellow", tag: `lotação avisada há ${haQuanto(lotacao.timestamp)}` };
  }

  const aceites = casos
    .filter((c) => c.situacao === "ACEITO" && desde(c.timestamp, JANELA_ACEITE_MS))
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  if (aceites.length > 0) {
    return { cor: "green", tag: `aceitou há ${haQuanto(aceites[0].timestamp)}` };
  }

  return { cor: "green", tag: null };
}

interface Props {
  hospitals: HospitalData[];
  /** Casos ativos das últimas 24h. Não uso h.cases: aquilo zera às 07:00, e
   *  logo depois da virada a janela de 3h ficaria cega para a madrugada. */
  timelineCases: CaseRow[];
}

export default function EncaminharView({ hospitals, timelineCases }: Props) {
  const [local, setLocal] = useState("");
  const [perfil, setPerfil] = useState("");
  const [ponto, setPonto] = useState<{ lat: number; lng: number } | null>(null);
  const [verExcluidos, setVerExcluidos] = useState(false);
  const [verMapa, setVerMapa] = useState(
    () => localStorage.getItem("tabela:destinoMapa") !== "false",
  );
  const [googleFalhou, setGoogleFalhou] = useState(false);

  const { data: perfis } = usePerfisEncaminhamento();
  const { data: hospitaisMapa = [] } = useHospitaisMapa();
  const { data: cfg } = useEncaminhamentoConfig();
  const { data, isFetching, error } = useEncaminhamento(local, perfil, ponto);
  const mapsKey = googleFalhou ? null : (cfg?.mapsKey ?? null);

  useEffect(() => {
    localStorage.setItem("tabela:destinoMapa", String(verMapa));
  }, [verMapa]);

  // As duas origens são exclusivas: digitar descarta o ponto, clicar descarta
  // o texto. Manter as duas na tela deixaria o regulador sem saber qual
  // produziu o ranking que está lendo.
  const digitar = (texto: string) => {
    setLocal(texto);
    if (ponto) setPonto(null);
  };
  const clicarNoMapa = (lat: number, lng: number) => {
    setPonto({ lat, lng });
    setLocal("");
  };
  // Sugestão do Google escolhida: vira ponto (mesmo fluxo do clique — encaixe
  // no lugar conhecido, rota materializada), e o rótulo fica no campo para o
  // regulador ver o que escolheu. Digitar de novo derruba o ponto, como hoje.
  const escolherEndereco = (lat: number, lng: number, rotulo: string) => {
    setPonto({ lat, lng });
    setLocal(rotulo);
  };

  // O mapa desenha as rotas a partir da origem do ranking: o ponto exato
  // quando houve clique/endereço, ou o centro do lugar quando foi texto.
  const origemRotas =
    ponto ??
    (data?.local?.lat != null && data?.local?.lng != null
      ? { lat: data.local.lat, lng: data.local.lng }
      : null);
  // Só os primeiros com tempo viram linha: 3 rotas contam a história sem
  // virar novelo, e cada uma é uma chamada cobrada de Directions.
  const rotasMapa = (data?.destinos ?? [])
    .filter((d) => d.segundos !== null)
    .slice(0, 3)
    .map((d) => d.hospitalId);

  const porId = new Map(hospitals.map((h) => [h.id, h]));
  const casosPorHospital = new Map<string, CaseRow[]>();
  for (const c of timelineCases) {
    const lista = casosPorHospital.get(c.hospitalId);
    if (lista) lista.push(c);
    else casosPorHospital.set(c.hospitalId, [c]);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Entradas ── */}
      <div className="bg-white rounded-[10px] border border-slate-200 p-4">
        <div className="text-[11px] font-extrabold text-slate-600 mb-3 uppercase tracking-wide">
          <span className="mr-[6px]">🚑</span>Para onde levar
        </div>
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[240px]">
            <BuscaEndereco
              valor={local}
              mapsKey={mapsKey}
              onDigitar={digitar}
              onEscolherEndereco={escolherEndereco}
            />
          </div>
          <div className="flex-1 min-w-[240px]">
            <label className="block text-[11px] font-bold text-slate-500 mb-1">
              Perfil do paciente
            </label>
            <select
              value={perfil}
              onChange={(e) => setPerfil(e.target.value)}
              className="w-full py-2 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-blue-600 bg-white cursor-pointer"
            >
              <option value="">Selecione…</option>
              {perfis?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setVerMapa((v) => !v)}
            className="py-2 px-3 text-xs font-bold rounded-lg border cursor-pointer whitespace-nowrap"
            style={{
              borderColor: verMapa ? "#1d4ed8" : "#cbd5e1",
              backgroundColor: verMapa ? "#eff6ff" : "#fff",
              color: verMapa ? "#1d4ed8" : "#64748b",
            }}
          >
            🗺️ Mapa
          </button>
        </div>

        {verMapa && (
          <div className="mt-3">
            <div className="text-[11px] text-slate-500 mb-[6px]">
              Clique onde está a ocorrência. O ranking sai do lugar conhecido mais
              próximo — a linha tracejada mostra o quanto foi aproximado
              {mapsKey ? "; as linhas coloridas são as rotas dos primeiros destinos" : ""}.
            </div>
            <Suspense
              fallback={
                <div className="w-full h-[320px] rounded-[10px] border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
                  carregando o mapa…
                </div>
              }
            >
              {cfg === undefined && !googleFalhou ? (
                // Config ainda no ar: esperar evita baixar o Leaflet à toa
                // para logo depois trocá-lo pelo Google.
                <div className="w-full h-[320px] rounded-[10px] border border-slate-200 bg-slate-50" />
              ) : mapsKey ? (
                <MapaGoogle
                  mapsKey={mapsKey}
                  mapId={cfg?.mapId ?? "DEMO_MAP_ID"}
                  ponto={ponto}
                  encaixe={data?.encaixe ?? null}
                  hospitais={hospitaisMapa}
                  origem={origemRotas}
                  rotas={rotasMapa}
                  onEscolher={clicarNoMapa}
                  onFalha={() => setGoogleFalhou(true)}
                />
              ) : (
                <MapaSalvador
                  ponto={ponto}
                  encaixe={data?.encaixe ?? null}
                  hospitais={hospitaisMapa}
                  onEscolher={clicarNoMapa}
                />
              )}
            </Suspense>
          </div>
        )}
      </div>

      {/* ── Estado inicial ── */}
      {!data && !isFetching && (
        <div className="bg-white rounded-[10px] border border-slate-200 py-10 px-6 text-center">
          <div className="text-3xl mb-2">🗺️</div>
          <div className="text-sm font-bold text-slate-700 mb-1">
            Informe o local e o perfil do paciente
          </div>
          <div className="text-xs text-slate-500 max-w-md mx-auto">
            Vale bairro, rua, ponto de referência ou apelido — "Iguatemi" e
            "CAB" funcionam. A lista sai por tempo de carro, dentro dos
            hospitais que atendem aquele perfil. Hospital que não atende não
            aparece, nem se for na esquina da ocorrência.
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-[10px] p-3 text-sm font-semibold text-red-700">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <>
          {/* ── Contexto ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {data.local && (
              <span className="inline-flex items-center gap-[5px] px-2 py-[3px] text-xs font-extrabold rounded-[5px] bg-slate-800 text-white">
                📍 {data.local.nome}
                {data.local.tipo !== "bairro" && (
                  <span className="font-semibold text-slate-400">{TIPO_LABEL[data.local.tipo]}</span>
                )}
              </span>
            )}
            <span className="inline-flex items-center px-2 py-[3px] text-xs font-extrabold rounded-[5px] bg-blue-100 text-blue-800">
              {data.perfil.label}
            </span>
            {data.destinos.length > 0 && (
              <span className="text-xs text-slate-500 font-semibold">
                {data.destinos.length} destino{data.destinos.length !== 1 ? "s" : ""} possíve
                {data.destinos.length !== 1 ? "is" : "l"}
              </span>
            )}
            {isFetching && <span className="text-xs text-slate-400">atualizando…</span>}
          </div>

          {/* O tamanho da aproximação fica à vista: na periferia o lugar
              conhecido mais próximo chega a ficar a 2 km do ponto clicado. */}
          {data.encaixe && (
            <div
              className="text-[11px] font-semibold rounded-[8px] px-3 py-2 border"
              style={
                data.encaixe.metros > 800
                  ? { backgroundColor: "#fffbeb", borderColor: "#fde68a", color: "#b45309" }
                  : { backgroundColor: "#f8fafc", borderColor: "#e2e8f0", color: "#64748b" }
              }
            >
              {data.encaixe.metros > 800 ? "⚠️ " : "📐 "}
              Tempo calculado a partir de <strong>{data.encaixe.nome}</strong>,{" "}
              {data.encaixe.metros >= 1000
                ? `${(data.encaixe.metros / 1000).toFixed(1).replace(".", ",")} km`
                : `${data.encaixe.metros} m`}{" "}
              do ponto marcado.
            </div>
          )}

          {data.aviso && (
            <div className="bg-amber-50 border border-amber-300 rounded-[10px] p-3 text-[13px] font-semibold text-amber-900">
              ⚠️ {data.aviso}
            </div>
          )}

          {/* ── Bairro ambíguo ── */}
          {data.candidatos.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {data.candidatos.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setLocal(c.nome)}
                  className="py-[6px] px-3 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-700 cursor-pointer hover:border-blue-600"
                >
                  {c.nome}
                  {c.tipo !== "bairro" && (
                    <span className="ml-[6px] font-semibold text-slate-400">{TIPO_LABEL[c.tipo]}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ── Ranking ── */}
          <div className="flex flex-col gap-2">
            {data.destinos.map((d: DestinoRanqueado, i: number) => {
              const h = porId.get(d.hospitalId);
              const { cor, tag } = situacao(h, casosPorHospital.get(d.hospitalId) ?? []);
              const st = SM[cor];
              const alertas = h?.intel.filter((x) => x.tipo !== "pretendo_enviar") ?? [];

              return (
                <div
                  key={d.hospitalId}
                  className="relative flex items-center gap-4 rounded-[14px] bg-white overflow-hidden py-3 pl-5 pr-4"
                  style={{ border: `2px solid ${st.bd}66` }}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[5px]"
                    style={{ backgroundColor: st.bd }}
                  />

                  {/* Posição — a ordem é a informação, então ela é o primeiro
                      elemento e não compete em cor com o semáforo. */}
                  <div className="w-8 h-8 shrink-0 rounded-full bg-slate-900 text-white text-sm font-black flex items-center justify-center">
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[17px] font-black text-slate-900">{d.nome}</span>
                      {tag && (
                        <span
                          className="inline-flex items-center px-[6px] py-[1px] text-[10px] font-extrabold rounded-[4px] whitespace-nowrap"
                          style={{
                            backgroundColor: st.bg,
                            color: st.tx,
                            border: `1px solid ${st.bd}55`,
                          }}
                        >
                          {tag}
                        </span>
                      )}
                    </div>

                    {d.ressalva && (
                      <div className="mt-1 text-[11px] font-bold text-amber-700 flex items-start gap-1">
                        <span>⚠️</span>
                        <span>{d.ressalva}</span>
                      </div>
                    )}

                    {alertas.length > 0 && (
                      <div className="mt-[6px] flex flex-col gap-1">
                        {alertas.map((x) => (
                          <IntelChip key={x.id} i={x} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-xl font-black text-slate-900 leading-none">
                      {tempo(d.segundos)}
                    </div>
                    <div className="text-[11px] text-slate-500 font-semibold mt-1">
                      {distancia(d.metros)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Excluídos ── */}
          {data.excluidos.length > 0 && (
            <div className="bg-white rounded-[10px] border border-slate-200 overflow-hidden">
              <button
                onClick={() => setVerExcluidos((v) => !v)}
                className="w-full flex items-center justify-between py-[10px] px-4 bg-transparent border-none cursor-pointer text-left"
              >
                <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">
                  Fora desta lista ({data.excluidos.length})
                </span>
                <span className="text-slate-400 text-xs">{verExcluidos ? "▲" : "▼"}</span>
              </button>
              {verExcluidos && (
                <div className="border-t border-slate-200">
                  {data.excluidos.map((x) => (
                    <div
                      key={x.hospitalId}
                      className="flex items-center justify-between gap-3 py-2 px-4 border-b border-slate-100 last:border-b-0"
                    >
                      <span className="text-[13px] font-bold text-slate-500">{x.nome}</span>
                      <span className="text-[11px] text-slate-400 text-right">{x.motivo}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
