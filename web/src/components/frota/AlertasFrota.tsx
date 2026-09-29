// Janela de aviso da retenção de maca: aparece em qualquer aba, fica até o
// "Ciente". Canto inferior direito para não brigar com os avisos das UPAs,
// que usam o superior.
import type { ViaturaFrota } from "../../lib/types";
import { COR, artigo, duracao, hora } from "./formato";

interface Props {
  pendentes: ViaturaFrota[];
  alertaMin: number;
  onVer: (v: ViaturaFrota) => void;
  onCiente: (v: ViaturaFrota) => void;
}

export default function AlertasFrota({ pendentes, alertaMin, onVer, onCiente }: Props) {
  if (!pendentes.length) return null;
  return (
    <div className="fixed bottom-3 right-3 z-[210] flex flex-col gap-2 w-[320px] max-h-[70vh] overflow-y-auto">
      {pendentes.map((v) => {
        const n = v.noHospital!;
        return (
          <div
            key={`${v.chave}|${n.entrada}`}
            role="alert"
            className="alert-in rounded-xl px-4 py-3 border-2 bg-white"
            style={{
              borderColor: COR.alerta,
              background: `color-mix(in srgb, ${COR.alerta} 7%, white)`,
              boxShadow: "0 8px 24px rgba(16,28,44,.18)",
            }}
          >
            <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: COR.alerta }}>
              Parada de {alertaMin} min ou mais
            </div>
            <div className="text-[16px] font-black text-slate-900 leading-tight mt-[2px]">
              {v.nome} há {duracao(n.minutos)} n{artigo(n.hospitalNome)} {n.hospitalNome}
            </div>
            <div className="text-[11px] text-slate-500 mt-[2px]">
              entrou {hora(n.entrada)}
              {v.base ? ` · base ${v.base}` : ""}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onVer(v)}
                className="flex-1 py-[6px] text-xs font-bold rounded-lg border cursor-pointer bg-white"
                style={{ borderColor: COR.alerta, color: COR.alerta }}
              >
                Ver no mapa
              </button>
              <button
                onClick={() => onCiente(v)}
                className="flex-1 py-[6px] text-xs font-bold rounded-lg border-none cursor-pointer text-white"
                style={{ backgroundColor: COR.alerta }}
              >
                Ciente
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
