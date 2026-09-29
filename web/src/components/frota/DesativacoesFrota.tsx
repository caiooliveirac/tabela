// ═══════════════════════════════════════════════════════════════
// Viatura fora de operação, informada no painel — pelo rádio-operador, pela
// chefia ou pela enfermagem. Até alguém reativar, ela sai dos avisos
// (parada, sinal, bateria), o grupo da frota é avisado e o Huddle do SAMU já
// chega com "fora de operação" preenchido (api/src/frota/desativacoes.ts).
// ═══════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import {
  MOTIVOS_BAIXA,
  POSTOS_FROTA,
  type MotivoBaixa,
  type PainelFrota,
  type PostoFrota,
  type ViaturaFrota,
} from "../../lib/types";
import { useDesativarViatura, useReativarViatura } from "../../hooks/useFrota";
import { duracao, hora } from "./formato";

const PESSOAL: MotivoBaixa[] = ["condutor", "tecnico", "enfermeiro", "medico"];
const FROTA: MotivoBaixa[] = ["mecanica", "sem_oxigenio", "sem_maca", "sem_monitor", "sem_radio"];
const CHAVE_POSTO = "tabela:frotaPosto";

const minutosDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));

function rotulo(v: ViaturaFrota): string {
  const d = v.desativacao!;
  return d.motivos.map((m) => (m === "outro" && d.observacao ? d.observacao : MOTIVOS_BAIXA[m])).join(", ");
}

function Reativar({ v, operador }: { v: ViaturaFrota; operador: string }) {
  const reativar = useReativarViatura();
  const [confirmar, setConfirmar] = useState(false);
  const semNome = !operador.trim();
  if (semNome) return <span className="text-[11px] text-slate-400">preencha seu nome no cabeçalho para reativar</span>;
  if (reativar.isError) return <span className="text-[11px] text-red-700 font-bold">{(reativar.error as Error).message}</span>;
  return confirmar ? (
    <span className="flex gap-1">
      <button
        onClick={() => reativar.mutate({ id: v.desativacao!.id, reativadaPor: operador.trim() })}
        disabled={reativar.isPending}
        className="px-2 py-[3px] text-[11px] font-bold rounded-md bg-emerald-600 text-white cursor-pointer disabled:opacity-50"
      >
        {reativar.isPending ? "reativando…" : `Confirmar: ${v.nome} voltou`}
      </button>
      <button onClick={() => setConfirmar(false)} className="px-2 py-[3px] text-[11px] font-bold rounded-md border border-slate-300 text-slate-600 cursor-pointer">
        não
      </button>
    </span>
  ) : (
    <button
      onClick={() => setConfirmar(true)}
      className="px-2 py-[3px] text-[11px] font-bold rounded-md border border-emerald-600 text-emerald-700 cursor-pointer hover:bg-emerald-50"
    >
      Reativar
    </button>
  );
}

function Modal({ viaturas, operador, onClose }: { viaturas: ViaturaFrota[]; operador: string; onClose: () => void }) {
  const desativar = useDesativarViatura();
  const [codigo, setCodigo] = useState("");
  const [motivos, setMotivos] = useState<MotivoBaixa[]>([]);
  const [observacao, setObservacao] = useState("");
  const [posto, setPosto] = useState<PostoFrota | "">(() => {
    try {
      return (localStorage.getItem(CHAVE_POSTO) as PostoFrota | null) ?? "";
    } catch {
      return "";
    }
  });
  const nome = operador.trim();
  const falta = !nome
    ? "Preencha seu nome no cabeçalho do painel."
    : !codigo
      ? "Escolha a viatura."
      : !motivos.length
        ? "Marque pelo menos um motivo."
        : motivos.includes("outro") && observacao.trim().length < 3
          ? "Motivo \"Outro\": diga qual na observação."
          : !posto
            ? "Diga seu posto."
            : null;

  const alternar = (m: MotivoBaixa) => setMotivos((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]));
  const enviar = () => {
    if (falta || !posto) return;
    try {
      localStorage.setItem(CHAVE_POSTO, posto);
    } catch {
      // sem localStorage: só não lembra o posto
    }
    desativar.mutate(
      { codigo, motivos, observacao: observacao.trim() || null, informadoPor: nome, posto },
      { onSuccess: onClose },
    );
  };

  const caixa = (m: MotivoBaixa) => (
    <label key={m} className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer py-[2px]">
      <input type="checkbox" checked={motivos.includes(m)} onChange={() => alternar(m)} className="accent-red-600" />
      {MOTIVOS_BAIXA[m]}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-5" onMouseDown={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[480px] max-w-full max-h-[88vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-red-200 bg-gradient-to-r from-red-600 to-red-700 rounded-t-2xl">
          <h2 className="text-white font-black text-base m-0">⛔ Viatura fora de operação</h2>
          <p className="text-red-100 text-[12px] mt-1 mb-0 font-semibold">
            Os avisos dela (parada, sinal, bateria) param até alguém reativar. O grupo da frota é avisado e o Huddle já
            chega sabendo.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide mb-1">Viatura</div>
            <select
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] bg-white"
            >
              <option value="">Escolha…</option>
              {viaturas.map((v) => (
                <option key={v.chave} value={v.codigo!}>
                  {v.nome} · {v.tipo} · {v.base}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide mb-1">Motivo</div>
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <div className="text-[11px] font-bold text-slate-400 mb-[2px]">Falta de pessoal</div>
                {PESSOAL.map(caixa)}
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-400 mb-[2px]">Viatura ou equipamento</div>
                {FROTA.map(caixa)}
                {caixa("outro")}
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide mb-1">
              Observação {motivos.includes("outro") ? "" : "(opcional)"}
            </div>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Ex.: pneu furado na BR-324, guincho a caminho"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[13px]"
            />
          </div>

          <div>
            <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide mb-1">Quem informa</div>
            <div className="text-[13px] text-slate-700 mb-2">
              {nome ? <b>{nome}</b> : <span className="text-red-700 font-bold">preencha seu nome no cabeçalho do painel</span>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(POSTOS_FROTA) as PostoFrota[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPosto(p)}
                  className={`px-3 py-[6px] text-[12px] font-bold rounded-lg border cursor-pointer ${
                    posto === p ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300"
                  }`}
                >
                  {POSTOS_FROTA[p]}
                </button>
              ))}
            </div>
          </div>

          {desativar.isError && (
            <div className="text-[12px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {(desativar.error as Error).message}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-slate-500">{falta ?? ""}</span>
            <div className="flex gap-2 shrink-0">
              <button onClick={onClose} className="px-4 py-2 text-[13px] font-bold rounded-lg border border-slate-300 text-slate-600 cursor-pointer">
                Cancelar
              </button>
              <button
                onClick={enviar}
                disabled={!!falta || desativar.isPending}
                className="px-4 py-2 text-[13px] font-bold rounded-lg bg-red-600 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {desativar.isPending ? "Registrando…" : codigo ? `Desativar ${codigo}` : "Desativar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DesativacoesFrota({ painel, operador }: { painel: PainelFrota; operador: string }) {
  const [aberto, setAberto] = useState(false);
  const desativadas = painel.viaturas.filter((v) => v.desativacao);
  // Só o catálogo; quem já está desativada (até segunda ordem ou no painel) fica fora da lista.
  const escolhiveis = useMemo(
    () =>
      painel.viaturas
        .filter((v) => !v.foraDoCatalogo && v.codigo && v.situacao !== "desativada")
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    [painel.viaturas],
  );

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Fora de operação agora</div>
          <div className="text-[11px] text-slate-400">
            O rádio avisou que a viatura parou? Informe aqui: os avisos dela param e o Huddle já chega sabendo.
          </div>
        </div>
        <button
          onClick={() => setAberto(true)}
          className="px-3 py-[7px] text-[12px] font-bold rounded-lg bg-red-600 text-white cursor-pointer hover:bg-red-700"
        >
          ⛔ Informar viatura fora de operação
        </button>
      </div>
      {desativadas.length ? (
        <ul className="divide-y divide-slate-100">
          {desativadas.map((v) => {
            const d = v.desativacao!;
            return (
              <li key={v.chave} className="flex items-center gap-3 py-2 text-[13px] flex-wrap">
                <span className="font-black text-slate-800 w-[52px] shrink-0">{v.nome}</span>
                <span className="text-slate-700 flex-1 min-w-[200px]">
                  <b>{rotulo(v)}</b>
                  {d.observacao && !d.motivos.includes("outro") ? ` — ${d.observacao}` : ""}
                  <span className="text-slate-400">
                    {" "}
                    · {d.informadoPor} ({POSTOS_FROTA[d.posto]}) às {hora(d.desde)}, há {duracao(minutosDesde(d.desde))}
                  </span>
                </span>
                <Reativar v={v} operador={operador} />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="text-[12px] text-slate-400">Nenhuma informada no painel.</div>
      )}
      {aberto && <Modal viaturas={escolhiveis} operador={operador} onClose={() => setAberto(false)} />}
    </div>
  );
}
