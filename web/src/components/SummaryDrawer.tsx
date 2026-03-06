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

// Cores fixas por hospital — replicam a planilha original (background da célula nome)
const HOSPITAL_COLORS: Record<string, { bg: string; tx: string }> = {
  municipal:        { bg: "#3b6fb5", tx: "#ffffff" },  // azul intermediária→escura
  hge:              { bg: "#fef9c3", tx: "#78650d" },  // amarelo bem claro
  hgrs:             { bg: "#fbc4b5", tx: "#7c2d12" },  // salmão bem claro
  suburbio:         { bg: "#d1d5db", tx: "#374151" },  // cinza
  hgesf:            { bg: "#fdba74", tx: "#7c2d12" },  // laranja
  metropolitano:    { bg: "#d4608a", tx: "#ffffff" },  // rosa sério
  menandro:         { bg: "#2a7a6d", tx: "#ffffff" },  // verde azulado escuro
  eladio:           { bg: "#8b6aae", tx: "#ffffff" },  // roxo legível
  juliano_moreira:  { bg: "#d1fae5", tx: "#065f46" },  // verde clarinho
  couto_maia:       { bg: "#c9a84c", tx: "#3f2b00" },  // amarelo amarronzado
  mario_leal:       { bg: "#dbeafe", tx: "#1e3a5f" },  // azul claro quase branco
};

/** Cor de fundo da coluna TOTAL — gradiente vermelho→laranja→verde baseado na proporção */
function totalBg(total: number, maxTotal: number): string {
  if (total === 0) return "transparent";
  const ratio = total / maxTotal;
  // Vermelho intenso para totais altos, laranja para médios, verde claro para baixos
  if (ratio > 0.7) return `rgba(220, 38, 38, ${0.15 + ratio * 0.25})`;
  if (ratio > 0.35) return `rgba(234, 88, 12, ${0.1 + ratio * 0.2})`;
  return `rgba(234, 179, 8, ${0.08 + ratio * 0.15})`;
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
  const maxTotal = Math.max(1, ...hospitals.map((h) => h.total));

  const pctColor =
    pctAce >= 60 ? "#16a34a" : pctAce >= 40 ? "#ca8a04" : "#dc2626";

  const Row = ({ r }: { r: HospitalSummary }) => {
    const hc = HOSPITAL_COLORS[r.id] || { bg: "#e2e8f0", tx: "#334155" };
    return (
      <tr>
        <td
          className="py-[6px] px-2 text-[12px] font-bold whitespace-nowrap"
          style={{ backgroundColor: hc.bg, color: hc.tx }}
        >
          {r.name.toUpperCase()}
        </td>
        <td
          className="py-[6px] px-2 text-[12px] text-center tabular-nums font-semibold"
          style={{ color: r.aceitos > 0 ? "#16a34a" : "#94a3b8" }}
        >
          {r.aceitos}
        </td>
        <td
          className="py-[6px] px-2 text-[12px] text-center tabular-nums"
          style={{
            color: r.zeros > 0 ? "#dc2626" : "#94a3b8",
            fontWeight: r.zeros > 0 ? 800 : 400,
          }}
        >
          {r.zeros}
        </td>
        <td
          className="py-[6px] px-2 text-[13px] text-center tabular-nums font-extrabold rounded-[3px]"
          style={{
            backgroundColor: totalBg(r.total, maxTotal),
            color: r.total > 0 ? "#1e293b" : "#94a3b8",
          }}
        >
          {r.total}
        </td>
      </tr>
    );
  };

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
            <tr className="border-b-2 border-slate-300">
              <th className="text-left text-[10px] font-extrabold text-slate-500 uppercase pb-2 pr-2">
                Hospital
              </th>
              <th className="text-center text-[10px] font-extrabold uppercase pb-2 px-2" style={{ color: "#16a34a" }}>
                Aceitos
              </th>
              <th className="text-center text-[10px] font-extrabold uppercase pb-2 px-2" style={{ color: "#dc2626" }}>
                Zero
              </th>
              <th className="text-center text-[10px] font-extrabold uppercase pb-2 px-2" style={{ color: "#dc2626" }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
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
      <div
        className="px-5 py-4 border-t-2 border-slate-300"
        style={{ backgroundColor: "#fef9c3" }}
      >
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] font-extrabold text-slate-600 uppercase">
            Ocorrências Reguladas
          </span>
          <span className="text-2xl font-black text-slate-800">
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
            Taxa: {pctAce}%
          </span>
        </div>
      </div>
    </div>
  );
}
