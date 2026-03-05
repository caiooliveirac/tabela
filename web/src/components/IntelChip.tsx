import type { IntelRow } from "../lib/types";
import { getIntelType } from "../lib/constants";

function fmt(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface IntelChipProps {
  i: IntelRow;
}

export default function IntelChip({ i }: IntelChipProps) {
  const t = getIntelType(i.tipo);
  return (
    <div
      className="flex items-start gap-[5px] px-2 py-[5px] rounded-[7px] w-full"
      style={{ backgroundColor: t.bg, border: `1px solid ${t.bd}` }}
    >
      <span className="text-[13px] leading-none flex-shrink-0">{t.icon}</span>
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-extrabold leading-tight"
          style={{ color: t.color }}
        >
          {t.label}
          {i.nota
            ? `: ${i.nota.length > 40 ? i.nota.slice(0, 40) + "…" : i.nota}`
            : ""}
        </div>
        <div className="text-[9px] text-slate-400 mt-[1px] font-semibold">
          {i.autor} · {fmt(i.timestamp)}
        </div>
      </div>
    </div>
  );
}
