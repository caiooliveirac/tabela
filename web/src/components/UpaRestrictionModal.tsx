import { useMemo, useState } from "react";
import type { UpaRestriction } from "../lib/types";
import { deadlineOptions, toDatetimeLocalValue } from "../lib/upa-deadlines";

// Modal de restrição de UPA — dois estados só:
//   • livre    → escolher até quando e restringir;
//   • restrita → ver prazo/autor, estender o prazo ou liberar agora.
// Ambos exigem PIN da chefia (pedido depois, pelo PinDialog).

interface Props {
  unitKey: string;
  unitName: string;
  current: UpaRestriction | null;
  operador: string;
  onRestrict: (untilIso: string) => void;
  onLiberate: () => void;
  onClose: () => void;
}

export default function UpaRestrictionModal({
  unitName,
  current,
  operador,
  onRestrict,
  onLiberate,
  onClose,
}: Props) {
  const opcoes = useMemo(() => deadlineOptions(new Date()), []);
  const [custom, setCustom] = useState("");
  const semNome = !operador.trim();

  const restringir = (iso: string) => {
    if (semNome) return;
    onRestrict(iso);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-5"
      onMouseDown={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-[440px] max-w-full max-h-[85vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-red-200 bg-gradient-to-r from-red-600 to-red-700 rounded-t-2xl">
          <h2 className="text-white font-black text-base m-0">🚫 Restringir UPA</h2>
          <p className="text-red-100 text-[12px] mt-1 mb-0 font-bold">{unitName}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {current && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-[13px] font-black text-red-900">
                Restrita até {current.untilLabel}
              </div>
              <div className="text-[11px] text-red-600 font-semibold mt-1">
                por {current.autor}
              </div>
              <button
                onClick={onLiberate}
                disabled={semNome}
                className="mt-3 w-full py-2 rounded-lg text-sm font-bold border-none cursor-pointer bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ✅ Liberar agora
              </button>
            </div>
          )}

          <div>
            <div className="text-[11px] font-extrabold text-slate-600 uppercase mb-2">
              {current ? "Mudar o prazo para" : "Restrita até"}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {opcoes.map((o) => (
                <button
                  key={o.iso}
                  onClick={() => restringir(o.iso)}
                  disabled={semNome}
                  className="py-[10px] px-2 rounded-lg text-[13px] font-bold border-2 border-red-200 bg-red-50 text-red-800 cursor-pointer hover:border-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <details className="text-[12px] text-slate-500">
            <summary className="cursor-pointer font-bold">Outro horário</summary>
            <div className="flex gap-2 mt-2">
              <input
                type="datetime-local"
                value={custom}
                min={toDatetimeLocalValue(new Date())}
                onChange={(e) => setCustom(e.target.value)}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-red-400"
              />
              <button
                onClick={() => {
                  const at = new Date(custom);
                  if (!custom || Number.isNaN(at.getTime())) return;
                  restringir(at.toISOString());
                }}
                disabled={!custom || semNome}
                className="py-2 px-4 rounded-lg text-sm font-bold border-none bg-red-600 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Restringir
              </button>
            </div>
          </details>

          {semNome && (
            <p className="text-[12px] text-amber-700 font-semibold bg-amber-50 border border-amber-200 rounded-lg p-3 m-0">
              Preencha seu nome no cabeçalho do painel — toda restrição fica
              atribuída a quem a lançou.
            </p>
          )}

          <p className="text-[11px] text-slate-400 m-0">
            Restringir exige o PIN da chefia. O grupo dos reguladores é avisado na
            hora e a cada 2h enquanto a restrição valer.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="py-[6px] px-4 rounded-lg text-xs font-bold border border-slate-300 bg-white text-slate-600 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
