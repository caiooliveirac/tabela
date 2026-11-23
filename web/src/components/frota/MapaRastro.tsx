// ═══════════════════════════════════════════════════════════════
// RESERVA do mapa do detalhe (sem chave do Google ou se ele falhar; o
// principal é MapaRastroGoogle.tsx). Mapa do detalhe da viatura: a cerca do hospital (150 m do prédio e de cada
// estacionamento aprendido), o rastro do GPS da janela escolhida no modal
// (vinculação à ocorrência ou última hora, até dias atrás) e a posição atual. Leaflet + OpenStreetMap, como o mapa do Destino: sem
// chave no navegador.
//
// Cor do rastro: com ocorrência, uma cor por fase (fases.ts da API) — laranja
// até o local, marrom no local, violeta até a unidade, azul na unidade, verde
// no retorno; vermelho só no retorno com o status ainda de hospital. Sem
// ocorrência recente: violeta a caminho, azul na cerca, cinza depois.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DetalheViaturaFrota } from "../../lib/types";
import { COR, COR_FASE, COR_VINCULADA, NOME_FASE, corDoPonto, hora, horaSeg, marcosNoMapa } from "./formato";

interface Props {
  detalhe: DetalheViaturaFrota;
  alto?: boolean;
  /** Muda quando a pessoa escolhe outra janela no seletor: o mapa reenquadra o rastro novo. */
  enquadrar?: number | null;
  /** Ponto sob o cursor do slider ("ocorrência"): marcado com a hora exata. */
  cursor?: DetalheViaturaFrota["rastro"][number] | null;
}

const DIA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
const dia = (iso: string) => DIA.format(new Date(iso));

export default function MapaRastro({ detalhe, alto = false, enquadrar = null, cursor = null }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  // Dias de rastro são milhares de pontos: canvas, não um elemento SVG por ponto.
  const canvas = useRef<L.Canvas | null>(null);
  const enquadrado = useRef(false);
  const marcaCursor = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!div.current || mapa.current) return;
    const m = L.map(div.current, { center: [-12.93, -38.44], zoom: 12, minZoom: 10, zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    camada.current = L.layerGroup().addTo(m);
    canvas.current = L.canvas({ padding: 0.5 });
    mapa.current = m;
    // Dentro do modal o tamanho só se firma depois da animação de abertura.
    const t = window.setTimeout(() => m.invalidateSize(), 60);
    return () => {
      window.clearTimeout(t);
      m.remove();
      mapa.current = null;
      camada.current = null;
      canvas.current = null;
      marcaCursor.current = null;
      enquadrado.current = false;
    };
  }, []);

  useEffect(() => {
    enquadrado.current = false;
  }, [enquadrar]);

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

    // Rastro: trechos da mesma cor viram uma linha só. Ponto de outro dia leva a data no balão.
    const hoje = dia(d.janela.ate);
    let trecho: L.LatLngExpression[] = [];
    let corTrecho = "";
    const fechar = () => {
      if (trecho.length > 1) L.polyline(trecho, { color: corTrecho, weight: 4, opacity: 0.85, renderer: canvas.current ?? undefined }).addTo(g);
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
      L.circleMarker(ll, { radius: 3, color: cor, weight: 1, fillColor: "#fff", fillOpacity: 1, renderer: canvas.current ?? undefined })
        .bindTooltip(dia(p.em) === hoje ? hora(p.em) : `${dia(p.em)} ${hora(p.em)}`)
        .addTo(g);
      pontos.push(ll);
    }
    fechar();

    // O local da ocorrência e as paradas de 5+ min fora dele (pelo GPS).
    const f = d.fases;
    if (f) {
      for (const p of f.intermediarias) {
        L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 2, fillColor: COR.atrasada, fillOpacity: 1 })
          .bindTooltip(`Parada de ${p.minutos} min · ${hora(p.inicio)}`)
          .addTo(g);
      }
      if (f.local) {
        const l = f.local;
        L.circleMarker([l.lat, l.lng], { radius: 8, color: "#fff", weight: 2, fillColor: COR_FASE.local, fillOpacity: 1 })
          .bindTooltip(`Local ${hora(l.inicio)}${l.aberta ? " · ainda lá" : `–${hora(l.fim)}`}`, {
            permanent: true, direction: "top", offset: [0, -8], className: "rastro-rotulo",
          })
          .addTo(g);
        pontos.push([l.lat, l.lng]);
      }
    }

    // Os marcos com hora (saída da base, chegada e saída da unidade, volta à base).
    for (const k of marcosNoMapa(d)) {
      L.circleMarker([k.lat, k.lng], { radius: 5, color: "#fff", weight: 2, fillColor: k.cor, fillOpacity: 1 })
        .bindTooltip(k.texto, { permanent: true, direction: "top", offset: [0, -6], className: "rastro-rotulo rastro-marco" })
        .addTo(g);
    }

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
      // Ainda vinculada à ocorrência: halo verde neon e etiqueta verde.
      const vinculada = Boolean(d.ocorrencia?.ativa);
      if (vinculada) L.circleMarker(ll, { radius: 16, stroke: false, fillColor: COR_VINCULADA, fillOpacity: 0.35 }).addTo(g);
      const sufixo = vinculada ? ` · em ocorrência${d.ocorrencia?.protocolo ? ` ${d.ocorrencia.protocolo}` : ""}` : d.ocorrencia ? " · ocorrência encerrada" : "";
      L.circleMarker(ll, { radius: 9, color: vinculada ? COR_VINCULADA : "#fff", weight: 3, fillColor: d.localizacao.estado === "fora-da-cerca" ? COR.alerta : "#ea580c", fillOpacity: 1 })
        .bindTooltip(`${v.nome} · ${hora(v.posicao.em)}${sufixo}`, {
          permanent: true, direction: "top", offset: [0, -10], className: vinculada ? "rastro-rotulo rastro-vinculada" : "rastro-rotulo",
        })
        .addTo(g);
      pontos.push(ll);
    }

    // Enquadra uma vez por janela: a atualização de 30 s não tira o zoom de quem está olhando.
    if (!enquadrado.current && pontos.length) {
      m.fitBounds(L.latLngBounds(pontos), { padding: [28, 28], maxZoom: 16 });
      enquadrado.current = true;
    }
  }, [detalhe]);

  // O cursor do slider: só este marcador anda a cada arraste.
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (!cursor) {
      marcaCursor.current?.remove();
      marcaCursor.current = null;
      return;
    }
    const ll: L.LatLngExpression = [cursor.lat, cursor.lng];
    const texto = `${horaSeg(cursor.em)}${cursor.fase ? ` · ${NOME_FASE[cursor.fase]}` : ""}`;
    const cor = corDoPonto(detalhe, cursor);
    if (!marcaCursor.current) {
      marcaCursor.current = L.circleMarker(ll, { radius: 9, color: cor, weight: 4, fillColor: "#fff", fillOpacity: 1 })
        .bindTooltip(texto, { permanent: true, direction: "top", offset: [0, -10], className: "rastro-rotulo" })
        .addTo(m);
    } else {
      marcaCursor.current.setLatLng(ll).setStyle({ color: cor }).setTooltipContent(texto);
      marcaCursor.current.bringToFront();
    }
    if (!m.getBounds().contains(ll)) m.panTo(ll);
  }, [cursor, detalhe]);

  return (
    <div
      ref={div}
      className={`w-full ${alto ? "h-[46vh] min-h-[320px]" : "h-[260px]"} rounded-lg border border-slate-200 overflow-hidden bg-slate-50`}
      style={{ position: "relative", zIndex: 0 }}
    />
  );
}
