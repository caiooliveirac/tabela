// ═══════════════════════════════════════════════════════════════
// Detalhe da viatura (clique na ambulância no mapa, na tabela de hospitais
// ou num aviso): a ocorrência, a parada no hospital, o rastro do GPS e a
// linha do tempo que junta o que a equipe registrou com o que o GPS viu.
//
// A faixa do topo é a ação: "saiu da cerca e o status segue 'chegada ao
// hospital'" (provável liberação sem registro), parada de 40 min, chegada
// registrada sem o GPS no hospital, sem sinal. Regras em api/src/frota/detalhe.ts.
// ═══════════════════════════════════════════════════════════════
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { DetalheViaturaFrota, EstadoLocalizacaoFrota, FonteEquipeFrota, TomEventoFrota, ViaturaFrota } from "../../lib/types";
import { useDetalheViatura } from "../../hooks/useFrota";
import { COR, COR_RASTRO, artigo, corRisco, duracao, frase, hora, nomeProprio, textoResponsavel } from "./formato";

const MapaRastro = lazy(() => import("./MapaRastro"));

type Aba = "geral" | "local" | "tempo" | "ocorrencia" | "equipe";

/** De onde veio cada nome da equipe (regra 7: o informado vence a escala). */
const ORIGEM_EQUIPE: Record<FonteEquipeFrota, string> = {
  relatorio: "confirmado no Relatório da chefia",
  mesa: "chegada na Mesa do Plantões",
  quadro: "informado no Quadro",
  escala: "esperado pela escala, sem confirmação",
};
const ABAS: { id: Aba; nome: string }[] = [
  { id: "geral", nome: "Visão geral" },
  { id: "local", nome: "Localização" },
  { id: "tempo", nome: "Linha do tempo" },
  { id: "ocorrencia", nome: "Ocorrência" },
  { id: "equipe", nome: "Equipe" },
];

/** Cor de cada estado da localização (mesma régua do resto da aba Frota). */
const COR_ESTADO: Record<EstadoLocalizacaoFrota, string> = {
  "na-cerca": COR.hospital,
  "fora-da-cerca": COR.alerta,
  "sem-sinal": COR.atrasada,
  "na-base": COR.base,
  saiu: COR.livre,
  "a-caminho": COR.ocorrencia,
  livre: COR.livre,
  "sem-posicao": COR.vazio,
};

const COR_TOM: Record<TomEventoFrota, string> = {
  neutro: "#94a3b8",
  info: COR.hospital,
  ok: COR.livre,
  atencao: COR.atrasada,
  critico: COR.alerta,
};

const horaSeg = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Bahia" });
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const minEntre = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
const metros = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
/** Hora se for de hoje (o dia de `ate`); senão dia e hora. */
const quando = (iso: string, ate: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" }) === new Date(ate).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })
    ? hora(iso)
    : dataHora(iso);

/** Quanto o seletor volta no rastro (horas). Só entram os que vão além do padrão. */
const PASSOS_H = [1, 2, 4, 8, 12, 24, 48, 72, 120];
const rotuloHoras = (h: number) => (h < 24 ? `${h} h` : h === 24 ? "1 dia" : `${h / 24} dias`);

function Selo({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-[7px] py-[2px] rounded-[5px] text-[11px] font-extrabold whitespace-nowrap"
      style={{ color: cor, backgroundColor: `color-mix(in srgb, ${cor} 10%, white)`, border: `1px solid color-mix(in srgb, ${cor} 30%, white)` }}
    >
      {children}
    </span>
  );
}

function Cartao({ rotulo, children, sub, cor }: { rotulo: string; children: ReactNode; sub?: ReactNode; cor?: string }) {
  return (
    <div
      className="px-3 py-[10px] min-w-0 rounded-lg"
      style={cor ? { backgroundColor: `color-mix(in srgb, ${cor} 8%, white)` } : undefined}
    >
      <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide">{rotulo}</div>
      <div className="text-[14px] font-black leading-tight mt-1 break-words" style={{ color: cor ?? "#0f172a" }}>
        {children}
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-[3px] leading-snug">{sub}</div>}
    </div>
  );
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: [string, ReactNode][] }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden min-w-0">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[12px] font-extrabold text-slate-700">{titulo}</div>
      <dl className="text-[13px]">
        {linhas.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[minmax(110px,40%)_1fr] gap-3 px-3 py-[7px] border-t border-slate-100 first:border-t-0">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-900 min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function LinhaDoTempo({ d }: { d: DetalheViaturaFrota }) {
  if (!d.linha.length) return <div className="text-[13px] text-slate-400 p-3">Nada registrado desde {quando(d.janela.desde, d.janela.ate)}.</div>;
  return (
    <ol className="relative">
      {d.linha.map((e, i) => {
        const cor = COR_TOM[e.tom];
        const anterior = d.linha[i - 1];
        const passo = anterior ? minEntre(anterior.em, e.em) : null;
        return (
          <li key={`${e.tipo}|${e.em}|${i}`} className="grid grid-cols-[18px_74px_1fr] gap-x-2 px-3 py-[7px] border-t border-slate-100 first:border-t-0">
            <span className="mt-[3px] w-[12px] h-[12px] rounded-full border-2 bg-white" style={{ borderColor: cor, boxShadow: `inset 0 0 0 2px ${cor}` }} />
            <span className="text-[13px] font-black tabular-nums text-slate-900">{horaSeg(e.em)}</span>
            <div className="min-w-0">
              <div className="text-[13px] font-bold" style={{ color: e.tom === "critico" ? COR.alerta : "#0f172a" }}>
                {e.titulo}
                {passo !== null && passo > 0 && <span className="ml-2 text-[11px] font-semibold text-slate-400">+{duracao(passo)}</span>}
              </div>
              {e.detalhe && <div className="text-[11px] text-slate-500">{e.detalhe}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Legenda() {
  const itens: [string, string, boolean][] = [
    [COR_RASTRO.caminho, "a caminho", false],
    [COR_RASTRO.dentro, "dentro da cerca", false],
    [COR_RASTRO.foraAlerta, "fora, status de hospital", false],
    [COR_RASTRO.fora, "depois de liberar", false],
    [COR.alerta, "distância até o hospital", true],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-2">
      {itens.map(([cor, nome, tracejado]) => (
        <span key={nome} className="inline-flex items-center gap-1">
          <span className="inline-block w-[16px] h-0" style={{ borderTop: `3px ${tracejado ? "dashed" : "solid"} ${cor}` }} />
          {nome}
        </span>
      ))}
    </div>
  );
}

/** Janela do rastro: o seletor que volta no tempo (padrão à direita, até a retenção à esquerda). */
export interface JanelaRastro {
  horas: number | null;
  onHoras: (h: number | null) => void;
  carregando: boolean;
}

function SeletorRastro({ d, j }: { d: DetalheViaturaFrota; j: JanelaRastro }) {
  const { horas, onHoras } = j;
  const ate = Date.parse(d.janela.ate);
  const padrao = Date.parse(d.janela.padrao);
  const opcoes: (number | null)[] = [...PASSOS_H.filter((h) => h <= d.janela.maxHoras && ate - h * 3_600_000 < padrao).reverse(), null];
  const [pendente, setPendente] = useState<number | null>(horas);
  useEffect(() => setPendente(horas), [horas]);
  // Arrastar não pede a cada passo: pede quando para.
  useEffect(() => {
    if (pendente === horas) return;
    const t = window.setTimeout(() => onHoras(pendente), 350);
    return () => window.clearTimeout(t);
  }, [pendente, horas, onHoras]);
  if (opcoes.length < 2) return null;
  const i = opcoes.indexOf(pendente);
  const pos = i >= 0 ? i : opcoes.length - 1;
  const desde = pendente === null ? d.janela.padrao : new Date(ate - pendente * 3_600_000).toISOString();
  const nomePadrao = d.janela.motivo === "vinculacao" ? "ocorrência" : "1 h";
  const texto =
    pendente === null
      ? d.janela.motivo === "vinculacao"
        ? `desde ${quando(desde, d.janela.ate)}, quando foi vinculada à ocorrência${d.ocorrencia?.protocolo ? ` ${d.ocorrencia.protocolo}` : ""}`
        : `última hora, desde ${quando(desde, d.janela.ate)}`
      : `últimas ${rotuloHoras(pendente)}, desde ${quando(desde, d.janela.ate)}`;
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-bold text-slate-800">Rastro: {texto}</span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {j.carregando ? "carregando…" : `${d.rastro.length} posições`}
          {pendente !== null && (
            <button onClick={() => setPendente(null)} className="ml-2 font-bold text-sky-700 bg-transparent border-none cursor-pointer p-0 text-[11px]">
              voltar ao padrão
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={opcoes.length - 1}
        step={1}
        value={pos}
        onChange={(e) => setPendente(opcoes[Number(e.target.value)])}
        aria-label="Voltar no tempo do rastro"
        aria-valuetext={texto}
        className="w-full cursor-pointer accent-slate-700"
      />
      <div className="flex justify-between text-[10px] text-slate-400 tabular-nums select-none">
        {opcoes.map((h, k) => (
          <button
            key={h ?? "padrao"}
            onClick={() => setPendente(h)}
            className={`bg-transparent border-none p-0 cursor-pointer text-[10px] ${k === pos ? "font-black text-slate-800" : "text-slate-400"}`}
          >
            {h === null ? nomePadrao : h < 24 ? `${h}h` : `${h / 24}d`}
          </button>
        ))}
      </div>
    </div>
  );
}

function Mapa({ d, j, alto }: { d: DetalheViaturaFrota; j: JanelaRastro; alto?: boolean }) {
  return (
    <>
      <SeletorRastro d={d} j={j} />
      <Suspense fallback={<div className={`w-full ${alto ? "h-[46vh]" : "h-[260px]"} rounded-lg border border-slate-200 bg-slate-50`} />}>
        <MapaRastro detalhe={d} alto={alto} enquadrar={j.horas} />
      </Suspense>
    </>
  );
}

function Aviso({ d, onAba, onVerNoMapa }: { d: DetalheViaturaFrota; onAba: (a: Aba) => void; onVerNoMapa?: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const a = d.aviso;
  if (!a) return null;
  const cor = a.nivel === "critico" ? COR.alerta : COR.atrasada;
  const copiar = async () => {
    if (!a.mensagem) return;
    try {
      await navigator.clipboard.writeText(a.mensagem);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      window.prompt("Copie a mensagem:", a.mensagem);
    }
  };
  const botao = "px-3 py-[6px] text-[12px] font-bold rounded-lg border cursor-pointer bg-white";
  return (
    <div role="alert" className="rounded-lg px-4 py-3 border" style={{ borderColor: `color-mix(in srgb, ${cor} 40%, white)`, backgroundColor: `color-mix(in srgb, ${cor} 8%, white)` }}>
      <div className="text-[14px] font-black leading-snug" style={{ color: cor }}>
        {a.nivel === "critico" ? "⚠ " : ""}
        {a.titulo}
      </div>
      <div className="text-[13px] text-slate-700 mt-1">{a.texto}</div>
      <div className="flex flex-wrap gap-2 mt-2">
        {d.rastro.length > 0 && (
          <button onClick={() => onAba("local")} className={botao} style={{ borderColor: cor, color: cor }}>
            Ver rastro
          </button>
        )}
        {a.mensagem && (
          <button onClick={copiar} className={`${botao} text-white`} style={{ borderColor: cor, backgroundColor: cor }} title={a.mensagem}>
            {copiado ? "Mensagem copiada ✓" : "Copiar mensagem para a equipe"}
          </button>
        )}
        {onVerNoMapa && (
          <button onClick={onVerNoMapa} className={`${botao} border-slate-300 text-slate-700`}>
            Ver no mapa da frota
          </button>
        )}
      </div>
    </div>
  );
}

function Conteudo({ d, j, aba, setAba, onVerNoMapa }: { d: DetalheViaturaFrota; j: JanelaRastro; aba: Aba; setAba: (a: Aba) => void; onVerNoMapa?: () => void }) {
  const v = d.viatura;
  const o = d.ocorrencia;
  const p = d.permanencia;
  const L = d.localizacao;
  const corEstado = COR_ESTADO[L.estado];
  const chegadaReg = [...d.linha].reverse().find((e) => e.tipo === "status" && /chegada ao hospital/i.test(e.titulo));
  const ondeNome = d.destino ? `d${artigo(d.destino.nome)} ${d.destino.nome}` : "";
  const posicao = v.posicao
    ? (
        <>
          {dataHora(v.posicao.em)} <span className="text-slate-500">(há {duracao(v.posicao.idadeMin)})</span>
          <div className="text-[11px] text-slate-500 tabular-nums">
            {v.posicao.lat.toFixed(5)}, {v.posicao.lng.toFixed(5)}
            {v.bateria != null ? ` · bateria ${v.bateria}%` : ""}
            {v.velocidade != null ? ` · ${v.velocidade} km/h` : ""}
          </div>
        </>
      )
    : "—";
  const mrs = d.medicos?.length ? d.medicos.join(", ") : o?.medico ? nomeProprio(o.medico) : "—";
  // Acolhimentos: só USA em hospital (não UPA, não a base). Sem parada do caso, nada a dizer.
  const A = d.acolhimento;
  const n = A?.notificacao;
  const acolhimento: ReactNode = !A?.cobre
    ? <span className="text-slate-500">Não se aplica{v.tipo !== "USA" ? " (só USA)" : " (UPA ou base)"}</span>
    : A.erro
      ? <span className="text-slate-500">Acolhimentos fora do ar agora</span>
      : !A.ligado
        ? <span className="text-slate-500">Cruzamento desligado</span>
        : n
          ? (
              <>
                <span className="font-bold" style={{ color: COR.livre }}>Notificado</span>
                <div className="text-[11px] text-slate-600">
                  {[
                    n.chegada && `chegada ${hora(n.chegada)}`,
                    n.passagem && `passagem ${hora(n.passagem)}`,
                    n.maca && `maca retida ${hora(n.maca.inicio)}${n.maca.fim ? `–${hora(n.maca.fim)}` : " (ainda)"}`,
                    n.liberada ? `liberada ${hora(n.liberada)}` : "ainda não liberada",
                    n.minutos != null && duracao(n.minutos),
                  ].filter(Boolean).join(" · ")}
                  {n.motivos.length > 0 && <div>motivos: {n.motivos.join(", ").toLowerCase()}</div>}
                </div>
              </>
            )
          : A.semNotificacao
            ? <span className="font-bold" style={{ color: COR.alerta }}>Sem notificação (USA {d.limites.alertaMin}+ min)</span>
            : <span className="text-slate-500">Sem notificação ainda</span>;
  const permanenciaTexto = p ? (
    <>
      <span style={{ color: p.alerta ? COR.alerta : undefined }} className="font-bold">{duracao(p.minutos)}</span>
      {p.alerta && <span className="ml-2"><Selo cor={COR.alerta}>⚠ {d.limites.alertaMin} min ou mais</Selo></span>}
    </>
  ) : "—";

  const geral: [string, ReactNode][] = [
    ["Entrada na cerca (GPS)", p ? `${dataHora(p.entrada)}${d.destino ? ` · ${d.destino.nome}` : ""}` : "Sem parada em hospital ou UPA"],
    ["Chegada registrada", chegadaReg ? `${horaSeg(chegadaReg.em)} · mapa de equipes` : "—"],
    ["Tempo de permanência", permanenciaTexto],
    ["Saída da cerca (GPS)", p?.saida ? (
      <span style={{ color: L.estado === "fora-da-cerca" ? COR.alerta : undefined }} className="font-bold">
        {horaSeg(p.saida)}{L.minutosFora != null ? ` · há ${duracao(L.minutosFora)}` : ""}
      </span>
    ) : p?.aberta ? "Ainda dentro" : "—"],
    ["Situação da localização", <span className="font-bold" style={{ color: corEstado }}>{L.titulo}</span>],
    ["Distância do hospital", L.distanciaM != null && d.destino ? metros(L.distanciaM) : "—"],
    ["Acolhimentos", acolhimento],
    ["Médico regulador", mrs],
    ["Responsável na viatura", textoResponsavel(v.responsavel ?? null) ?? "—"],
    ["Última posição (GPS)", posicao],
  ];

  return (
    <>
      {/* ── Resumo ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-1 border border-slate-200 rounded-lg p-1">
        <Cartao rotulo="Hospital / UPA" sub={d.destino ? (d.destino.papel === "atual" ? "parada atual" : "última parada do caso") : "sem parada em hospital"}>
          {d.destino?.nome ?? "—"}
        </Cartao>
        <Cartao rotulo="Unidade" sub={textoResponsavel(v.responsavel ?? null) ?? (v.base ? `base ${v.base}` : undefined)}>
          {v.nome}
          {v.tipo ? <span className="text-slate-500 font-bold"> · {v.tipo}</span> : null}
        </Cartao>
        <Cartao
          rotulo="Médico regulador"
          sub={o?.risco ? <Selo cor={corRisco(o.risco)}>risco {o.risco.toLowerCase()}</Selo> : o && !o.ativa ? "ocorrência encerrada" : undefined}
        >
          {mrs}
        </Cartao>
        <Cartao
          rotulo="Tempo de permanência"
          cor={p?.alerta ? COR.alerta : undefined}
          sub={p ? (p.aberta ? `desde ${hora(p.entrada)}` : `${hora(p.entrada)} → ${p.saida ? hora(p.saida) : "?"}`) : undefined}
        >
          {p ? duracao(p.minutos) : "—"}
        </Cartao>
        <Cartao
          rotulo="Localização"
          cor={L.estado === "fora-da-cerca" ? COR.alerta : undefined}
          sub={L.distanciaM != null && d.destino && L.estado !== "na-cerca" ? `a ${metros(L.distanciaM)} ${ondeNome}` : undefined}
        >
          <span style={{ color: corEstado }}>{L.titulo}</span>
        </Cartao>
      </div>

      <Aviso d={d} onAba={setAba} onVerNoMapa={onVerNoMapa} />

      {/* ── Abas ── */}
      <div role="tablist" className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={`px-3 py-2 text-[13px] font-bold whitespace-nowrap border-b-2 -mb-px cursor-pointer bg-transparent ${
              aba === a.id ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {a.nome}
          </button>
        ))}
      </div>

      {aba === "geral" && (
        <>
          <div className="grid lg:grid-cols-2 gap-3">
            <Tabela titulo="Permanência e localização" linhas={geral} />
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[12px] font-extrabold text-slate-700">Rastro do GPS</div>
              <div className="p-2">
                <Mapa d={d} j={j} />
                <Legenda />
              </div>
            </div>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[12px] font-extrabold text-slate-700">Linha do tempo da unidade</div>
            <LinhaDoTempo d={d} />
          </div>
        </>
      )}

      {aba === "local" && (
        <div className="grid lg:grid-cols-[3fr_2fr] gap-3">
          <div className="min-w-0">
            <Mapa d={d} j={j} alto />
            <Legenda />
          </div>
          <Tabela
            titulo="Dados da localização"
            linhas={[
              ["Situação", <span className="font-bold" style={{ color: corEstado }}>{L.titulo}</span>],
              ["Saiu da cerca", L.saiuEm ? `${horaSeg(L.saiuEm)}${L.minutosFora != null ? ` · há ${duracao(L.minutosFora)}` : ""}` : "—"],
              ["Distância do hospital", L.distanciaM != null && d.destino ? metros(L.distanciaM) : "—"],
              ["Cerca", d.destino
                ? `${d.limites.raioM} m do prédio${d.destino.pontos.length ? ` e de ${d.destino.pontos.length} estacionamento(s)/porta(s)` : ""}; sai a ${d.limites.raioSaidaM} m`
                : "—"],
              ["Fonte GPS", <>SAMU+ <span className="text-slate-500 text-[11px]">(tablet da viatura, cerca de uma posição por minuto; guardado por {Math.round(d.janela.maxHoras / 24)} dias)</span></>],
              ["Rastro", d.rastro.length ? `${d.rastro.length} posições desde ${quando(d.rastro[0].em, d.janela.ate)}` : "Sem posições guardadas na janela"],
              ["Última posição", posicao],
            ]}
          />
        </div>
      )}

      {aba === "tempo" && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[12px] font-extrabold text-slate-700">
            Linha do tempo da unidade <span className="font-semibold text-slate-400">· status da equipe e cerca do GPS desde {quando(d.janela.desde, d.janela.ate)}</span>
          </div>
          <LinhaDoTempo d={d} />
        </div>
      )}

      {aba === "ocorrencia" && (
        o ? (
          <div className="flex flex-col gap-3">
            <Tabela
              titulo={o.ativa ? "Ocorrência em andamento" : "Última ocorrência (encerrada no mapa de equipes)"}
              linhas={[
                ["Protocolo", <b>{o.protocolo ?? "—"}</b>],
                ["Abertura", o.abertura ? dataHora(o.abertura) : "—"],
                ["Risco", o.risco ? <Selo cor={corRisco(o.risco)}>{o.risco}</Selo> : "—"],
                ["Status", o.status ? `${frase(o.status)}${o.statusEm ? ` às ${hora(o.statusEm)}` : ""}` : "—"],
                ["Bairro", o.bairro ?? "—"],
                ["Endereço", o.endereco ?? "—"],
                ["Queixa", o.queixa ?? "—"],
                ["Hospital / UPA", d.destino?.nome ?? "—"],
                ["Médico regulador", mrs],
                ["Regulação secundária", o.regulacaoSecundaria ? "Sim" : "Não"],
                ["Unidade", `${v.nome}${v.tipo ? ` · ${v.tipo}` : ""}${v.base ? ` · base ${v.base}` : ""}`],
              ]}
            />
            {o.hma && (
              <details className="border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
                <summary className="cursor-pointer font-bold text-slate-700">História clínica (HMA)</summary>
                <p className="mt-2 whitespace-pre-wrap text-slate-700">{o.hma}</p>
              </details>
            )}
          </div>
        ) : (
          <div className="text-[13px] text-slate-500 border border-slate-200 rounded-lg p-4">
            Sem ocorrência no mapa de equipes nas últimas 3 h — ou a ponte do mapa está parada.
          </div>
        )
      )}

      {aba === "equipe" && (
        <div className="flex flex-col gap-2">
          <Tabela
            titulo={`Equipe de ${v.nome} neste turno`}
            linhas={
              d.equipe?.membros.length
                ? d.equipe.membros.map((m, i): [string, ReactNode] => [
                    `${m.funcao}${d.equipe!.membros.filter((x) => x.funcao === m.funcao).length > 1 ? ` ${i + 1}` : ""}`,
                    m.nome ? (
                      <>
                        <span className={m.fonte === "escala" ? "text-slate-500" : undefined}>{nomeProprio(m.nome)}</span>{" "}
                        <span className="text-[11px] text-slate-500">· {ORIGEM_EQUIPE[m.fonte]}</span>
                      </>
                    ) : (
                      <span className="font-bold" style={{ color: COR.alerta }}>
                        Falta informada <span className="text-[11px] font-normal text-slate-500">· Relatório da chefia</span>
                      </span>
                    ),
                  ])
                : [["Equipe", <span className="text-slate-500">Sem nome nesta viatura agora</span>]]
            }
          />
          <div className="text-[11px] text-slate-500">
            Vale o informado na hora (Relatório da chefia, Mesa, Quadro) sobre a escala; nome só da escala é o esperado, sem confirmação.
            {d.equipe && !d.equipe.informadoLigado && " Relatório e Quadro ainda não estão ligados à Tabela."}
          </div>
        </div>
      )}
    </>
  );
}

interface Props {
  chave: string | null;
  onClose: () => void;
  /** Fecha e leva o mapa da aba Frota até a viatura. */
  onVerNoMapa?: (v: ViaturaFrota) => void;
}

export default function DetalheViatura({ chave, onClose, onVerNoMapa }: Props) {
  const [horas, setHoras] = useState<number | null>(null);
  const { data: d, isLoading, error, isPlaceholderData } = useDetalheViatura(chave, horas);
  const [aba, setAba] = useState<Aba>("geral");
  useEffect(() => {
    setAba("geral");
    setHoras(null);
  }, [chave]);
  useEffect(() => {
    if (!chave) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [chave, onClose]);
  if (!chave) return null;

  const v = d?.viatura;
  const o = d?.ocorrencia;
  const verNoMapa = v?.posicao && onVerNoMapa ? () => { onClose(); onVerNoMapa(v); } : undefined;
  const corEstado = d ? COR_ESTADO[d.localizacao.estado] : COR.vazio;

  return (
    <div className="fixed inset-0 z-[230] bg-slate-900/50 flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes da viatura ${v?.nome ?? chave}`}
        className="bg-white w-full sm:max-w-[1040px] sm:max-h-[92vh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Cabeçalho ── */}
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: corEstado }} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 10H6" /><path d="M8 8v4" />
              <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
              <path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14" />
              <circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-black text-slate-900 leading-tight">
              {v ? `${v.nome}${v.tipo ? ` · ${v.tipo}` : ""}` : chave}
              {v?.base && <span className="text-[13px] font-bold text-slate-500"> · base {v.base}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[12px] text-slate-600">
              {o?.protocolo && (
                <span>
                  Ocorrência <b className="text-slate-900">{o.protocolo}</b>
                  {!o.ativa && " (encerrada)"}
                </span>
              )}
              {d && <Selo cor={corEstado}>{d.localizacao.titulo}</Selo>}
            </div>
          </div>
          <button onClick={onClose} autoFocus aria-label="Fechar" className="shrink-0 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-200 cursor-pointer border-none bg-transparent text-[18px]">
            ×
          </button>
        </div>

        {/* ── Corpo ── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 flex flex-col gap-3">
          {d ? (
            <Conteudo d={d} j={{ horas, onHoras: setHoras, carregando: isPlaceholderData }} aba={aba} setAba={setAba} onVerNoMapa={verNoMapa} />
          ) : (
            <div className="text-[13px] text-slate-500 py-10 text-center">
              {isLoading ? "Carregando o detalhe da viatura…" : `Detalhe indisponível: ${error?.message ?? "sem resposta"}`}
            </div>
          )}
        </div>

        {/* ── Rodapé ── */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-slate-200">
          <span className="text-[11px] text-slate-400">GPS do SAMU+ · status do mapa de equipes · atualiza a cada 30 s</span>
          <div className="flex gap-2">
            {verNoMapa && (
              <button onClick={verNoMapa} className="px-3 py-[7px] text-[12px] font-bold rounded-lg border border-slate-300 bg-white text-slate-700 cursor-pointer">
                Ver no mapa da frota
              </button>
            )}
            <button onClick={onClose} className="px-4 py-[7px] text-[12px] font-bold rounded-lg border-none bg-slate-800 text-white cursor-pointer">
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
