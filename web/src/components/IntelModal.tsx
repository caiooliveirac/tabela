import { useState } from "react";
import type { CreateIntelPayload, IntelRow } from "../lib/types";
import { HOSPITALS, INTEL_TYPES, getIntelType } from "../lib/constants";

function fmt(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface IntelModalProps {
  operador: string;
  allIntel: IntelRow[];
  onSubmit: (data: CreateIntelPayload) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
}

export default function IntelModal({
  operador,
  allIntel,
  onSubmit,
  onRemove,
  onClose,
}: IntelModalProps) {
  const [form, setForm] = useState({
    hospital: "",
    tipo: "lotado",
    nota: "",
  });

  const handleSubmit = () => {
    if (!form.hospital) return;
    onSubmit({
      hospitalId: form.hospital,
      tipo: form.tipo as CreateIntelPayload["tipo"],
      nota: form.nota || undefined,
      autor: operador,
    });
    setForm({ hospital: "", tipo: "lotado", nota: "" });
  };

  const activeIntel = allIntel.filter((i) => i.ativo);
  const removedIntel = allIntel.filter((i) => !i.ativo);

  const inp =
    "w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none bg-white text-slate-900";
  const sel = `${inp} cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center] pr-8`;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[200] p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-[500px] shadow-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-black mb-[6px]">Alertas</h3>
        <p className="text-[13px] text-slate-500 mb-4">
          Registre condições que afetam a regulação.
        </p>

        <div className="flex flex-col gap-3">
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
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">
              Tipo
            </label>
            <div className="flex gap-[6px] flex-wrap mt-1">
              {INTEL_TYPES.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setForm({ ...form, tipo: o.id })}
                  className="py-[6px] px-3 rounded-lg font-bold text-xs cursor-pointer"
                  style={{
                    border:
                      form.tipo === o.id
                        ? `2px solid ${o.color}`
                        : "2px solid #e2e8f0",
                    backgroundColor:
                      form.tipo === o.id ? o.bg : "#fff",
                    color:
                      form.tipo === o.id ? o.color : "#64748b",
                  }}
                >
                  {o.icon} {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">
              Detalhes{" "}
              {form.tipo === "sem_recurso" && (
                <span className="text-orange-600">(qual recurso?)</span>
              )}
              {form.tipo === "pretendo_enviar" && (
                <span className="text-purple-600">
                  (descreva caso/ambulância)
                </span>
              )}
            </label>
            <input
              placeholder={
                form.tipo === "sem_recurso"
                  ? "Ex: Sem tomografia, sem endoscopia"
                  : form.tipo === "pretendo_enviar"
                    ? "Ex: USA 03 com politrauma, ETA 15min"
                    : "Ex: Corredor cheio"
              }
              value={form.nota}
              onChange={(e) =>
                setForm({ ...form, nota: e.target.value })
              }
              className={inp}
            />
          </div>

          <div className="flex gap-[10px] mt-2">
            <button
              onClick={handleSubmit}
              className="px-5 py-[10px] rounded-[10px] border-none bg-amber-500 text-amber-900 text-sm font-bold cursor-pointer"
            >
              Registrar Alerta
            </button>
            <button
              onClick={onClose}
              className="px-5 py-[10px] rounded-[10px] border-2 border-slate-200 bg-transparent text-slate-500 text-sm font-bold cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>

        {/* Active intel */}
        {activeIntel.length > 0 && (
          <div className="mt-[18px] border-t border-slate-200 pt-[14px]">
            <div className="text-[11px] font-extrabold text-slate-600 uppercase mb-2">
              Alertas ativos ({activeIntel.length})
            </div>
            {activeIntel.map((i) => {
              const h = HOSPITALS.find((x) => x.id === i.hospitalId);
              const t = getIntelType(i.tipo);
              return (
                <div
                  key={i.id}
                  className="flex items-center gap-2 p-[10px] rounded-lg mb-1"
                  style={{
                    backgroundColor: t.bg,
                    border: `1px solid ${t.bd}`,
                  }}
                >
                  <span className="text-[15px]">{t.icon}</span>
                  <div className="flex-1">
                    <div className="text-xs font-bold">
                      <span className="text-slate-900">
                        {h?.name}
                      </span>{" "}
                      —{" "}
                      <span style={{ color: t.color }}>
                        {t.label}
                      </span>
                    </div>
                    {i.nota && (
                      <div className="text-[11px] text-slate-500">
                        {i.nota}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400">
                      {i.autor} · {fmt(i.timestamp)}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemove(i.id)}
                    className="px-[10px] py-1 text-[11px] rounded-[10px] bg-red-50 text-red-700 border border-red-300 font-bold cursor-pointer"
                  >
                    ✕ Remover
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Removed log */}
        {removedIntel.length > 0 && (
          <div className="mt-[14px] border-t border-slate-200 pt-3">
            <div className="text-[10px] font-extrabold text-slate-400 uppercase mb-[6px]">
              Histórico
            </div>
            {removedIntel.map((i) => {
              const h = HOSPITALS.find((x) => x.id === i.hospitalId);
              const t = getIntelType(i.tipo);
              return (
                <div
                  key={i.id}
                  className="text-[11px] text-slate-400 mb-[3px] py-[3px] border-b border-slate-100"
                >
                  <span className="line-through">
                    {t.icon} {h?.name} — {t.label}
                    {i.nota ? `: ${i.nota}` : ""} ({i.autor}{" "}
                    {fmt(i.timestamp)})
                  </span>
                  <span className="font-bold text-slate-500">
                    {" "}
                    → removido por {i.removidoPor} às{" "}
                    {i.removidoEm ? fmt(i.removidoEm) : "?"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
