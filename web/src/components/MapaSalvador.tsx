// ═══════════════════════════════════════════════════════════════
// Mapa de Salvador — escolher a origem da ocorrência clicando.
//
// Tiles do OpenStreetMap via Leaflet: sem chave no navegador, sem SKU novo,
// sem superfície de cobrança. É a mesma base de onde vieram os 291 lugares
// do índice.
//
// O clique NÃO vira rota nova: o servidor encaixa no lugar conhecido mais
// próximo e reusa a rota já materializada, para o plantão não passar a
// depender do Google. O mapa desenha esse encaixe — ponto clicado, lugar
// usado e a linha entre os dois — porque a aproximação chega a 2 km na
// periferia e esconder isso seria fingir precisão que não existe.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Encaixe, HospitalPonto } from "../lib/types";

// Salvador inteira, com folga para o Metropolitano em Lauro de Freitas.
const LIMITES = L.latLngBounds([-13.02, -38.58], [-12.73, -38.28]);

interface Props {
  ponto: { lat: number; lng: number } | null;
  encaixe: Encaixe | null;
  hospitais: HospitalPonto[];
  onEscolher: (lat: number, lng: number) => void;
}

export default function MapaSalvador({ ponto, encaixe, hospitais, onEscolher }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  // Camada única para tudo que muda: limpar uma camada é mais simples e mais
  // difícil de errar do que rastrear cada marcador individualmente.
  const camada = useRef<L.LayerGroup | null>(null);
  const aoEscolher = useRef(onEscolher);
  aoEscolher.current = onEscolher;

  useEffect(() => {
    if (!div.current || mapa.current) return;
    const m = L.map(div.current, {
      center: [-12.93, -38.44],
      zoom: 11,
      maxBounds: LIMITES,
      maxBoundsViscosity: 0.9,
      minZoom: 10,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      // Exigida pela política de uso do OSM.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => aoEscolher.current(e.latlng.lat, e.latlng.lng));
    camada.current = L.layerGroup().addTo(m);
    mapa.current = m;
    return () => {
      m.remove();
      mapa.current = null;
      camada.current = null;
    };
  }, []);

  // Hospitais: fixos, mas só entram depois que a API responde.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !hospitais.length) return;
    const grupo = L.layerGroup().addTo(m);
    for (const h of hospitais) {
      L.circleMarker([h.lat, h.lng], {
        radius: 6,
        color: "#0f172a",
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      })
        .bindTooltip(h.nome, { direction: "top" })
        .addTo(grupo);
    }
    return () => {
      grupo.remove();
    };
  }, [hospitais]);

  // Ponto clicado, lugar encaixado e a linha que mostra o tamanho do desvio.
  useEffect(() => {
    const c = camada.current;
    if (!c) return;
    c.clearLayers();
    if (!ponto) return;

    if (encaixe) {
      L.polyline(
        [
          [ponto.lat, ponto.lng],
          [encaixe.lat, encaixe.lng],
        ],
        { color: "#64748b", weight: 2, dashArray: "4 4" },
      ).addTo(c);
      L.circleMarker([encaixe.lat, encaixe.lng], {
        radius: 7,
        color: "#1d4ed8",
        weight: 2,
        fillColor: "#bfdbfe",
        fillOpacity: 1,
      })
        .bindTooltip(`${encaixe.nome} — rota usada`, { direction: "top" })
        .addTo(c);
    }

    L.circleMarker([ponto.lat, ponto.lng], {
      radius: 8,
      color: "#dc2626",
      weight: 3,
      fillColor: "#fee2e2",
      fillOpacity: 1,
    })
      .bindTooltip("Ocorrência", { direction: "top" })
      .addTo(c);
  }, [ponto, encaixe]);

  return (
    <div
      ref={div}
      className="w-full h-[320px] rounded-[10px] border border-slate-200 overflow-hidden z-0"
      // O painel tem header sticky em z-100; sem isto o Leaflet passa por cima.
      style={{ position: "relative", zIndex: 0 }}
    />
  );
}
