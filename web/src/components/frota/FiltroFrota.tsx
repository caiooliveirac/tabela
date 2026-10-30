// Barra de filtros acima do mapa da Frota e, com filtro ligado, a lista de
// quem passou (clicar leva o mapa até a viatura). A regra mora em filtro.ts.
import type { ReactNode } from "react";
import type { ViaturaFrota } from "../../lib/types";
import { COR, duracao, frase, textoResponsavel } from "./formato";
import {
  ATIVIDADES,
  BATERIA_BAIXA,
  FILTRO_VAZIO,
  ONDES,
  SINAL_FRACO,
  atividade,
  filtroAtivo,
  onde,
  opcoes,
  passa,
  type Atividade,
  type Filtro,
} from "./filtro";

const COR_ATIVIDADE: Record<Atividade, string> = {
  disponivel: COR.livre,
  ocorrencia: COR.ocorrencia,
  retornando: COR.vazio,
  movimento: COR.recente,
  "sem-info": "#94a3b8",
};

function Chip({ ativo, onClick, cor, children, title }: {
  ativo: boolean;
  onClick: () => void;
  cor?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={ativo}
      className={`flex items-center gap-[5px] px-[9px] py-[3px] rounded-full text-[12px] font-bold border cursor-pointer whitespace-nowrap ${
        ativo ? "bg-slate-800 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-700 hover:border-blue-600"
      }`}
    >
      {cor && <span className="w-[8px] h-[8px] rounded-full" style={{ backgroundColor: cor }} />}
      {children}
    </button>
  );
}

function Escolha({ valor, rotulo, itens, onChange }: {
  valor: string | null;
  rotulo: string;
  itens: [string, number][];
  onChange: (v: string | null) => void;
}) {
  if (!itens.length && !valor) return null;
  return (
    <select
      value={valor ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`py-[3px] px-2 rounded-lg border text-[12px] font-bold cursor-pointer max-w-[220px] ${
        valor ? "bg-slate-800 border-slate-800 text-white" : "bg-white border-slate-300 text-slate-700"
      }`}
    >
      <option value="">{rotulo}</option>
      {itens.map(([k, n]) => (
        <option key={k} value={k}>
          {frase(k)} ({n})
        </option>
      ))}
    </select>
  );
}

function resumo(v: ViaturaFrota): string {
  const oc = v.ocorrencia?.ocorrencia ?? null;
  const partes: string[] = [];
  const a = atividade(v);
  if (oc && (a === "ocorrencia" || a === "retornando")) {
    partes.push([oc.protocolo && `#${oc.protocolo}`, oc.risco, oc.status && frase(oc.status)].filter(Boolean).join(" · "));
  } else if (a === "movimento") {
    partes.push(`${Math.round(v.velocidade ?? 0)} km/h`);
  }
  const o = onde(v);
  if (o === "hospital") partes.push(`${v.noHospital!.hospitalNome} há ${duracao(v.noHospital!.minutos)}`);
  else if (o === "base") partes.push("na base");
  else if (oc?.bairro) partes.push(frase(oc.bairro));
  const resp = textoResponsavel(v.responsavel);
  if (resp) partes.push(resp);
  if (v.bateria != null && v.bateria < BATERIA_BAIXA) partes.push(`bateria ${v.bateria}%`);
  return partes.filter(Boolean).join(" · ");
}

interface Props {
  noMapa: ViaturaFrota[];
  filtradas: ViaturaFrota[];
  recenteMin: number;
  /** Sem o coletor do mapa de equipes, não há como dizer quem está livre. */
  comMapaEquipes: boolean;
  filtro: Filtro;
  setFiltro: (f: Filtro) => void;
  onVer: (v: ViaturaFrota) => void;
}

export default function FiltroFrota({ noMapa, filtradas, recenteMin, comMapaEquipes, filtro, setFiltro, onVer }: Props) {
  const muda = (p: Partial<Filtro>) => setFiltro({ ...filtro, ...p });
  // Cada contagem considera os outros filtros, não o próprio.
  const conta = (p: Partial<Filtro>, pred: (v: ViaturaFrota) => boolean) => {
    const f = { ...filtro, ...p };
    return noMapa.filter((v) => passa(v, f, recenteMin) && pred(v)).length;
  };
  const semAtividade = noMapa.filter((v) => passa(v, { ...filtro, atividade: null }, recenteMin));
  const comOcorrencia = noMapa.filter((v) => v.ocorrencia?.ocorrencia);
  const ligado = filtroAtivo(filtro);

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-[6px] flex-wrap">
        <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide mr-1">Mostrar</span>
        <Chip ativo={!filtro.atividade} onClick={() => muda({ atividade: null })}>
          Todas <span className="tabular-nums opacity-70">{semAtividade.length}</span>
        </Chip>
        {ATIVIDADES.map((a) => {
          const n = semAtividade.filter((v) => atividade(v) === a.id).length;
          if (!n && filtro.atividade !== a.id && (a.id === "sem-info" || a.id === "retornando")) return null;
          return (
            <Chip
              key={a.id}
              ativo={filtro.atividade === a.id}
              onClick={() => muda({ atividade: filtro.atividade === a.id ? null : a.id })}
              cor={COR_ATIVIDADE[a.id]}
              title={a.nota}
            >
              {a.rotulo} <span className="tabular-nums opacity-70">{n}</span>
            </Chip>
          );
        })}
        {!comMapaEquipes && (
          <span className="text-[11px] text-amber-700 font-semibold">
            mapa de equipes mudo: sem como saber quem está livre ou em ocorrência
          </span>
        )}
      </div>

      <div className="flex items-center gap-[6px] flex-wrap">
        {(["USA", "USB", "MOTO"] as const).map((t) => (
          <Chip
            key={t}
            ativo={filtro.tipos.includes(t)}
            onClick={() =>
              muda({ tipos: filtro.tipos.includes(t) ? filtro.tipos.filter((x) => x !== t) : [...filtro.tipos, t] })
            }
          >
            {t === "MOTO" ? "Moto" : t}{" "}
            <span className="tabular-nums opacity-70">{conta({ tipos: [] }, (v) => v.tipo === t)}</span>
          </Chip>
        ))}
        <span className="w-px h-4 bg-slate-200 mx-1" />
        {ONDES.map((o) => (
          <Chip key={o.id} ativo={filtro.onde === o.id} onClick={() => muda({ onde: filtro.onde === o.id ? null : o.id })}>
            {o.rotulo} <span className="tabular-nums opacity-70">{conta({ onde: null }, (v) => onde(v) === o.id)}</span>
          </Chip>
        ))}
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <Escolha valor={filtro.base} rotulo="Toda base" itens={opcoes(noMapa, (v) => v.base)} onChange={(base) => muda({ base })} />
        <Escolha
          valor={filtro.risco}
          rotulo="Todo risco"
          itens={opcoes(comOcorrencia, (v) => v.ocorrencia?.ocorrencia?.risco)}
          onChange={(risco) => muda({ risco })}
        />
        <Escolha
          valor={filtro.fase}
          rotulo="Toda fase da ocorrência"
          itens={opcoes(comOcorrencia, (v) => v.ocorrencia?.ocorrencia?.status)}
          onChange={(fase) => muda({ fase })}
        />
      </div>

      <div className="flex items-center gap-[6px] flex-wrap">
        <Chip
          ativo={filtro.bateriaBaixa}
          onClick={() => muda({ bateriaBaixa: !filtro.bateriaBaixa })}
          title={`Celular da viatura abaixo de ${BATERIA_BAIXA}%`}
        >
          🔋 Bateria baixa{" "}
          <span className="tabular-nums opacity-70">
            {conta({ bateriaBaixa: false }, (v) => v.bateria != null && v.bateria < BATERIA_BAIXA)}
          </span>
        </Chip>
        <Chip
          ativo={filtro.sinalFraco}
          onClick={() => muda({ sinalFraco: !filtro.sinalFraco })}
          title={`Sinal do celular em ${SINAL_FRACO}% ou menos`}
        >
          📶 Sinal fraco{" "}
          <span className="tabular-nums opacity-70">
            {conta({ sinalFraco: false }, (v) => v.sinal != null && v.sinal <= SINAL_FRACO)}
          </span>
        </Chip>
        <Chip
          ativo={filtro.posicaoVelha}
          onClick={() => muda({ posicaoVelha: !filtro.posicaoVelha })}
          title={`Última posição com mais de ${recenteMin} min`}
        >
          ⏱ Posição atrasada{" "}
          <span className="tabular-nums opacity-70">
            {conta({ posicaoVelha: false }, (v) => (v.posicao?.idadeMin ?? 0) > recenteMin)}
          </span>
        </Chip>
        <input
          type="search"
          value={filtro.busca}
          onChange={(e) => muda({ busca: e.target.value })}
          placeholder="Buscar viatura, base, bairro, protocolo…"
          className="flex-1 min-w-[180px] max-w-[320px] py-[3px] px-[10px] rounded-lg border border-slate-300 text-[12px]"
        />
        {ligado && (
          <button
            type="button"
            onClick={() => setFiltro(FILTRO_VAZIO)}
            className="text-[12px] font-bold text-blue-700 hover:underline cursor-pointer"
          >
            limpar filtros
          </button>
        )}
      </div>

      {ligado && (
        <div className="border-t border-slate-100 pt-2">
          <div className="text-[12px] font-extrabold text-slate-700 mb-1">
            {filtradas.length} de {noMapa.length} no mapa{" "}
            <span className="font-semibold text-slate-400">· clique para ver no mapa</span>
          </div>
          {filtradas.length ? (
            <ul className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-3">
              {filtradas.map((v) => (
                <li key={v.chave}>
                  <button
                    type="button"
                    onClick={() => onVer(v)}
                    className="w-full flex items-baseline gap-2 py-[3px] text-[13px] text-left cursor-pointer hover:bg-slate-50 rounded"
                    title={v.base ?? undefined}
                  >
                    <span
                      className="w-[8px] h-[8px] rounded-full shrink-0 self-center"
                      style={{ backgroundColor: COR_ATIVIDADE[atividade(v)] }}
                    />
                    <span className="font-black text-slate-800 w-[52px] shrink-0">{v.nome}</span>
                    <span className="text-slate-500 truncate">{resumo(v)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[12px] text-slate-400">Nenhuma viatura no mapa com esses filtros.</div>
          )}
        </div>
      )}
    </div>
  );
}
