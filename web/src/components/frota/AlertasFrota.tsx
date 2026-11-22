// Janela de aviso da frota: aparece em qualquer aba, fica até o "Ciente".
// Canto inferior direito para não brigar com os avisos das UPAs, que usam o
// superior. Dois avisos: parada de 40 min (retenção de maca) e "saiu da cerca
// com o status ainda de chegada ao hospital" (provável liberação sem registro).
import type { ReactNode } from "react";
import type { ViaturaFrota } from "../../lib/types";
import { COR, artigo, duracao, hora } from "./formato";

interface Props {
  pendentes: ViaturaFrota[];
  /** Saíram da cerca com o status de hospital há `foraCercaMin` ou mais. */
  fora?: ViaturaFrota[];
  alertaMin: number;
  onVer: (v: ViaturaFrota) => void;
  onCiente: (v: ViaturaFrota, tipo: "parada" | "fora") => void;
  /** Abre o detalhe da viatura; sem ele, o botão leva ao mapa. */
  onDetalhe?: (v: ViaturaFrota) => void;
}

function Cartao({ titulo, frase, nota, onAbrir, abrir, onCiente }: {
  titulo: string;
  frase: ReactNode;
  nota: ReactNode;
  onAbrir: () => void;
  abrir: string;
  onCiente: () => void;
}) {
  return (
    <div
      role="alert"
      className="alert-in rounded-xl px-4 py-3 border-2 bg-white"
      style={{
        borderColor: COR.alerta,
        background: `color-mix(in srgb, ${COR.alerta} 7%, white)`,
        boxShadow: "0 8px 24px rgba(16,28,44,.18)",
      }}
    >
      <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: COR.alerta }}>
        {titulo}
      </div>
      <div className="text-[16px] font-black text-slate-900 leading-tight mt-[2px]">{frase}</div>
      <div className="text-[11px] text-slate-500 mt-[2px]">{nota}</div>
      <div className="flex gap-2 mt-2">
        <button
          onClick={onAbrir}
          className="flex-1 py-[6px] text-xs font-bold rounded-lg border cursor-pointer bg-white"
          style={{ borderColor: COR.alerta, color: COR.alerta }}
        >
          {abrir}
        </button>
        <button
          onClick={onCiente}
          className="flex-1 py-[6px] text-xs font-bold rounded-lg border-none cursor-pointer text-white"
          style={{ backgroundColor: COR.alerta }}
        >
          Ciente
        </button>
      </div>
    </div>
  );
}

export default function AlertasFrota({ pendentes, fora = [], alertaMin, onVer, onCiente, onDetalhe }: Props) {
  if (!pendentes.length && !fora.length) return null;
  const abrir = (v: ViaturaFrota) => (onDetalhe ? onDetalhe(v) : onVer(v));
  const rotulo = onDetalhe ? "Ver detalhes" : "Ver no mapa";
  return (
    <div className="fixed bottom-3 right-3 z-[210] flex flex-col gap-2 w-[320px] max-h-[70vh] overflow-y-auto">
      {fora.map((v) => {
        const f = v.foraDaCerca!;
        return (
          <Cartao
            key={`${v.chave}|fora|${f.paradaId}`}
            titulo="Saiu do hospital · status não mudou"
            frase={<>{v.nome} saiu d{artigo(f.hospitalNome)} {f.hospitalNome} há {duracao(f.minutos)}</>}
            nota={<>saiu {hora(f.saiuEm)} · o mapa de equipes segue em "chegada ao hospital"{f.statusEm ? ` (desde ${hora(f.statusEm)})` : ""}</>}
            onAbrir={() => abrir(v)}
            abrir={rotulo}
            onCiente={() => onCiente(v, "fora")}
          />
        );
      })}
      {pendentes.map((v) => {
        const n = v.noHospital!;
        return (
          <Cartao
            key={`${v.chave}|${n.entrada}`}
            titulo={`Parada de ${alertaMin} min ou mais`}
            frase={<>{v.nome} há {duracao(n.minutos)} n{artigo(n.hospitalNome)} {n.hospitalNome}</>}
            nota={<>entrou {hora(n.entrada)}{v.base ? ` · base ${v.base}` : ""}</>}
            onAbrir={() => abrir(v)}
            abrir={rotulo}
            onCiente={() => onCiente(v, "parada")}
          />
        );
      })}
    </div>
  );
}
