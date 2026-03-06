import { useMemo } from "react";
import type { HospitalData } from "../lib/types";

interface SummaryDrawerProps {
  open: boolean;
  onClose: () => void;
  hospitals: HospitalData[];
}

interface HospitalSummary {
  id: string;
  name: string;
  aceitos: number;
  zeros: number;
  total: number;
}

function groupAndSort(
  hospitals: HospitalData[],
  cat: string,
): HospitalSummary[] {
  return hospitals
    .filter((h) => h.cat === cat)
    .map((h) => ({
      id: h.id,
      name: h.name,
      aceitos: h.aceitos,
      zeros: h.zeros,
      total: h.total,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export default function SummaryDrawer({
  open,
  onClose,
  hospitals,
}: SummaryDrawerProps) {
  const geral = useMemo(() => groupAndSort(hospitals, "geral"), [hospitals]);
  const psiq = useMemo(() => groupAndSort(hospitals, "psiq"), [hospitals]);
  const infecto = useMemo(
    () => groupAndSort(hospitals, "infecto"),
    [hospitals],
  );

  const totalReg = hospitals.reduce((s, h) => s + h.total, 0);
  const totalAce = hospitals.reduce((s, h) => s + h.aceitos, 0);
  const totalZer = hospitals.reduce((s, h) => s + h.zeros, 0);
  const pctAce = totalReg > 0 ? Math.round((totalAce / totalReg) * 100) : 0;
  const pctZer = totalReg > 0 ? 100 - pctAce : 0;
  const maxTotal = Math.max(1, ...hospitals.map((h) => h.total));

  const pctColor =
    pctAce >= 60 ? "#16a34a" : pctAce >= 40 ? "#ca8a04" : "#dc2626";

  const Row = ({ r }: { r: HospitalSummary }) => (
    <tr
      style={{
        backgroundColor: r.zeros > 0 ? "#fef2f2" : undefined,
      }}
    >
      <td className="py-[5px] pr-2 text-[12px] font-semibold text-slate-800 whitespace-nowrap">
        {r.name}
      </td>
      <td
        className="py-[5px] px-2 text-[12px] text-center tabular-nums"
        style={{ color: r.aceitos > 0 ? "#16a34a" : "#94a3b8" }}
      >
        {r.aceitos}
      </td>
      <td
        className="py-[5px] px-2 text-[12px] text-center tabular-nums"
        style={{
          color: r.zeros > 0 ? "#dc2626" : "#94a3b8",
          fontWeight: r.zeros > 0 ? 800 : 400,
        }}
      >
        {r.zeros}
      </td>
      <td
        className="py-[5px] px-2 text-[12px] text-center tabular-nums font-bold rounded-[3px]"
        style={{
          backgroundColor: `rgba(26, 86, 219, ${(r.total / maxTotal) * 0.15})`,
          color: r.total > 0 ? "#1e40af" : "#94a3b8",
        }}
      >
        {r.total}
      </td>
    </tr>
  );

  const SectionHeader = ({ label }: { label: string }) => (
    <tr>
      <td
        colSpan={4}
        className="pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide"
      >
        {label}
      </td>
    </tr>
  );

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[60] transition-opacity duration-200"
        style={{
          backgroundColor: open ? "rgba(0,0,0,0.25)" : "transparent",
          pointerEvents: open ? "auto" : "none",
          opacity: open ? 1 : 0,
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 bottom-0 z-[70] bg-white shadow-2xl flex flex-col transition-transform duration-200 ease-out w-[320px] max-md:w-full"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/80">
          <div>
            <h2 className="text-[15px] font-black text-slate-800 m-0">
              📊 Resumo do Plantão
            </h2>
            <span className="text-[11px] text-slate-400 font-medium">
              Desde 07:00
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200 border-none cursor-pointer text-slate-500 text-sm font-bold transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase pb-2 pr-2">
                  Hospital
                </th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase pb-2 px-2">
                  Aceitos
                </th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase pb-2 px-2">
                  Zero
                </th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase pb-2 px-2">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Emergência Geral */}
              <SectionHeader label="Emergência Geral" />
              {geral.map((r) => (
                <Row key={r.id} r={r} />
              ))}

              {/* Psiquiatria */}
              <SectionHeader label="Psiquiatria" />
              {psiq.map((r) => (
                <Row key={r.id} r={r} />
              ))}

              {/* Infectologia */}
              <SectionHeader label="Infectologia" />
              {infecto.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/80">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase">
              Total Regulações:
            </span>
            <span className="text-xl font-black text-slate-800">
              {totalReg}
            </span>
          </div>
          <div className="text-[11px] font-semibold">
            <span style={{ color: "#16a34a" }}>
              Aceitos: {totalAce}
            </span>
            <span className="text-slate-300 mx-1">·</span>
            <span style={{ color: "#dc2626" }}>
              Vagas Zero: {totalZer}
            </span>
            <span className="text-slate-300 mx-1">·</span>
            <span style={{ color: pctColor }}>
              Taxa: {pctAce}% aceite
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
