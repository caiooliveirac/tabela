// ═══════════════════════════════════════════════════════════════
// Aba Frota — onde está cada viatura e quem está parado em hospital.
//
// Leitura de cima para baixo: números do momento → mapa com os raios ao
// lado de "quem está em hospital agora" → quem NÃO está no mapa e por quê
// (sem sinal, fora do turno, desativada) → como a regra funciona.
// Os dados vêm de GET /tabela/api/frota (api/src/frota/README.md).
// ═══════════════════════════════════════════════════════════════
import { lazy, Suspense, useMemo, useState } from "react";
import type { PainelFrota, ViaturaFrota } from "../../lib/types";
import { useEncaminhamentoConfig } from "../../hooks/useEncaminhamento";
import { COR, corDaParada, duracao, ha, hora } from "./formato";
import type { Foco } from "./MapaFrota";

const MapaFrota = lazy(() => import("./MapaFrota"));

interface Props {
  painel: PainelFrota | undefined;
  carregando: boolean;
  erro: Error | null;
  foco: Foco | null;
  focar: (f: Omit<Foco, "vez">) => void;
}

function Numero({ valor, rotulo, cor, detalhe }: { valor: number; rotulo: string; cor: string; detalhe: string }) {
  return (
    <div className="flex-1 min-w-[120px] bg-white rounded-[10px] border border-slate-200 px-3 py-2" title={detalhe}>
      <div className="flex items-center gap-[6px]">
        <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ backgroundColor: cor }} />
        <span className="text-[22px] font-black text-slate-900 leading-none tabular-nums">{valor}</span>
      </div>
      <div className="text-[11px] font-bold text-slate-500 mt-1">{rotulo}</div>
    </div>
  );
}

function Linha({ v, extra }: { v: ViaturaFrota; extra: string }) {
  return (
    <li className="flex items-baseline gap-2 py-[3px] text-[13px]" title={v.base ?? undefined}>
      <span className="font-black text-slate-800 w-[52px] shrink-0">{v.nome}</span>
      <span className="text-slate-500 truncate">
        {extra}
        {v.bateria != null && v.bateria < 20 ? ` · bateria ${v.bateria}%` : ""}
      </span>
    </li>
  );
}

function Grupo({ titulo, nota, itens, extra }: {
  titulo: string;
  nota: string;
  itens: ViaturaFrota[];
  extra: (v: ViaturaFrota) => string;
}) {
  if (!itens.length) return null;
  return (
    <div className="mb-3">
      <div className="text-[12px] font-extrabold text-slate-700">
        {titulo} <span className="text-slate-400">· {itens.length}</span>
      </div>
      <div className="text-[11px] text-slate-400 mb-1">{nota}</div>
      <ul className="columns-2 gap-4">
        {itens.map((v) => (
          <Linha key={v.chave} v={v} extra={extra(v)} />
        ))}
      </ul>
    </div>
  );
}

export default function FrotaView({ painel, carregando, erro, foco, focar }: Props) {
  const { data: cfg } = useEncaminhamentoConfig();
  const [googleFalhou, setGoogleFalhou] = useState(false);
  const mapsKey = googleFalhou ? null : (cfg?.mapsKey ?? null);

  const grupos = useMemo(() => {
    const vs = painel?.viaturas ?? [];
    const idade = (v: ViaturaFrota) => v.posicao?.idadeMin ?? Infinity;
    const semSinal = vs.filter((v) => v.situacao === "sem-sinal").sort((a, b) => idade(a) - idade(b));
    return {
      noMapa: vs.filter((v) => v.situacao === "mapa" && v.posicao),
      hoje: semSinal.filter((v) => idade(v) < 24 * 60),
      diasSem: semSinal.filter((v) => v.posicao && idade(v) >= 24 * 60),
      nunca: semSinal.filter((v) => !v.posicao),
      semSinal,
      foraDoTurno: vs.filter((v) => v.situacao === "fora-do-turno"),
      desativadas: vs.filter((v) => v.situacao === "desativada"),
    };
  }, [painel]);

  const hospitais = useMemo(() => {
    const por = new Map<string, ViaturaFrota[]>();
    for (const v of grupos.noMapa) {
      if (!v.noHospital) continue;
      por.set(v.noHospital.hospitalId, [...(por.get(v.noHospital.hospitalId) ?? []), v]);
    }
    return [...por.entries()]
      .map(([id, dentro]) => ({
        id,
        nome: dentro[0].noHospital!.hospitalNome,
        dentro: dentro.sort((a, b) => b.noHospital!.minutos - a.noHospital!.minutos),
      }))
      .sort((a, b) => b.dentro[0].noHospital!.minutos - a.dentro[0].noHospital!.minutos);
  }, [grupos.noMapa]);

  if (!painel) {
    return (
      <div className="bg-white rounded-[10px] border border-slate-200 p-6 text-sm text-slate-500">
        {carregando ? "Carregando a frota…" : `Frota indisponível: ${erro?.message ?? "sem resposta"}`}
      </div>
    );
  }
  if (!painel.ativo) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-[10px] p-4 text-[13px] font-semibold text-amber-900">
        Integração com o SAMU+ desligada: o servidor está sem SAMUMAIS_TOKEN.
      </div>
    );
  }

  const L = painel.limites;
  const emHospital = grupos.noMapa.filter((v) => v.noHospital).length;
  const emAlerta = grupos.noMapa.filter((v) => v.noHospital?.alerta).length;
  const posicaoHa = (v: ViaturaFrota) => (v.posicao ? `última posição há ${duracao(v.posicao.idadeMin)}` : "");

  return (
    <div className="flex flex-col gap-4">
      {/* ── O momento, em números ── */}
      <div className="flex gap-2 flex-wrap">
        <Numero valor={grupos.noMapa.length} rotulo="no mapa" cor={COR.recente} detalhe="Posição da última hora" />
        <Numero valor={emHospital} rotulo="paradas em hospital" cor={COR.hospital} detalhe={`Dentro de ${L.raioM} m de um hospital`} />
        <Numero valor={emAlerta} rotulo={`há ${L.alertaMin} min ou mais`} cor={emAlerta ? COR.alerta : "#cbd5e1"} detalhe="Retenção de maca" />
        <Numero valor={grupos.semSinal.length} rotulo="sem sinal" cor={COR.atrasada} detalhe="Deviam estar na rua e não transmitem há mais de 1 h" />
        <Numero valor={grupos.foraDoTurno.length} rotulo="fora do turno" cor="#cbd5e1" detalhe="SD e 10h, de noite" />
        <Numero valor={grupos.desativadas.length} rotulo="desativadas" cor="#94a3b8" detalhe="Até segunda ordem ou no cadastro oficial" />
      </div>

      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-[10px] h-[10px] rounded-[3px]" style={{ background: COR.recente }} /> posição até {L.recenteMin} min
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-[10px] h-[10px] rounded-[3px]" style={{ background: COR.atrasada }} /> {L.recenteMin}–{L.mapaMin} min
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-[12px] h-[12px] rounded-full border-2" style={{ borderColor: COR.hospital, background: "#1d4ed81a" }} /> raio de {L.raioM} m com viatura dentro
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-[12px] h-[12px] rounded-full border-2" style={{ borderColor: COR.alerta, background: "#dc26262e" }} /> alguém parado há {L.alertaMin} min ou mais
        </span>
        <span className="ml-auto">
          SAMU+ lido {ha(painel.coletadoEm)}
          {painel.vinculosEm ? ` · nomes ${ha(painel.vinculosEm)}` : ""}
        </span>
      </div>

      {painel.erro && (
        <div className="bg-amber-50 border border-amber-300 rounded-[10px] p-3 text-[13px] font-semibold text-amber-900">
          ⚠️ A última leitura do SAMU+ falhou ({painel.erro}). Mostrando a anterior, de {ha(painel.coletadoEm)}.
        </div>
      )}

      {/* ── Mapa + quem está em hospital ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {mapsKey ? (
            <Suspense fallback={<div className="w-full h-[460px] rounded-[10px] border border-slate-200 bg-slate-50" />}>
              <MapaFrota
                mapsKey={mapsKey}
                mapId={cfg?.mapId ?? "DEMO_MAP_ID"}
                painel={painel}
                noMapa={grupos.noMapa}
                foco={foco}
                onFalha={() => setGoogleFalhou(true)}
              />
            </Suspense>
          ) : (
            <div className="w-full h-[160px] rounded-[10px] border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-500 text-center px-6">
              {cfg === undefined ? "carregando o mapa…" : "Mapa do Google indisponível agora. Os painéis ao lado e abaixo têm tudo o que o mapa mostraria."}
            </div>
          )}
        </div>

        <div className="bg-white rounded-[10px] border border-slate-200 p-3 lg:max-h-[460px] lg:overflow-y-auto">
          <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide mb-2">
            Nos hospitais agora
          </div>
          {!hospitais.length && (
            <div className="text-[13px] text-slate-400">Nenhuma viatura parada em hospital.</div>
          )}
          {hospitais.map((h) => (
            <div key={h.id} className="mb-3">
              <button
                onClick={() => {
                  const p = painel.hospitais.find((x) => x.id === h.id);
                  if (p) focar({ lat: p.lat, lng: p.lng, zoom: 17 });
                }}
                className="text-[14px] font-black text-slate-900 bg-transparent border-none p-0 cursor-pointer hover:underline"
              >
                {h.nome}
              </button>
              {h.dentro.map((v) => {
                const n = v.noHospital!;
                const cor = corDaParada(n.minutos, L.alertaMin);
                return (
                  <div key={v.chave} className="mt-[6px]">
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="font-extrabold text-slate-800">
                        {v.nome}
                        {v.tipo && <span className="font-semibold text-slate-400"> {v.tipo}</span>}
                      </span>
                      <span className="font-bold tabular-nums" style={{ color: cor }}>
                        {n.alerta ? `${duracao(n.minutos)} ⚠` : `${n.minutos} de ${L.alertaMin} min`}
                      </span>
                    </div>
                    <div className="h-[6px] rounded-full bg-slate-100 overflow-hidden mt-[3px]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(100, (n.minutos / L.alertaMin) * 100)}%`, backgroundColor: cor }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 mt-[2px]">
                      entrou {hora(n.entrada)} · posição de {hora(v.posicao!.em)}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Quem não está no mapa, e por quê ── */}
      <div className="bg-white rounded-[10px] border border-slate-200 p-4">
        <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide mb-3">
          Fora do mapa
        </div>
        <div className="grid gap-x-6 md:grid-cols-2">
          <div>
            <Grupo
              titulo="Pararam de transmitir hoje"
              nota="Deviam estar na rua: sem posição há mais de 1 h."
              itens={grupos.hoje}
              extra={posicaoHa}
            />
            <Grupo
              titulo="Sem transmitir há dias"
              nota="Rastreador desligado ou viatura parada há muito tempo."
              itens={grupos.diasSem}
              extra={posicaoHa}
            />
            <Grupo
              titulo="Nunca apareceram no SAMU+"
              nota="Estão no catálogo, mas o SAMU+ não tem posição delas."
              itens={grupos.nunca}
              extra={(v) => v.base ?? ""}
            />
          </div>
          <div>
            <Grupo
              titulo="Fora do turno agora"
              nota="SD e 10h rodam das 7h às 19h."
              itens={grupos.foraDoTurno}
              extra={(v) => v.motivo ?? ""}
            />
            <Grupo
              titulo="Desativadas"
              nota="Não contam como sem sinal nem entram na conta dos 40 min."
              itens={grupos.desativadas}
              extra={(v) => v.motivo ?? ""}
            />
            {painel.foraDoCatalogoSemSinal > 0 && (
              <div className="text-[11px] text-slate-400">
                + {painel.foraDoCatalogoSemSinal} unidades do SAMU+ fora do catálogo (evento, reserva) sem posição recente.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── A regra, em voz alta ── */}
      <details className="bg-white rounded-[10px] border border-slate-200 p-4 text-[13px] text-slate-600">
        <summary className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide cursor-pointer">
          Como funciona
        </summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>O SAMU+ informa a última posição de cada viatura; o painel lê a cada 2 minutos.</li>
          <li>
            Entrou no círculo de {L.raioM} m de um hospital, começa a contar. Só para de contar quando se afasta mais
            de {L.raioSaidaM} m — o GPS oscila na borda e não pode abrir e fechar a parada a cada leitura.
          </li>
          <li>
            Parada na própria base não conta: as bases do Pau Miúdo e de Cajazeiras ficam coladas no HGESF, no Mário
            Leal e no Municipal.
          </li>
          <li>
            Aos {L.alertaMin} min o círculo fica vermelho e abre um aviso em qualquer aba do painel. "Ciente" fecha o
            aviso só neste computador; a marca no mapa continua enquanto a viatura estiver lá.
          </li>
          <li>
            Sem posição nova há {L.recenteMin} min, o relógio para — não se conta tempo que não se viu. Sem posição há 1
            h, a parada é encerrada como "sem sinal".
          </li>
          <li>Desativadas até segunda ordem (29/09): 36, 39, 48, 64, 66, 67 e 68.</li>
        </ul>
      </details>
    </div>
  );
}
