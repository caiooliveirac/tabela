// ═══════════════════════════════════════════════════════════════
// Mapa da frota: raio de 150 m em volta de cada hospital, uma etiqueta por
// viatura com posição da última hora.
//
// O raio é o desenho da regra: cinza = ninguém parado, azul = tem viatura
// dentro, vermelho pulsando = alguém passou de 40 min. A etiqueta da viatura
// tem a cor da idade da posição (verde até 15 min, âmbar até 1 h) e, dentro
// do raio, ganha borda azul e o tempo de parada.
//
// Marcadores são atualizados no lugar a cada coleta, não recriados — assim o
// balão aberto não some a cada 30 s.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import type { HospitalPonto, PainelFrota, ViaturaFrota } from "../../lib/types";
import { garantirGoogleMaps } from "../../lib/googleMaps";
import { COR, corDaIdade, duracao, hora } from "./formato";

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
  onFalha: () => void;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function estiloViatura(el: HTMLElement, v: ViaturaFrota, p: PainelFrota) {
  const h = v.noHospital;
  const cor = h?.alerta ? COR.alerta : corDaIdade(v.posicao!.idadeMin, p.limites.recenteMin);
  const moto = v.tipo === "MOTO";
  el.className = h?.alerta ? "frota-pulso" : "";
  el.style.cssText = [
    `background:${cor}`,
    "color:#fff",
    `font:800 ${moto ? 9 : 10}px/1 'DM Sans',sans-serif`,
    "padding:3px 5px",
    `border-radius:${moto ? 999 : 6}px`,
    `border:2px solid ${h ? (h.alerta ? "#7f1d1d" : COR.hospital) : "#fff"}`,
    "box-shadow:0 1px 4px rgba(15,23,42,.35)",
    "white-space:nowrap",
    "cursor:pointer",
  ].join(";");
  el.textContent = h ? `${v.nome} · ${h.minutos}′` : v.nome;
}

function balaoViatura(v: ViaturaFrota): string {
  const p = v.posicao!;
  const linhas = [
    `<b>${esc(v.nome)}</b>${v.tipo ? ` · ${v.tipo}` : ""}${v.base ? ` · ${esc(v.base)}` : ""}`,
    `Posição de ${hora(p.em)} (há ${duracao(p.idadeMin)})` +
      (v.velocidade != null ? ` · ${v.velocidade} km/h` : "") +
      (v.bateria != null ? ` · bateria ${v.bateria}%` : ""),
  ];
  if (v.noHospital) {
    const h = v.noHospital;
    linhas.push(
      `<span style="color:${h.alerta ? COR.alerta : COR.hospital};font-weight:800">` +
        `No ${esc(h.hospitalNome)} desde ${hora(h.entrada)} — ${duracao(h.minutos)}` +
        `${h.alerta ? " ⚠" : ""}</span>`,
    );
  } else if (v.naBase) {
    linhas.push("Na própria base");
  }
  if (v.nomeDifere && v.nomeSamu) linhas.push(`<span style="color:#64748b">No SAMU+: ${esc(v.nomeSamu)}</span>`);
  if (v.motivo) linhas.push(`<span style="color:#64748b">${esc(v.motivo)}</span>`);
  return `<div style="font:13px/1.45 'DM Sans',sans-serif;color:#0f172a">${linhas.join("<br>")}</div>`;
}

function balaoHospital(h: HospitalPonto, dentro: ViaturaFrota[], raio: number): string {
  const lista = dentro.length
    ? dentro
        .map(
          (v) =>
            `<span style="color:${v.noHospital!.alerta ? COR.alerta : COR.hospital};font-weight:800">${esc(v.nome)}</span>` +
            ` · ${duracao(v.noHospital!.minutos)} · desde ${hora(v.noHospital!.entrada)}`,
        )
        .join("<br>")
    : "Nenhuma viatura parada agora.";
  return (
    `<div style="font:13px/1.45 'DM Sans',sans-serif;color:#0f172a">` +
    `<b>${esc(h.nome)}</b> <span style="color:#64748b">· raio de ${raio} m</span><br>${lista}</div>`
  );
}

export default function MapaFrota({ mapsKey, mapId, painel, noMapa, foco, onFalha }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<google.maps.Map | null>(null);
  const balao = useRef<google.maps.InfoWindow | null>(null);
  const viaturas = useRef(new Map<string, { m: google.maps.marker.AdvancedMarkerElement; el: HTMLDivElement; v: ViaturaFrota }>());
  const hospitais = useRef(
    new Map<string, { c: google.maps.Circle; m: google.maps.marker.AdvancedMarkerElement; el: HTMLDivElement }>(),
  );
  const [pronto, setPronto] = useState(false);
  const aoFalhar = useRef(onFalha);
  aoFalhar.current = onFalha;
  const atual = useRef({ painel, noMapa });
  atual.current = { painel, noMapa };

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
        balao.current = new google.maps.InfoWindow();
        setPronto(true);
      } catch (e) {
        console.error("[frota] Google Maps indisponível:", e);
        if (vivo) aoFalhar.current();
      }
    })();
    return () => {
      vivo = false;
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hospitais e viaturas: cria o que falta, atualiza o que existe, tira o que sumiu.
  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m) return;
    const { painel: p, noMapa: lista } = atual.current;

    const dentroDe = new Map<string, ViaturaFrota[]>();
    for (const v of lista) {
      if (!v.noHospital) continue;
      const arr = dentroDe.get(v.noHospital.hospitalId) ?? [];
      arr.push(v);
      dentroDe.set(v.noHospital.hospitalId, arr);
    }

    for (const h of p.hospitais) {
      const dentro = dentroDe.get(h.id) ?? [];
      const alerta = dentro.some((v) => v.noHospital!.alerta);
      const cor = alerta ? COR.alerta : dentro.length ? COR.hospital : COR.vazio;
      let reg = hospitais.current.get(h.id);
      if (!reg) {
        const c = new google.maps.Circle({ map: m, center: h, radius: p.limites.raioM, clickable: true });
        const el = document.createElement("div");
        const mk = new google.maps.marker.AdvancedMarkerElement({ map: m, position: h, content: el, zIndex: 5, title: h.nome });
        reg = { c, m: mk, el };
        hospitais.current.set(h.id, reg);
        const abrir = () => {
          const d = atual.current.noMapa.filter((v) => v.noHospital?.hospitalId === h.id);
          balao.current?.setContent(balaoHospital(h, d, atual.current.painel.limites.raioM));
          balao.current?.setPosition(h);
          balao.current?.open({ map: m });
        };
        c.addListener("click", abrir);
        mk.addListener("click", abrir);
      }
      reg.c.setOptions({
        strokeColor: cor,
        strokeOpacity: 0.9,
        strokeWeight: alerta ? 3 : 2,
        fillColor: cor,
        fillOpacity: alerta ? 0.18 : dentro.length ? 0.1 : 0.05,
      });
      reg.el.className = alerta ? "frota-pulso" : "";
      reg.el.style.cssText =
        `background:#fff;color:#0f172a;border:2px solid ${cor};border-radius:999px;` +
        "padding:2px 7px;font:800 11px/1.2 'DM Sans',sans-serif;white-space:nowrap;cursor:pointer;" +
        "box-shadow:0 1px 4px rgba(15,23,42,.25)";
      reg.el.innerHTML =
        `H ${esc(h.nome)}` +
        (dentro.length ? ` <span style="color:${cor}">· ${dentro.length}</span>` : "");
    }

    const vistas = new Set<string>();
    for (const v of lista) {
      if (!v.posicao) continue;
      vistas.add(v.chave);
      const pos = { lat: v.posicao.lat, lng: v.posicao.lng };
      let reg = viaturas.current.get(v.chave);
      if (!reg) {
        const el = document.createElement("div");
        const mk = new google.maps.marker.AdvancedMarkerElement({ map: m, position: pos, content: el, title: v.nome });
        const chave = v.chave;
        mk.addListener("click", () => {
          const r = viaturas.current.get(chave);
          if (!r) return;
          balao.current?.setContent(balaoViatura(r.v));
          balao.current?.open({ map: m, anchor: r.m });
        });
        reg = { m: mk, el, v };
        viaturas.current.set(v.chave, reg);
      }
      reg.v = v;
      reg.m.position = pos;
      reg.m.zIndex = v.noHospital?.alerta ? 40 : v.noHospital ? 30 : 20;
      estiloViatura(reg.el, v, p);
    }
    for (const [chave, reg] of viaturas.current) {
      if (vistas.has(chave)) continue;
      reg.m.map = null;
      viaturas.current.delete(chave);
    }
  }, [pronto, painel, noMapa]);

  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m || !foco) return;
    m.panTo({ lat: foco.lat, lng: foco.lng });
    m.setZoom(foco.zoom);
  }, [pronto, foco]);

  // Ao desmontar, tira tudo do mapa (a instância do Google não é reaproveitada).
  useEffect(() => {
    const vs = viaturas.current;
    const hs = hospitais.current;
    return () => {
      for (const r of vs.values()) r.m.map = null;
      for (const r of hs.values()) {
        r.m.map = null;
        r.c.setMap(null);
      }
      vs.clear();
      hs.clear();
    };
  }, []);

  return (
    <div
      ref={div}
      className="w-full h-[460px] rounded-[10px] border border-slate-200 overflow-hidden bg-slate-50"
      style={{ position: "relative", zIndex: 0 }}
    />
  );
}
