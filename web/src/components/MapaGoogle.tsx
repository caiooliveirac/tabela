// ═══════════════════════════════════════════════════════════════
// Mapa do Google — escolher a origem e VER as rotas.
//
// Mesmo contrato do MapaSalvador (Leaflet), que continua no repo como
// fallback: sem GOOGLE_MAPS_BROWSER_KEY, ou com o script do Google fora do ar,
// o painel volta para o OSM e o plantão não fica sem mapa.
//
// O que o Google acrescenta e o Leaflet não tinha:
//   • as rotas dos primeiros destinos do ranking, desenhadas na cor da
//     posição — o regulador vê POR ONDE a ambulância vai, não só o tempo;
//   • base cartográfica com os pontos de referência que a regulação usa.
//
// O ranking continua vindo das rotas materializadas do servidor. As chamadas
// de Directions daqui são só para desenhar a linha; se falharem, o ranking
// não muda — o Google segue fora do caminho crítico da decisão.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import type { Encaixe, HospitalPonto } from "../lib/types";
import { garantirGoogleMaps } from "../lib/googleMaps";

// Mesmos limites do MapaSalvador: Salvador com folga para o Metropolitano.
const LIMITES = { south: -13.02, west: -38.58, north: -12.73, east: -38.28 };

/** Cor da rota por posição no ranking — casa com o número do card. */
const CORES_ROTA = ["#1d4ed8", "#9333ea", "#0d9488"];

// Directions é cobrado por chamada. Mesma origem + mesmo hospital dá a mesma
// linha até o fim da sessão — alternar perfil ou reabrir o mapa não re-paga.
const cacheRotas = new Map<string, google.maps.DirectionsResult>();

interface Props {
  mapsKey: string;
  mapId: string;
  ponto: { lat: number; lng: number } | null;
  encaixe: Encaixe | null;
  hospitais: HospitalPonto[];
  /** Origem do ranking: o ponto clicado, ou o lugar achado pelo texto. */
  origem: { lat: number; lng: number } | null;
  /** hospitalIds dos primeiros destinos COM tempo — viram rota desenhada. */
  rotas: string[];
  onEscolher: (lat: number, lng: number) => void;
  /** Script do Google não subiu: o pai troca para o Leaflet. */
  onFalha: () => void;
}

export default function MapaGoogle({
  mapsKey,
  mapId,
  ponto,
  encaixe,
  hospitais,
  origem,
  rotas,
  onEscolher,
  onFalha,
}: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<google.maps.Map | null>(null);
  const [pronto, setPronto] = useState(false);

  const aoEscolher = useRef(onEscolher);
  aoEscolher.current = onEscolher;
  const aoFalhar = useRef(onFalha);
  aoFalhar.current = onFalha;

  // Arrays/objetos novos a cada render do pai não podem ser deps de effect;
  // a chave em string só muda quando o conteúdo muda.
  const rotasKey = rotas.join(",");
  const origemKey = origem ? `${origem.lat},${origem.lng}` : "";
  const valores = useRef({ hospitais, origem, rotas, ponto, encaixe });
  valores.current = { hospitais, origem, rotas, ponto, encaixe };

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await garantirGoogleMaps(mapsKey);
        const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
        // Marker e Directions já ficam prontos para os effects de desenho.
        await google.maps.importLibrary("marker");
        await google.maps.importLibrary("routes");
        if (!vivo || !div.current) return;
        const m = new Map(div.current, {
          center: { lat: -12.93, lng: -38.44 },
          zoom: 11,
          mapId,
          // Todo clique é "a ocorrência é aqui" — sem infowindow de POI no meio.
          clickableIcons: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          minZoom: 10,
          restriction: { latLngBounds: LIMITES, strictBounds: false },
        });
        m.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) aoEscolher.current(e.latLng.lat(), e.latLng.lng());
        });
        mapa.current = m;
        setPronto(true);
      } catch (e) {
        console.error("[mapa] Google Maps indisponível, voltando ao Leaflet:", e);
        if (vivo) aoFalhar.current();
      }
    })();
    return () => {
      vivo = false;
      mapa.current = null;
    };
    // Chave e mapId não mudam sem recarregar a página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hospitais: pino branco. Os que têm rota desenhada ganham o número e a cor
  // da posição, para o mapa e o card contarem a mesma história.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const { hospitais: hs, rotas: ids } = valores.current;
    const pinos: google.maps.marker.AdvancedMarkerElement[] = [];
    for (const h of hs) {
      const posicao = ids.indexOf(h.id);
      const pin =
        posicao >= 0
          ? new google.maps.marker.PinElement({
              glyph: String(posicao + 1),
              glyphColor: "#fff",
              background: CORES_ROTA[posicao],
              borderColor: "#fff",
              scale: 1.1,
            })
          : new google.maps.marker.PinElement({
              glyph: "H",
              glyphColor: "#0f172a",
              background: "#fff",
              borderColor: "#0f172a",
              scale: 0.85,
            });
      pinos.push(
        new google.maps.marker.AdvancedMarkerElement({
          map: m,
          position: { lat: h.lat, lng: h.lng },
          title: h.nome,
          content: pin.element,
          zIndex: posicao >= 0 ? 20 - posicao : 5,
        }),
      );
    }
    return () => {
      for (const p of pinos) p.map = null;
    };
  }, [pronto, hospitais, rotasKey]);

  // Origem, encaixe e a linha tracejada do tamanho da aproximação.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const { ponto: p, encaixe: e, origem: o } = valores.current;
    const marcadores: google.maps.marker.AdvancedMarkerElement[] = [];
    let linha: google.maps.Polyline | null = null;

    if (p && e) {
      // Polyline não tem dash nativo: o padrão é símbolo repetido.
      linha = new google.maps.Polyline({
        map: m,
        path: [p, { lat: e.lat, lng: e.lng }],
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#64748b", scale: 2 },
            offset: "0",
            repeat: "10px",
          },
        ],
      });
      marcadores.push(
        new google.maps.marker.AdvancedMarkerElement({
          map: m,
          position: { lat: e.lat, lng: e.lng },
          title: `${e.nome} — rota usada`,
          content: new google.maps.marker.PinElement({
            background: "#bfdbfe",
            borderColor: "#1d4ed8",
            glyphColor: "#1d4ed8",
            scale: 0.8,
          }).element,
          zIndex: 30,
        }),
      );
    }

    const origemPino = p ?? o;
    if (origemPino) {
      marcadores.push(
        new google.maps.marker.AdvancedMarkerElement({
          map: m,
          position: origemPino,
          title: "Ocorrência",
          content: new google.maps.marker.PinElement({
            background: "#dc2626",
            borderColor: "#7f1d1d",
            glyphColor: "#fff",
            scale: 1.2,
          }).element,
          zIndex: 40,
        }),
      );
    }

    return () => {
      for (const mk of marcadores) mk.map = null;
      linha?.setMap(null);
    };
  }, [pronto, ponto, encaixe, origemKey]);

  // Rotas dos primeiros destinos. Desenho, não decisão: o tempo do card vem do
  // servidor; aqui é só a geometria de por onde se vai.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const { origem: o, rotas: ids, hospitais: hs } = valores.current;
    if (!o || !ids.length || !hs.length) return;

    const porId = new Map(hs.map((h) => [h.id, h]));
    const service = new google.maps.DirectionsService();
    const renderers: google.maps.DirectionsRenderer[] = [];
    let vivo = true;

    (async () => {
      const limites = new google.maps.LatLngBounds();
      limites.extend(o);
      const resultados = await Promise.all(
        ids.map(async (id, i) => {
          const h = porId.get(id);
          if (!h) return null;
          const chave = `${o.lat},${o.lng}:${id}`;
          let res = cacheRotas.get(chave) ?? null;
          if (!res) {
            try {
              res = await service.route({
                origin: o,
                destination: { lat: h.lat, lng: h.lng },
                travelMode: google.maps.TravelMode.DRIVING,
              });
              cacheRotas.set(chave, res);
            } catch (e) {
              // Sem rota desenhada não é sem destino: o ranking já está na tela.
              console.warn(`[mapa] rota até ${id} não desenhada:`, e);
              return null;
            }
          }
          return { res, i };
        }),
      );
      if (!vivo) return;
      for (const r of resultados) {
        if (!r) continue;
        renderers.push(
          new google.maps.DirectionsRenderer({
            map: m,
            directions: r.res,
            suppressMarkers: true,
            preserveViewport: true,
            polylineOptions: {
              strokeColor: CORES_ROTA[r.i],
              strokeWeight: r.i === 0 ? 5 : 4,
              strokeOpacity: r.i === 0 ? 0.9 : 0.55,
              zIndex: 10 - r.i,
            },
          }),
        );
        const b = r.res.routes[0]?.bounds;
        if (b) limites.union(b);
      }
      if (renderers.length) m.fitBounds(limites, 48);
    })();

    return () => {
      vivo = false;
      for (const r of renderers) r.setMap(null);
    };
  }, [pronto, origemKey, rotasKey, hospitais]);

  return (
    <div
      ref={div}
      className="w-full h-[320px] rounded-[10px] border border-slate-200 overflow-hidden bg-slate-50"
      // Header sticky do painel em z-100; mesmo cuidado do MapaSalvador.
      style={{ position: "relative", zIndex: 0 }}
    />
  );
}
