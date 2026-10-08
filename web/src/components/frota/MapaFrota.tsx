// Mapa da aba Frota: raio em todo hospital, etiqueta "H nome", uma etiqueta
// por viatura com posição da última hora. O desenho mora em camada.ts, que o
// mapa do Destino também usa.
import { useEffect, useRef, useState } from "react";
import type { PainelFrota, ViaturaFrota } from "../../lib/types";
import { garantirGoogleMaps } from "../../lib/googleMaps";
import { CamadaFrota } from "./camada";

const LIMITES = { south: -13.02, west: -38.58, north: -12.73, east: -38.28 };

export interface Foco {
  lat: number;
  lng: number;
  zoom: number;
  /** Muda a cada pedido, para focar de novo no mesmo ponto. */
  vez: number;
}

interface Props {
  mapsKey: string;
  mapId: string;
  painel: PainelFrota;
  noMapa: ViaturaFrota[];
  foco: Foco | null;
  alto: boolean;
  onFalha: () => void;
}

export default function MapaFrota({ mapsKey, mapId, painel, noMapa, foco, alto, onFalha }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<google.maps.Map | null>(null);
  const camada = useRef<CamadaFrota | null>(null);
  const [pronto, setPronto] = useState(false);
  const aoFalhar = useRef(onFalha);
  aoFalhar.current = onFalha;

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await garantirGoogleMaps(mapsKey);
        const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
        await google.maps.importLibrary("marker");
        if (!vivo || !div.current) return;
        mapa.current = new Map(div.current, {
          center: { lat: -12.93, lng: -38.45 },
          zoom: 12,
          mapId,
          clickableIcons: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          minZoom: 10,
          restriction: { latLngBounds: LIMITES, strictBounds: false },
        });
        camada.current = new CamadaFrota(mapa.current, { raios: "todos", rotulosHospital: true, zViatura: 45 });
        setPronto(true);
      } catch (e) {
        console.error("[frota] Google Maps indisponível:", e);
        if (vivo) aoFalhar.current();
      }
    })();
    return () => {
      vivo = false;
      camada.current?.limpar();
      camada.current = null;
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pronto) camada.current?.atualizar(painel, noMapa);
  }, [pronto, painel, noMapa]);

  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m || !foco) return;
    // Um único movimento de câmera. panTo + setZoom separados não funcionam:
    // o setZoom interrompe a animação do panTo no meio do caminho, e no zoom
    // 12 a restriction ainda empurra o centro antes do zoom — o mapa parava
    // longe da viatura.
    m.moveCamera({ center: { lat: foco.lat, lng: foco.lng }, zoom: foco.zoom });
    div.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pronto, foco]);

  return (
    <div
      ref={div}
      className={`w-full ${alto ? "h-[88vh]" : "h-[68vh]"} min-h-[420px] rounded-[10px] border border-slate-200 overflow-hidden bg-slate-50`}
      style={{ position: "relative", zIndex: 0 }}
    />
  );
}
