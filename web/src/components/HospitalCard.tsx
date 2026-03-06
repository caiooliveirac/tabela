import type { HospitalData } from "../lib/types";
import { scoreToColor, NEUTRAL_STYLE } from "../lib/colors";
import IntelChip from "./IntelChip";

function fmt(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fAgo(ts: string): string {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 0) return "";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

interface HospitalCardProps {
  h: HospitalData;
  onSelect: (id: string) => void;
  isSel: boolean;
  highlight?: boolean;
}

export default function HospitalCard({
  h,
  onSelect,
  isSel,
  highlight,
}: HospitalCardProps) {
  const st =
    h.total === 0 && h.intel.length === 0 ? NEUTRAL_STYLE : scoreToColor(h.score);
  const pct = h.total > 0 ? (h.aceitos / h.total) * 100 : 0;
  const alerts = h.intel.filter((i) => i.tipo !== "pretendo_enviar");
  const enviar = h.intel.filter((i) => i.tipo === "pretendo_enviar");

  return (
    <button
      data-tutorial-id={`hospital-${h.id}`}
      onClick={() => onSelect(h.id)}
      className="flex flex-col gap-2 rounded-[14px] cursor-pointer transition-all text-left outline-none w-full relative overflow-hidden"
      style={{
        padding: "14px 16px 12px",
        border: isSel
          ? `3px solid ${st.bd}`
          : `2px solid ${st.bd}66`,
        backgroundColor: isSel ? st.bg : "#fff",
        boxShadow: highlight
          ? "0 0 0 4px #7c3aed44, 0 0 20px #7c3aed22"
          : isSel
            ? `0 0 0 4px ${st.bd}15, ${st.glow}`
            : st.glow,
      }}
    >
      {/* Color bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[5px] rounded-l-[14px]"
        style={{ backgroundColor: st.bd }}
      />

      {/* Envio planejado badge */}
      {enviar.length > 0 && (
        <div className="absolute top-0 right-0 bg-purple-600 text-white text-[10px] font-extrabold py-[2px] px-[10px] pl-3 rounded-br-none rounded-tr-[12px] rounded-bl-[10px]">
          🚑 ENVIO PLANEJADO
        </div>
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between w-full pl-2"
        style={{ paddingRight: enviar.length > 0 ? 110 : 0 }}
      >
        <span className="text-[17px] font-black text-slate-900">
          {h.name}
        </span>
      </div>

      {/* Stats */}
      {h.total > 0 ? (
        <div className="pl-2 w-full">
          <div className="flex justify-between mb-[3px]">
            <span className="text-xs font-bold text-green-600">
              {h.aceitos} aceito{h.aceitos !== 1 ? "s" : ""}
            </span>
            {h.zeros > 0 && (
              <span className="text-xs font-extrabold text-red-600">
                {h.zeros} vaga{h.zeros !== 1 ? "s" : ""} zero
              </span>
            )}
          </div>
          <div
            className="flex h-[7px] rounded overflow-hidden"
            style={{
              backgroundColor: h.zeros > 0 ? "#fecaca" : "#e2e8f0",
            }}
          >
            <div
              className="bg-green-500 rounded transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="pl-2">
          <span className="text-xs text-slate-400 italic">
            Nenhuma regulação
          </span>
        </div>
      )}

      {/* Vaga zero alert */}
      {h.lz && (
        <div className="ml-2 flex items-center gap-[5px] px-2 py-[5px] rounded-[7px] bg-red-50 border border-red-200">
          <span className="text-sm">🚫</span>
          <div>
            <span className="text-[11px] font-extrabold text-red-800">
              Vaga zero às {fmt(h.lz.timestamp)}
            </span>
            <span className="text-[10px] text-red-600 ml-1">
              ({fAgo(h.lz.timestamp)} atrás)
            </span>
          </div>
        </div>
      )}

      {/* Last accept */}
      {h.la && (
        <div className="pl-2 flex items-center gap-1">
          <span className="text-xs">✅</span>
          <span className="text-[11px] text-green-700 font-semibold">
            Último aceite: {fmt(h.la.timestamp)} (
            {fAgo(h.la.timestamp)} atrás)
          </span>
        </div>
      )}

      {/* Intel alerts */}
      {alerts.length > 0 && (
        <div className="pl-2 flex flex-col gap-1 w-full">
          {alerts.map((i) => (
            <IntelChip key={i.id} i={i} />
          ))}
        </div>
      )}

      {/* Envios planejados */}
      {enviar.length > 0 && (
        <div className="pl-2 flex flex-col gap-1 w-full">
          {enviar.map((i) => (
            <IntelChip key={i.id} i={i} />
          ))}
        </div>
      )}
    </button>
  );
}
