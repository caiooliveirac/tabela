// ═══════════════════════════════════════════════════════════════
// Análise de retenção — /tabela/retencao (só chefia e admin).
//
// Quanto tempo as viaturas ficam paradas em hospital e UPA: por período,
// viatura, local e perfil do local. Os dados (GET /tabela/api/frota/retencao)
// são as mesmas paradas da aba Frota; o porteiro (mnrs-portal,
// `retencaoDaChefia`) só entrega a quem tem papel `chief` ou `admin`.
// A conta é toda aqui (estatistica.ts): filtro não volta ao servidor.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRetencao, SemAcessoRetencao } from "../../../api/client";
import {
  AMOSTRA_MIN, DIA_MS, FILTRO_INICIAL, PERFIS, calor, csv, dataHora, diaBahia, expandir, filtrar, histograma, inicioDoDia,
  minutos, ordenar, pct, porGrupo, resumir, rotuloFim, rotuloSituacao, serie, somarDias,
  type FiltroRetencao, type Ordem, type Parada, type PerfilLocal, type Resumo,
} from "./estatistica";
import { Calor, Distribuicao, LegendaTendencia, Ranking, Tendencia, type MetricaCalor, type MetricaTempo } from "./Graficos";

/** Primeira parada gravada (frota_permanencias): antes disto não há dado. */
const INICIO_DADOS = "2026-09-29";
const PRESETS = [7, 14, 30, 90] as const;

type Dimensao = "local" | "perfil" | "viatura" | "base";
const DIMENSOES: { id: Dimensao; rotulo: string }[] = [
  { id: "local", rotulo: "Local" },
  { id: "perfil", rotulo: "Perfil" },
  { id: "viatura", rotulo: "Viatura" },
  { id: "base", rotulo: "Base" },
];
const rotuloPerfil = (p: PerfilLocal) => PERFIS.find((x) => x.id === p)?.rotulo ?? p;

function Cartao({ titulo, nota, acao, children, id }: { titulo: string; nota?: ReactNode; acao?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-white rounded-[10px] border border-slate-200 p-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-black text-slate-800 m-0">{titulo}</h2>
          {nota && <div className="text-[11px] text-slate-500 mt-[2px]">{nota}</div>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Alternar<T extends string>({ valor, setValor, opcoes, rotulo }: { valor: T; setValor: (v: T) => void; opcoes: { id: T; rotulo: string }[]; rotulo: string }) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-[2px]">
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={valor === o.id}
          onClick={() => setValor(o.id)}
          className={`px-[10px] py-[3px] text-[11px] font-bold rounded-md ${valor === o.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Variação contra o período anterior. Mais tempo é pior: seta e palavra, nunca só a cor. */
function Variacao({ atual, antes, formato, melhorMenor = true }: { atual: number; antes: number | null; formato: (d: number) => string; melhorMenor?: boolean }) {
  if (antes == null || !Number.isFinite(atual) || !Number.isFinite(antes)) return <span className="text-slate-400">sem base de comparação</span>;
  const d = atual - antes;
  if (Math.abs(d) < 1e-9 || formato(Math.abs(d)) === formato(0)) return <span className="text-slate-500">= igual ao período anterior</span>;
  const pior = melhorMenor ? d > 0 : d < 0;
  return (
    <span className={pior ? "text-red-700" : "text-emerald-700"}>
      {d > 0 ? "▲" : "▼"} {formato(Math.abs(d))} {pior ? "pior" : "melhor"} que o período anterior
    </span>
  );
}

function Indicador({ rotulo, valor, detalhe, variacao }: { rotulo: string; valor: string; detalhe?: string; variacao?: ReactNode }) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 px-4 py-3 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="text-[26px] leading-tight font-black text-slate-900 tabular-nums">{valor}</div>
      {detalhe && <div className="text-[11px] text-slate-500">{detalhe}</div>}
      {variacao && <div className="text-[11px] font-semibold mt-[2px]">{variacao}</div>}
    </div>
  );
}

function baixar(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const hojeBahia = () => diaBahia(Date.now());

export default function RetencaoApp() {
  useEffect(() => {
    document.title = "Retenção de ambulâncias — SAMU Salvador";
  }, []);

  // ── Período (dias de Salvador, `ate` incluído) ──
  const [periodo, setPeriodo] = useState(() => ({ de: somarDias(hojeBahia(), -29), ate: hojeBahia(), preset: 30 as number | null }));
  const nDias = Math.round((inicioDoDia(periodo.ate) - inicioDoDia(periodo.de)) / DIA_MS) + 1;
  const deAnterior = somarDias(periodo.de, -nDias);
  const comAnterior = deAnterior >= INICIO_DADOS;
  const consulta = useQuery({
    queryKey: ["retencao", comAnterior ? deAnterior : periodo.de, periodo.ate],
    queryFn: () => getRetencao(comAnterior ? deAnterior : periodo.de, periodo.ate),
    enabled: nDias <= 92,
    refetchInterval: 5 * 60_000,
    retry: (n, e) => !(e instanceof SemAcessoRetencao) && n < 2,
  });
  const escolherPreset = (n: number) => setPeriodo({ de: somarDias(hojeBahia(), -(n - 1)), ate: hojeBahia(), preset: n });

  // ── Filtros ──
  const [filtro, setFiltro] = useState<FiltroRetencao>(FILTRO_INICIAL);
  const [metrica, setMetrica] = useState<MetricaTempo>("tempo");
  const [baldeEscolhido, setBalde] = useState<"auto" | "dia" | "semana">("auto");
  const balde = baldeEscolhido === "auto" ? (nDias > 45 ? "semana" : "dia") : baldeEscolhido;
  const [dimensao, setDimensao] = useState<Dimensao>("local");
  const [ordem, setOrdem] = useState<Ordem>("p90");
  const [metricaCalor, setMetricaCalor] = useState<MetricaCalor>("fracAlerta");

  const dados = consulta.data;
  const todas = useMemo(() => (dados ? expandir(dados) : []), [dados]);
  const alertaMin = dados?.alertaMin ?? 40;
  const ini = inicioDoDia(periodo.de);
  const fim = Math.min(inicioDoDia(periodo.ate) + DIA_MS, Date.now());
  const atuais = useMemo(() => filtrar(todas, filtro, ini, fim), [todas, filtro, ini, fim]);
  const anteriores = useMemo(
    () => (comAnterior ? filtrar(todas, filtro, inicioDoDia(deAnterior), ini) : []),
    [todas, filtro, comAnterior, deAnterior, ini],
  );
  const r = useMemo(() => resumir(atuais, alertaMin), [atuais, alertaMin]);
  const ra = useMemo<Resumo | null>(() => {
    const x = resumir(anteriores, alertaMin);
    return comAnterior && x.n >= 20 ? x : null;
  }, [anteriores, alertaMin, comAnterior]);
  const pontos = useMemo(() => serie(atuais, ini, fim, balde, alertaMin), [atuais, ini, fim, balde, alertaMin]);
  const faixas = useMemo(() => histograma(atuais), [atuais]);
  const grade = useMemo(() => calor(atuais, alertaMin), [atuais, alertaMin]);
  const grupos = useMemo(() => {
    const k = {
      local: [(p: Parada) => p.localId, (p: Parada) => p.local, (p: Parada) => rotuloPerfil(p.perfil)],
      perfil: [(p: Parada) => p.perfil, (p: Parada) => rotuloPerfil(p.perfil), () => ""],
      viatura: [(p: Parada) => p.viatura, (p: Parada) => p.viatura, (p: Parada) => `${p.tipo} · ${p.base}`],
      base: [(p: Parada) => p.base, (p: Parada) => p.base, () => ""],
    }[dimensao] as [(p: Parada) => string, (p: Parada) => string, (p: Parada) => string];
    return ordenar(porGrupo(atuais, k[0], k[1], k[2], alertaMin), ordem);
  }, [atuais, dimensao, ordem, alertaMin]);
  const longas = useMemo(() => [...atuais].sort((a, b) => b.min - a.min).slice(0, 15), [atuais]);

  // Listas dos filtros: tudo que aparece no período inteiro (não some ao filtrar).
  const opcoes = useMemo(() => {
    const locais = new Map<string, { nome: string; perfil: PerfilLocal }>();
    const viaturas = new Map<string, string>();
    for (const p of todas) {
      locais.set(p.localId, { nome: p.local, perfil: p.perfil });
      viaturas.set(p.viatura, p.tipo);
    }
    return {
      locais: [...locais.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome)),
      viaturas: [...viaturas.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true })),
    };
  }, [todas]);

  const alternarLocal = (id: string) =>
    setFiltro((f) => ({ ...f, locais: f.locais.includes(id) ? f.locais.filter((x) => x !== id) : [...f.locais, id] }));
  const alternarPerfil = (id: PerfilLocal) =>
    setFiltro((f) => ({ ...f, perfis: f.perfis.includes(id) ? f.perfis.filter((x) => x !== id) : [...f.perfis, id] }));
  const escolherNoRanking = (chave: string) => {
    if (dimensao === "local") alternarLocal(chave);
    else if (dimensao === "perfil") alternarPerfil(chave as PerfilLocal);
    else if (dimensao === "viatura") setFiltro((f) => ({ ...f, viatura: f.viatura === chave ? "" : chave }));
  };
  const filtroLigado = JSON.stringify(filtro) !== JSON.stringify(FILTRO_INICIAL);
  const livresNoPeriodo = useMemo(() => filtrar(todas, { ...filtro, incluirLivres: true }, ini, fim).filter((p) => p.situacao === "livre").length, [todas, filtro, ini, fim]);

  const semanas = Math.max(1, nDias / 7);
  const porDia = r.n / Math.max(1, (fim - ini) / DIA_MS);
  const porDiaAntes = ra ? ra.n / nDias : null;
  const fmtMin = (d: number) => minutos(d);
  const fmtPp = (d: number) => `${Math.round(d * 100)} p.p.`;

  return (
    <div className="font-sans bg-slate-50 min-h-screen text-slate-900">
      <header
        className="px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-[10px] shadow-lg"
        style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)" }}
      >
        <div>
          <div className="text-slate-400 text-[10px] font-bold tracking-[0.12em] uppercase">Coordenação SAMU · Salvador</div>
          <h1 className="text-white text-xl font-black m-0">Retenção de ambulâncias</h1>
        </div>
        <div className="flex gap-2">
          <a href={`${import.meta.env.BASE_URL}?tab=frota`} className="py-[7px] px-[12px] text-xs rounded-lg border border-white/20 bg-white/[.12] text-slate-200 font-bold no-underline">
            ← Frota ao vivo
          </a>
          <a href="https://mnrs.com.br/" className="py-[7px] px-[12px] text-xs rounded-lg border border-white/20 bg-white/[.12] text-slate-200 font-bold no-underline">
            Portal
          </a>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-4 max-w-[1400px] mx-auto w-full flex flex-col gap-4">
        {consulta.error instanceof SemAcessoRetencao ? (
          <div className="bg-white rounded-[10px] border border-slate-200 p-6 max-w-[560px]">
            <h2 className="text-lg font-black m-0 mb-1">Acesso restrito à coordenação</h2>
            <p className="text-[13px] text-slate-600 m-0">
              A análise de retenção abre para quem tem papel de chefia ou de administração no Plantões. Se recebeu o papel há
              pouco, saia e entre de novo pelo portal.
            </p>
          </div>
        ) : (
          <>
            {/* ── Filtros: uma faixa só, acima de tudo ── */}
            <div className="bg-white rounded-[10px] border border-slate-200 p-3 flex flex-col gap-2 sticky top-0 z-30 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Período</span>
                {PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={periodo.preset === n}
                    onClick={() => escolherPreset(n)}
                    className={`px-[10px] py-[3px] rounded-full text-[12px] font-bold border ${periodo.preset === n ? "bg-slate-800 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-slate-400"}`}
                  >
                    {n} dias
                  </button>
                ))}
                <label className="text-[12px] text-slate-600 inline-flex items-center gap-1">
                  de
                  <input
                    type="date"
                    value={periodo.de}
                    min={INICIO_DADOS}
                    max={periodo.ate}
                    onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, de: e.target.value, preset: null }))}
                    className="border border-slate-200 rounded-md px-1 py-[2px] text-[12px]"
                  />
                </label>
                <label className="text-[12px] text-slate-600 inline-flex items-center gap-1">
                  até
                  <input
                    type="date"
                    value={periodo.ate}
                    min={periodo.de}
                    max={hojeBahia()}
                    onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, ate: e.target.value, preset: null }))}
                    className="border border-slate-200 rounded-md px-1 py-[2px] text-[12px]"
                  />
                </label>
                {nDias > 92 && <span className="text-[11px] text-amber-700 font-semibold">máximo de 92 dias</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Tipo de viatura"
                  value={filtro.tipo}
                  onChange={(e) => setFiltro((f) => ({ ...f, tipo: e.target.value as FiltroRetencao["tipo"] }))}
                  className="border border-slate-200 rounded-md px-2 py-[3px] text-[12px] bg-white"
                >
                  <option value="">USA e USB</option>
                  <option value="USA">Só USA</option>
                  <option value="USB">Só USB</option>
                </select>
                <select
                  aria-label="Viatura"
                  value={filtro.viatura}
                  onChange={(e) => setFiltro((f) => ({ ...f, viatura: e.target.value }))}
                  className="border border-slate-200 rounded-md px-2 py-[3px] text-[12px] bg-white max-w-[160px]"
                >
                  <option value="">Todas as viaturas</option>
                  {opcoes.viaturas.map(([v, tipo]) => (
                    <option key={v} value={v}>{v} · {tipo}</option>
                  ))}
                </select>
                <select
                  aria-label="Local"
                  value={filtro.locais.length === 1 ? filtro.locais[0] : ""}
                  onChange={(e) => setFiltro((f) => ({ ...f, locais: e.target.value ? [e.target.value] : [] }))}
                  className="border border-slate-200 rounded-md px-2 py-[3px] text-[12px] bg-white max-w-[220px]"
                >
                  <option value="">{filtro.locais.length > 1 ? `${filtro.locais.length} locais escolhidos` : "Todos os locais"}</option>
                  {PERFIS.map((pf) => (
                    <optgroup key={pf.id} label={pf.rotulo}>
                      {opcoes.locais.filter(([, l]) => l.perfil === pf.id).map(([id, l]) => (
                        <option key={id} value={id}>{l.nome}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide ml-1">Perfil</span>
                {PERFIS.map((pf) => (
                  <button
                    key={pf.id}
                    type="button"
                    aria-pressed={filtro.perfis.includes(pf.id)}
                    onClick={() => alternarPerfil(pf.id)}
                    className={`px-[9px] py-[2px] rounded-full text-[11px] font-bold border ${filtro.perfis.includes(pf.id) ? "bg-blue-700 border-blue-700 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-slate-400"}`}
                  >
                    {pf.rotulo}
                  </button>
                ))}
                <label className="inline-flex items-center gap-1 text-[12px] text-slate-600 ml-1" title="Parada sem ocorrência aberta no mapa de equipes: viatura sem paciente.">
                  <input type="checkbox" checked={filtro.incluirLivres} onChange={(e) => setFiltro((f) => ({ ...f, incluirLivres: e.target.checked }))} />
                  incluir paradas livres{livresNoPeriodo ? ` (${livresNoPeriodo})` : ""}
                </label>
                <div className="flex-1" />
                {filtroLigado && (
                  <button type="button" onClick={() => setFiltro(FILTRO_INICIAL)} className="text-[12px] font-bold text-slate-600 hover:text-slate-900 underline">
                    Limpar filtros
                  </button>
                )}
                <button
                  type="button"
                  disabled={!atuais.length}
                  onClick={() => baixar(`retencao_${periodo.de}_${periodo.ate}.csv`, csv(atuais))}
                  className="px-[10px] py-[4px] rounded-md text-[12px] font-bold bg-slate-800 text-white disabled:opacity-40"
                >
                  Baixar CSV ({atuais.length})
                </button>
              </div>
            </div>

            {consulta.isLoading && <div className="text-[13px] text-slate-500">Carregando as paradas…</div>}
            {consulta.error && !(consulta.error instanceof SemAcessoRetencao) && (
              <div className="bg-amber-50 border border-amber-300 rounded-[10px] p-3 text-[13px] font-semibold text-amber-900">
                Não foi possível carregar: {consulta.error.message}
              </div>
            )}
            {dados && !dados.ativo && (
              <div className="bg-amber-50 border border-amber-300 rounded-[10px] p-3 text-[13px] font-semibold text-amber-900">
                Integração com o SAMU+ desligada no servidor: sem paradas.
              </div>
            )}

            {dados && (
              <>
                {/* ── Indicadores ── */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  <Indicador
                    rotulo="Paradas"
                    valor={String(r.n)}
                    detalhe={`${porDia.toFixed(1)} por dia · ${r.horasTotal.toFixed(0)} h no local`}
                    variacao={<Variacao atual={porDia} antes={porDiaAntes} formato={(d) => `${d.toFixed(1)}/dia`} />}
                  />
                  <Indicador
                    rotulo="Mediana"
                    valor={minutos(r.mediana)}
                    detalhe="metade das paradas dura menos"
                    variacao={<Variacao atual={r.mediana} antes={ra?.mediana ?? null} formato={fmtMin} />}
                  />
                  <Indicador
                    rotulo="P90"
                    valor={minutos(r.p90)}
                    detalhe={`9 em 10 duram menos · P95 ${minutos(r.p95)}`}
                    variacao={<Variacao atual={r.p90} antes={ra?.p90 ?? null} formato={fmtMin} />}
                  />
                  <Indicador
                    rotulo={`Retidas (${alertaMin}+ min)`}
                    valor={pct(r.fracAlerta)}
                    detalhe={`${Math.round(r.fracAlerta * r.n || 0)} paradas · ${pct(r.frac60)} com 60+ · ${pct(r.frac120)} com 2 h+`}
                    variacao={<Variacao atual={r.fracAlerta} antes={ra?.fracAlerta ?? null} formato={fmtPp} />}
                  />
                  <Indicador
                    rotulo={`Horas além de ${alertaMin} min`}
                    valor={`${r.horasAlem.toFixed(0)} h`}
                    detalhe={`≈ ${(r.horasAlem / Math.max(1, nDias)).toFixed(1)} h-viatura por dia`}
                    variacao={<Variacao atual={r.horasAlem / nDias} antes={ra ? ra.horasAlem / nDias : null} formato={(d) => `${d.toFixed(1)} h/dia`} />}
                  />
                  <Indicador
                    rotulo="Maior parada"
                    valor={minutos(r.maior)}
                    detalhe={r.abertas ? `${r.abertas} ainda no local agora` : "nenhuma em curso"}
                  />
                </div>
                <div className="text-[11px] text-slate-500 -mt-2">
                  {dataHora(ini).slice(0, 5)} a {periodo.ate.slice(8, 10)}/{periodo.ate.slice(5, 7)} ({nDias} dias)
                  {ra
                    ? ` · comparação com ${dataHora(inicioDoDia(deAnterior)).slice(0, 5)}–${dataHora(ini - DIA_MS).slice(0, 5)}, mesmos filtros (${ra.n} paradas)`
                    : comAnterior
                      ? " · período anterior com menos de 20 paradas: sem comparação"
                      : ` · sem comparação: os dados começam em ${INICIO_DADOS.split("-").reverse().join("/")}`}
                  {" · "}atualizado {dataHora(Date.parse(dados.geradoEm)).slice(6)}
                </div>

                {r.n === 0 ? (
                  <div className="bg-white rounded-[10px] border border-slate-200 p-6 text-[13px] text-slate-500">
                    Nenhuma parada de {dados.visitaMin} min ou mais com esses filtros no período.
                  </div>
                ) : (
                  <>
                    <Cartao
                      titulo="Evolução no período"
                      nota={`Por ${balde === "dia" ? "dia" : "semana"} da chegada. Dia com menos de ${AMOSTRA_MIN} paradas não entra no traço.`}
                      acao={
                        <div className="flex flex-wrap gap-2">
                          <Alternar
                            rotulo="Métrica"
                            valor={metrica}
                            setValor={setMetrica}
                            opcoes={[
                              { id: "tempo", rotulo: "Tempo" },
                              { id: "retidas", rotulo: `% ${alertaMin}+ min` },
                              { id: "paradas", rotulo: "Paradas" },
                            ]}
                          />
                          <Alternar
                            rotulo="Agrupar"
                            valor={baldeEscolhido}
                            setValor={setBalde}
                            opcoes={[
                              { id: "auto", rotulo: "Auto" },
                              { id: "dia", rotulo: "Dia" },
                              { id: "semana", rotulo: "Semana" },
                            ]}
                          />
                        </div>
                      }
                    >
                      <LegendaTendencia metrica={metrica} alertaMin={alertaMin} balde={balde} />
                      <div className="mt-2">
                        <Tendencia pontos={pontos} metrica={metrica} alertaMin={alertaMin} balde={balde} />
                      </div>
                      <details className="mt-2 text-[12px]">
                        <summary className="cursor-pointer text-slate-500 font-semibold">Ver como tabela</summary>
                        <div className="overflow-x-auto mt-2">
                          <table className="w-full text-[12px] tabular-nums">
                            <thead className="text-slate-500 text-left">
                              <tr><th>{balde === "dia" ? "Dia" : "Semana de"}</th><th className="text-right">Paradas</th><th className="text-right">Mediana</th><th className="text-right">P90</th><th className="text-right">{alertaMin}+ min</th><th className="text-right">Horas além</th></tr>
                            </thead>
                            <tbody>
                              {pontos.map((p) => (
                                <tr key={p.chave} className="border-t border-slate-100">
                                  <td>{dataHora(p.inicio).slice(0, 5)}</td>
                                  <td className="text-right">{p.resumo.n}</td>
                                  <td className="text-right">{p.resumo.n >= AMOSTRA_MIN ? minutos(p.resumo.mediana) : "—"}</td>
                                  <td className="text-right">{p.resumo.n >= AMOSTRA_MIN ? minutos(p.resumo.p90) : "—"}</td>
                                  <td className="text-right">{p.resumo.n >= AMOSTRA_MIN ? pct(p.resumo.fracAlerta) : "—"}</td>
                                  <td className="text-right">{p.resumo.horasAlem.toFixed(1)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </Cartao>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <Cartao
                        titulo="Quanto dura cada parada"
                        nota={`Distribuição de ${r.n} paradas. Laranja = ${alertaMin} min ou mais. Média ${minutos(r.media)} (puxada pelos casos longos — por isso a mediana).`}
                      >
                        <Distribuicao faixas={faixas} alertaMin={alertaMin} total={r.n} />
                      </Cartao>
                      <Cartao
                        titulo="Quando acontece"
                        nota={`Dia da semana × hora da chegada. ${metricaCalor === "n" ? "Paradas por semana" : metricaCalor === "mediana" ? "Mediana em minutos" : `% das paradas com ${alertaMin}+ min`}.`}
                        acao={
                          <Alternar
                            rotulo="Métrica do mapa de calor"
                            valor={metricaCalor}
                            setValor={setMetricaCalor}
                            opcoes={[
                              { id: "fracAlerta", rotulo: `% ${alertaMin}+` },
                              { id: "mediana", rotulo: "Mediana" },
                              { id: "n", rotulo: "Paradas" },
                            ]}
                          />
                        }
                      >
                        <Calor grade={grade} metrica={metricaCalor} alertaMin={alertaMin} semanas={semanas} />
                      </Cartao>
                    </div>

                    <Cartao
                      titulo={`Comparar por ${DIMENSOES.find((d) => d.id === dimensao)!.rotulo.toLowerCase()}`}
                      nota={`Barra = metade do meio das paradas; ponto = mediana; risco laranja = P90. Menos de ${AMOSTRA_MIN} paradas: só a contagem, no fim da lista.${dimensao !== "base" ? " Clique numa linha para filtrar." : ""}`}
                      acao={<Alternar rotulo="Agrupar por" valor={dimensao} setValor={setDimensao} opcoes={DIMENSOES} />}
                    >
                      <Ranking
                        linhas={grupos}
                        alertaMin={alertaMin}
                        ordem={ordem}
                        setOrdem={setOrdem}
                        rotuloGrupo={DIMENSOES.find((d) => d.id === dimensao)!.rotulo}
                        selecionados={dimensao === "local" ? filtro.locais : dimensao === "perfil" ? filtro.perfis : dimensao === "viatura" && filtro.viatura ? [filtro.viatura] : []}
                        onEscolher={dimensao === "base" ? undefined : escolherNoRanking}
                      />
                    </Cartao>

                    <Cartao titulo="Paradas mais longas" nota="As 15 maiores com os filtros atuais.">
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px] tabular-nums min-w-[560px]">
                          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                            <tr><th className="py-1">Chegada</th><th>Viatura</th><th>Local</th><th className="text-right">Duração</th><th className="pl-3">Mapa de equipes</th><th>Fim</th></tr>
                          </thead>
                          <tbody>
                            {longas.map((p) => (
                              <tr key={`${p.viatura}|${p.inicio}`} className="border-t border-slate-100">
                                <td className="py-[5px]">{dataHora(p.inicio)}</td>
                                <td className="font-bold">{p.viatura} <span className="font-normal text-slate-400">{p.tipo}</span></td>
                                <td>{p.local}</td>
                                <td className="text-right font-bold">{minutos(p.min)}</td>
                                <td className="pl-3 text-slate-600">{rotuloSituacao(p.situacao)}</td>
                                <td className={p.fim === "saiu" ? "text-slate-500" : "text-amber-700 font-semibold"}>{rotuloFim(p.fim)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Cartao>
                  </>
                )}

                <Cartao titulo="Como se mede">
                  <ul className="text-[12px] text-slate-600 leading-relaxed m-0 pl-4 list-disc">
                    <li>
                      <b>Parada</b>: viatura com GPS a até 150 m do hospital ou da UPA (ou de um estacionamento aprendido), por{" "}
                      {dados.visitaMin} min ou mais. Começa na primeira posição dentro e termina na saída. Posição a cada 2 min: erro de até ~2 min
                      em cada ponta.
                    </li>
                    <li>
                      <b>Retida</b>: {alertaMin} min ou mais — o mesmo limite do aviso no painel e no grupo da frota.{" "}
                      <b>Horas além</b> soma só o que passou do limite (55 min = 15 min além).
                    </li>
                    <li>
                      <b>Fora da conta</b>: parada na própria base ou no pátio comum, menos de {dados.visitaMin} min, numeral acima de 74 (RMS) e o
                      Mário Leal (vizinho do pátio do Pau Miúdo). Paradas <b>livres</b> (sem ocorrência no mapa de equipes, sem paciente) só entram
                      marcando a opção. "Sem dado do mapa" = ponte do mapa de equipes muda na hora: entra.
                    </li>
                    <li>
                      <b>Mediana e P90</b> em vez de média: poucos casos de horas puxam a média para cima. Menos de {AMOSTRA_MIN} paradas num
                      recorte: sem percentil. Comparação só com 20+ paradas no período anterior, de mesmo tamanho e mesmos filtros.
                    </li>
                    <li>
                      Parada ainda em curso conta até a última posição; a que fechou <b>sem sinal</b> ou por desativação vale como mínimo
                      ({r.semSinal} no recorte). Dia e hora de Salvador, pela chegada. Dados desde{" "}
                      {INICIO_DADOS.split("-").reverse().join("/")}. Fonte: SAMU+ (IMTECH) e mapa de equipes da regulação.
                    </li>
                    <li>Só tempo e local: nada de paciente, protocolo, endereço ou médico — nem na tela, nem no CSV.</li>
                  </ul>
                </Cartao>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
