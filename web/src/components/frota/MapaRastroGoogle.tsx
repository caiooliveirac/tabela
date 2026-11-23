// ═══════════════════════════════════════════════════════════════
// Mapa do detalhe da viatura no Google Maps (a chave e o mapId da aba Frota,
// via /encaminhamento/config): a cerca do hospital, o rastro do GPS pintado
// por fase (fases.ts da API), o local da ocorrência, as paradas no caminho e
// a posição atual. Mapa | Satélite e tela cheia nativos. Passar o mouse no
// rastro mostra a hora do ponto mais perto.
//
// Sem chave ou se o Google falhar, o detalhe cai no MapaRastro.tsx (Leaflet).
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import type { DetalheViaturaFrota } from "../../lib/types";
import { garantirGoogleMaps } from "../../lib/googleMaps";
import { COR, COR_FASE, NOME_FASE, corDoPonto, hora } from "./formato";

interface Props {
  detalhe: DetalheViaturaFrota;
  mapsKey: string;
  mapId: string;
  alto?: boolean;
  /** Muda quando a pessoa escolhe outra janela no seletor: o mapa reenquadra o rastro novo. */
  enquadrar?: number | null;
  onFalha: () => void;
}

/** Com mais pontos que isto, só a linha (cada bolinha é um elemento na página). */
const MAX_BOLINHAS = 400;

type Objeto = google.maps.Polyline | google.maps.Circle | google.maps.marker.AdvancedMarkerElement;

/** Bolinha centrada no ponto (o marcador avançado ancora pela base do conteúdo). */
function bolinha(cor: string, tam: number, borda = 2, fundo?: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:${tam}px;height:${tam}px;border-radius:50%;box-sizing:border-box;border:${borda}px solid ${fundo ? "#fff" : cor};background:${fundo ?? "#fff"};transform:translateY(50%);box-shadow:0 1px 2px rgba(15,23,42,.3)`;
  return el;
}

/** Etiqueta acima do ponto, como a do mapa da frota. */
function etiqueta(texto: string, distancia = 10): HTMLElement {
  const el = document.createElement("div");
  el.textContent = texto;
  el.style.cssText = `font:800 11px/1.2 'DM Sans',sans-serif;color:#0f172a;background:#fff;padding:2px 6px;border-radius:6px;box-shadow:0 1px 4px rgba(15,23,42,.25);white-space:nowrap;margin-bottom:${distancia}px;pointer-events:none`;
  return el;
}

export default function MapaRastroGoogle({ detalhe, mapsKey, mapId, alto = false, enquadrar = null, onFalha }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<google.maps.Map | null>(null);
  const objetos = useRef<Objeto[]>([]);
  const dica = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const enquadrado = useRef(false);
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
          mapTypeControl: true,
          // menu compacto: no mapa de 260 px os botões cobriam o rótulo do local
          mapTypeControlOptions: {
            mapTypeIds: ["roadmap", "satellite"],
            style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
            position: google.maps.ControlPosition.TOP_LEFT,
          },
          streetViewControl: false,
          fullscreenControl: true,
        });
        setPronto(true);
      } catch (e) {
        console.error("[frota] Google Maps indisponível no rastro:", e);
        if (vivo) aoFalhar.current();
      }
    })();
    return () => {
      vivo = false;
      for (const o of objetos.current) limpar(o);
      objetos.current = [];
      if (dica.current) dica.current.map = null;
      mapa.current = null;
    };
  }, [mapsKey, mapId]);

  useEffect(() => {
    enquadrado.current = false;
  }, [enquadrar]);

  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    for (const o of objetos.current) limpar(o);
    objetos.current = [];
    const { Polyline, Circle, LatLngBounds } = google.maps;
    const { AdvancedMarkerElement } = google.maps.marker;
    const d = detalhe;
    const limites = new LatLngBounds();
    const por = (o: Objeto) => {
      objetos.current.push(o);
      return o;
    };
    const marcador = (lat: number, lng: number, content: HTMLElement, zIndex: number, title?: string) =>
      por(new AdvancedMarkerElement({ map: m, position: { lat, lng }, content, zIndex, title }));

    // Cerca do destino: o prédio e cada estacionamento/porta aprendido.
    if (d.destino) {
      for (const c of [d.destino, ...d.destino.pontos]) {
        por(new Circle({
          map: m, center: { lat: c.lat, lng: c.lng }, radius: d.destino.raio,
          strokeColor: COR.hospital, strokeOpacity: 0.8, strokeWeight: 2, fillColor: COR.hospital, fillOpacity: 0.08, clickable: false,
        }));
      }
      marcador(d.destino.lat, d.destino.lng, bolinha(COR.alerta, 14, 2, COR.alerta), 20);
      marcador(d.destino.lat, d.destino.lng, etiqueta(`H ${d.destino.nome}`, 12), 21);
      limites.extend({ lat: d.destino.lat, lng: d.destino.lng });
    }

    // Rastro: trechos da mesma cor viram uma linha só; o novo começa no último ponto do anterior.
    let trecho: google.maps.LatLngLiteral[] = [];
    let cor = "";
    const linhas: google.maps.Polyline[] = [];
    const fechar = () => {
      if (trecho.length > 1) linhas.push(por(new Polyline({ map: m, path: trecho, strokeColor: cor, strokeWeight: 5, strokeOpacity: 0.9, zIndex: 5 })) as google.maps.Polyline);
    };
    for (const p of d.rastro) {
      const c = corDoPonto(d, p);
      const ll = { lat: p.lat, lng: p.lng };
      if (c !== cor) {
        fechar();
        trecho = trecho.length ? [trecho[trecho.length - 1], ll] : [ll];
        cor = c;
      } else trecho.push(ll);
      limites.extend(ll);
    }
    fechar();
    if (d.rastro.length <= MAX_BOLINHAS) {
      for (const p of d.rastro) marcador(p.lat, p.lng, bolinha(corDoPonto(d, p), 8, 2), 6, hora(p.em));
    }

    // Passar o mouse no rastro: a hora (e a fase) do ponto mais perto.
    if (!dica.current) dica.current = new AdvancedMarkerElement({ zIndex: 60 });
    const mostrar = (e: google.maps.PolyMouseEvent) => {
      const alvo = e.latLng;
      if (!alvo || !d.rastro.length) return;
      let melhor = d.rastro[0];
      let menor = Infinity;
      for (const p of d.rastro) {
        const dd = (p.lat - alvo.lat()) ** 2 + (p.lng - alvo.lng()) ** 2;
        if (dd < menor) [menor, melhor] = [dd, p];
      }
      dica.current!.position = { lat: melhor.lat, lng: melhor.lng };
      dica.current!.content = etiqueta(`${hora(melhor.em)}${melhor.fase ? ` · ${NOME_FASE[melhor.fase]}` : ""}`, 8);
      dica.current!.map = m;
    };
    for (const l of linhas) {
      l.addListener("mousemove", mostrar);
      l.addListener("mouseout", () => {
        if (dica.current) dica.current.map = null;
      });
    }

    // Local da ocorrência e paradas de 5+ min fora dele (pelo GPS).
    const f = d.fases;
    if (f) {
      for (const p of f.intermediarias) marcador(p.lat, p.lng, bolinha(COR.atrasada, 12, 2, COR.atrasada), 30, `Parada de ${p.minutos} min · ${hora(p.inicio)}`);
      if (f.local) {
        const l = f.local;
        marcador(l.lat, l.lng, bolinha(COR_FASE.local, 16, 2, COR_FASE.local), 31);
        marcador(l.lat, l.lng, etiqueta(`Local ${hora(l.inicio)}${l.aberta ? " · ainda lá" : `–${hora(l.fim)}`}`, 14), 32);
        limites.extend({ lat: l.lat, lng: l.lng });
      }
    }

    // Onde saiu da cerca: o primeiro ponto depois da saída.
    const saiu = d.localizacao.saiuEm;
    const depois = saiu ? d.rastro.find((p) => p.em >= saiu) : undefined;
    if (saiu && depois) {
      marcador(depois.lat, depois.lng, bolinha(COR.alerta, 14, 2, COR.alerta), 33);
      marcador(depois.lat, depois.lng, etiqueta(`Saiu da cerca ${hora(saiu)}`, 12), 34);
    }

    // Posição atual e a distância até o hospital (tracejada).
    const v = d.viatura;
    if (v.posicao) {
      const ll = { lat: v.posicao.lat, lng: v.posicao.lng };
      if (d.destino && d.localizacao.estado !== "na-cerca" && d.localizacao.distanciaM !== null) {
        por(new Polyline({
          map: m, path: [ll, { lat: d.destino.lat, lng: d.destino.lng }], strokeOpacity: 0, zIndex: 4, clickable: false,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: COR.alerta, scale: 2 }, offset: "0", repeat: "10px" }],
        }));
      }
      const fora = d.localizacao.estado === "fora-da-cerca";
      marcador(ll.lat, ll.lng, bolinha(fora ? COR.alerta : "#ea580c", 18, 3, fora ? COR.alerta : "#ea580c"), 40);
      marcador(ll.lat, ll.lng, etiqueta(`${v.nome} · ${hora(v.posicao.em)}`, 16), 41);
      limites.extend(ll);
    }

    // Enquadra uma vez por janela: a atualização de 30 s não tira o zoom de quem está olhando.
    if (!enquadrado.current && !limites.isEmpty()) {
      // margem maior em cima e à direita: os rótulos ficam acima do ponto e a tela cheia, no canto
      m.fitBounds(limites, { top: 56, right: 60, bottom: 28, left: 32 });
      google.maps.event.addListenerOnce(m, "idle", () => {
        if ((m.getZoom() ?? 0) > 16) m.setZoom(16);
      });
      enquadrado.current = true;
    }
  }, [detalhe, pronto]);

  return (
    <div
      ref={div}
      className={`w-full ${alto ? "h-[46vh] min-h-[320px]" : "h-[260px]"} rounded-lg border border-slate-200 overflow-hidden bg-slate-50`}
    />
  );
}

function limpar(o: Objeto) {
  if (o instanceof google.maps.marker.AdvancedMarkerElement) o.map = null;
  else o.setMap(null);
}
