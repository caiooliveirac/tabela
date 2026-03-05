import { useState } from "react";
import type { CreateCasePayload } from "../lib/types";
import { HOSPITALS, CAT_META, MRS } from "../lib/constants";

interface NewCaseModalProps {
  operador: string;
  onSubmit: (data: CreateCasePayload) => void;
  onClose: () => void;
}

export default function NewCaseModal({
  operador,
  onSubmit,
  onClose,
}: NewCaseModalProps) {
  const [form, setForm] = useState({
    hospital: "",
    situacao: "ACEITO" as "ACEITO" | "ZERO",
    caso: "",
    mr: "",
    medico: "",
    oc: "",
  });

  const handleSubmit = () => {
    if (!form.hospital) return;
    onSubmit({
      hospitalId: form.hospital,
      situacao: form.situacao,
      caso: form.caso || undefined,
      mr: form.mr || undefined,
      medico: form.medico || undefined,
      oc: form.oc || undefined,
      criadoPor: operador,
    });
  };

  const inp =
    "w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none bg-white text-slate-900";
  const sel = `${inp} cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center] pr-8`;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[200] p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-[480px] shadow-2xl">
        <h3 className="text-lg font-black mb-4">Registrar Regulação</h3>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">
                Hospital *
              </label>
              <select
                value={form.hospital}
                onChange={(e) =>
                  setForm({ ...form, hospital: e.target.value })
                }
                className={sel}
              >
                <option value="">Selecionar...</option>
                {HOSPITALS.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                    {h.cat !== "geral"
                      ? ` (${CAT_META[h.cat].label})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">
                Resultado *
              </label>
              <div className="flex gap-[6px] mt-1">
                {(
                  [
                    ["ACEITO", "✅ Aceito", "#16a34a"],
                    ["ZERO", "🚫 Vaga Zero", "#dc2626"],
                  ] as const
                ).map(([v, l, c]) => (
                  <button
                    key={v}
                    onClick={() => setForm({ ...form, situacao: v })}
                    className="flex-1 py-[10px] px-1 rounded-lg text-[13px] font-extrabold cursor-pointer"
                    style={{
                      border:
                        form.situacao === v
                          ? "none"
                          : "2px solid #e2e8f0",
                      backgroundColor:
                        form.situacao === v ? c : "#fff",
                      color:
                        form.situacao === v ? "#fff" : "#64748b",
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">
              Caso
            </label>
            <input
              placeholder="Ex: TCE com sinais de HIC"
              value={form.caso}
              onChange={(e) =>
                setForm({ ...form, caso: e.target.value })
              }
              className={inp}
            />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">
                MR
              </label>
              <select
                value={form.mr}
                onChange={(e) =>
                  setForm({ ...form, mr: e.target.value })
                }
                className={sel}
              >
                <option value="">Opcional...</option>
                {MRS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">
                OC
              </label>
              <input
                placeholder="Nº OC"
                value={form.oc}
                onChange={(e) =>
                  setForm({ ...form, oc: e.target.value })
                }
                className={inp}
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">
              Médico que recebeu
            </label>
            <input
              placeholder="Nome do médico"
              value={form.medico}
              onChange={(e) =>
                setForm({ ...form, medico: e.target.value })
              }
              className={inp}
            />
          </div>
          <div className="flex gap-[10px] mt-2">
            <button
              onClick={handleSubmit}
              className="px-5 py-[10px] rounded-[10px] border-none bg-blue-700 text-white text-sm font-bold cursor-pointer"
            >
              Registrar
            </button>
            <button
              onClick={onClose}
              className="px-5 py-[10px] rounded-[10px] border-2 border-slate-200 bg-transparent text-slate-500 text-sm font-bold cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
