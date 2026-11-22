// ═══════════════════════════════════════════════════════════════
// Mapa do detalhe da viatura: a cerca do hospital (150 m do prédio e de cada
// estacionamento aprendido), o rastro do GPS desde a abertura da ocorrência
// e a posição atual. Leaflet + OpenStreetMap, como o mapa do Destino: sem
// chave no navegador.
//
// Cor do rastro: violeta a caminho, azul dentro da cerca, vermelho depois de
// sair com o status ainda de hospital (cinza se o status já mudou).
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DetalheViaturaFrota } from "../../lib/types";
import { COR, COR_RASTRO, hora } from "./formato";

interface Props {
  detalhe: DetalheViaturaFrota;
  alto?: boolean;
}

function corDoPonto(d: DetalheViaturaFrota, p: { em: string; local: string | null }): string {
  if (d.destino && p.local === d.destino.id) return COR_RASTRO.dentro;
  const saiu = d.localizacao.saiuEm ?? d.permanencia?.saida ?? null;
  if (saiu && p.em > saiu) return d.localizacao.estado === "fora-da-cerca" ? COR_RASTRO.foraAlerta : COR_RASTRO.fora;
  return COR_RASTRO.caminho;
}

export default function MapaRastro({ detalhe, alto = false }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const enquadrado = useRef(false);

  useEffect(() => {
    if (!div.current || mapa.current) return;
    const m = L.map(div.current, { center: [-12.93, -38.44], zoom: 12, minZoom: 10, zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    camada.current = L.layerGroup().addTo(m);
    mapa.current = m;
    // Dentro do modal o tamanho só se firma depois da animação de abertura.
    const t = window.setTimeout(() => m.invalidateSize(), 60);
    return () => {
      window.clearTimeout(t);
      m.remove();
      mapa.current = null;
      camada.current = null;
      enquadrado.current = false;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    const g = camada.current;
    if (!m || !g) return;
    g.clearLayers();
    const d = detalhe;
    const pontos: L.LatLngExpression[] = [];

    // Cerca do destino: o pino e cada estacionamento/porta, com o raio de entrada.
    if (d.destino) {
      for (const c of [d.destino, ...d.destino.pontos]) {
        L.circle([c.lat, c.lng], {
          radius: d.destino.raio,
          color: COR.hospital,
          weight: 2,
          dashArray: "6 5",
          fillColor: COR.hospital,
          fillOpacity: 0.08,
        }).addTo(g);
      }
      L.circleMarker([d.destino.lat, d.destino.lng], { radius: 7, color: "#fff", weight: 2, fillColor: COR.alerta, fillOpacity: 1 })
        .bindTooltip(`H ${d.destino.nome}`, { permanent: true, direction: "top", offset: [0, -8], className: "rastro-rotulo" })
        .addTo(g);
      pontos.push([d.destino.lat, d.destino.lng]);
    }

    // Rastro: trechos da mesma cor viram uma linha só.
    let trecho: L.LatLngExpression[] = [];
    let corTrecho = "";
    const fechar = () => {
      if (trecho.length > 1) L.polyline(trecho, { color: corTrecho, weight: 4, opacity: 0.85 }).addTo(g);
    };
    for (const p of d.rastro) {
      const cor = corDoPonto(d, p);
      const ll: L.LatLngExpression = [p.lat, p.lng];
      if (cor !== corTrecho) {
        fechar();
        // O trecho novo começa no último ponto do anterior: a linha não quebra.
        trecho = trecho.length ? [trecho[trecho.length - 1], ll] : [ll];
        corTrecho = cor;
      } else {
        trecho.push(ll);
      }
      L.circleMarker(ll, { radius: 3, color: cor, weight: 1, fillColor: "#fff", fillOpacity: 1 })
        .bindTooltip(hora(p.em))
        .addTo(g);
      pontos.push(ll);
    }
    fechar();

    // Onde saiu da cerca: o primeiro ponto do rastro depois da saída.
    const saiu = d.localizacao.saiuEm;
    const depois = saiu ? d.rastro.find((p) => p.em >= saiu) : undefined;
    if (saiu && depois) {
      L.circleMarker([depois.lat, depois.lng], { radius: 7, color: "#fff", weight: 2, fillColor: COR.alerta, fillOpacity: 1 })
        .bindTooltip(`Saiu da cerca ${hora(saiu)}`, { permanent: true, direction: "right", offset: [8, 0], className: "rastro-rotulo" })
        .addTo(g);
    }

    // Posição atual e a distância até o hospital.
    const v = d.viatura;
    if (v.posicao) {
      const ll: L.LatLngExpression = [v.posicao.lat, v.posicao.lng];
      if (d.destino && d.localizacao.estado !== "na-cerca" && d.localizacao.distanciaM !== null) {
        const km = d.localizacao.distanciaM < 1000 ? `${d.localizacao.distanciaM} m` : `${(d.localizacao.distanciaM / 1000).toFixed(1)} km`;
        L.polyline([ll, [d.destino.lat, d.destino.lng]], { color: COR.alerta, weight: 2, dashArray: "4 6", opacity: 0.8 })
          .bindTooltip(km, { sticky: true })
          .addTo(g);
      }
      L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: d.localizacao.estado === "fora-da-cerca" ? COR.alerta : "#ea580c", fillOpacity: 1 })
        .bindTooltip(`${v.nome} · ${hora(v.posicao.em)}`, { permanent: true, direction: "top", offset: [0, -10], className: "rastro-rotulo" })
        .addTo(g);
      pontos.push(ll);
    }

    // Enquadra uma vez: a atualização de 30 s não tira o zoom de quem está olhando.
    if (!enquadrado.current && pontos.length) {
      m.fitBounds(L.latLngBounds(pontos), { padding: [28, 28], maxZoom: 16 });
      enquadrado.current = true;
    }
  }, [detalhe]);

  return (
    <div
      ref={div}
      className={`w-full ${alto ? "h-[46vh] min-h-[320px]" : "h-[260px]"} rounded-lg border border-slate-200 overflow-hidden bg-slate-50`}
      style={{ position: "relative", zIndex: 0 }}
    />
  );
}
