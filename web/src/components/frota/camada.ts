// ═══════════════════════════════════════════════════════════════
// Camada da frota num mapa do Google — usada pela aba Frota e pelo mapa do
// Destino. Desenha o raio de cada hospital e uma etiqueta por viatura.
//
// O raio é o desenho da regra: cinza = ninguém parado, azul = tem viatura
// dentro, vermelho pulsando = alguém passou de 40 min. A etiqueta tem a cor
// da idade da posição (verde até 15 min, âmbar até 1 h); dentro do raio
// ganha borda azul e o tempo de parada.
//
// Marcadores são atualizados no lugar a cada coleta, não recriados — assim o
// balão aberto não some a cada 30 s.
// ═══════════════════════════════════════════════════════════════
import type { HospitalPonto, PainelFrota, ViaturaFrota } from "../../lib/types";
import { COR, corDaIdade, duracao, hora } from "./formato";

export interface OpcoesCamada {
  /** "todos": raio em todo hospital (aba Frota). "ocupados": só onde há viatura (Destino). */
  raios: "todos" | "ocupados";
  /** Etiqueta "H nome" no centro — o Destino já tem os pinos dele. */
  rotulosHospital: boolean;
  /** zIndex das viaturas. No Destino ficam por baixo dos pinos do ranking. */
  zViatura: number;
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
    `border:2px solid ${h ? (h.alerta ? "#7f1d1d" : h.naBase ? COR.base : COR.hospital) : "#fff"}`,
    "box-shadow:0 1px 4px rgba(15,23,42,.35)",
    "white-space:nowrap",
    "cursor:pointer",
  ].join(";");
  el.textContent = h ? (h.naBase ? `${v.nome} · base` : `${v.nome} · ${h.minutos}′`) : v.nome;
}

function balaoViatura(v: ViaturaFrota): string {
  const p = v.posicao!;
  const linhas = [
    `<b>${esc(v.nome)}</b>${v.tipo ? ` · ${v.tipo}` : ""}${v.base ? ` · ${esc(v.base)}` : ""}`,
    `Posição de ${hora(p.em)} (há ${duracao(p.idadeMin)})` +
      (v.velocidade != null ? ` · ${v.velocidade} km/h` : "") +
      (v.bateria != null ? ` · bateria ${v.bateria}%` : ""),
  ];
  if (v.noHospital?.naBase) {
    const h = v.noHospital;
    linhas.push(`Na própria base, junto do ${esc(h.hospitalNome)} desde ${hora(h.entrada)} (${duracao(h.minutos)}) — não conta para o alerta`);
  } else if (v.noHospital) {
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

interface RegHospital {
  c: google.maps.Circle;
  m: google.maps.marker.AdvancedMarkerElement | null;
  el: HTMLDivElement | null;
}

export class CamadaFrota {
  private viaturas = new Map<string, { m: google.maps.marker.AdvancedMarkerElement; el: HTMLDivElement; v: ViaturaFrota }>();
  private hospitais = new Map<string, RegHospital>();
  private balao: google.maps.InfoWindow;
  private atual: { painel: PainelFrota; noMapa: ViaturaFrota[] } | null = null;

  constructor(
    private mapa: google.maps.Map,
    private opcoes: OpcoesCamada,
  ) {
    this.balao = new google.maps.InfoWindow();
  }

  /** Cria o que falta, atualiza o que existe, tira o que sumiu. */
  atualizar(painel: PainelFrota, noMapa: ViaturaFrota[]): void {
    this.atual = { painel, noMapa };
    const dentroDe = new Map<string, ViaturaFrota[]>();
    for (const v of noMapa) {
      // Viatura na própria base não pinta o raio: o hospital não está retendo ninguém.
      if (!v.noHospital || v.noHospital.naBase) continue;
      const arr = dentroDe.get(v.noHospital.hospitalId) ?? [];
      arr.push(v);
      dentroDe.set(v.noHospital.hospitalId, arr);
    }

    for (const h of painel.hospitais) {
      const dentro = dentroDe.get(h.id) ?? [];
      const alerta = dentro.some((v) => v.noHospital!.alerta);
      const cor = alerta ? COR.alerta : dentro.length ? COR.hospital : COR.vazio;
      const visivel = this.opcoes.raios === "todos" || dentro.length > 0;
      let reg = this.hospitais.get(h.id);
      if (!reg) {
        reg = this.criarHospital(h, painel.limites.raioM);
        this.hospitais.set(h.id, reg);
      }
      reg.c.setOptions({
        visible: visivel,
        strokeColor: cor,
        strokeOpacity: 0.9,
        strokeWeight: alerta ? 3 : 2,
        fillColor: cor,
        fillOpacity: alerta ? 0.18 : dentro.length ? 0.1 : 0.05,
      });
      if (reg.el) {
        reg.el.className = alerta ? "frota-pulso" : "";
        reg.el.style.cssText =
          `background:#fff;color:#0f172a;border:2px solid ${cor};border-radius:999px;` +
          "padding:2px 7px;font:800 11px/1.2 'DM Sans',sans-serif;white-space:nowrap;cursor:pointer;" +
          "box-shadow:0 1px 4px rgba(15,23,42,.25)";
        reg.el.innerHTML =
          `H ${esc(h.nome)}` + (dentro.length ? ` <span style="color:${cor}">· ${dentro.length}</span>` : "");
      }
    }

    const vistas = new Set<string>();
    for (const v of noMapa) {
      if (!v.posicao) continue;
      vistas.add(v.chave);
      const pos = { lat: v.posicao.lat, lng: v.posicao.lng };
      let reg = this.viaturas.get(v.chave);
      if (!reg) {
        const el = document.createElement("div");
        const m = new google.maps.marker.AdvancedMarkerElement({ map: this.mapa, position: pos, content: el, title: v.nome });
        const chave = v.chave;
        m.addListener("click", () => {
          const r = this.viaturas.get(chave);
          if (!r) return;
          this.balao.setContent(balaoViatura(r.v));
          this.balao.open({ map: this.mapa, anchor: r.m });
        });
        reg = { m, el, v };
        this.viaturas.set(v.chave, reg);
      }
      reg.v = v;
      reg.m.position = pos;
      reg.m.zIndex = this.opcoes.zViatura + (v.noHospital?.alerta ? 2 : v.noHospital ? 1 : 0);
      estiloViatura(reg.el, v, painel);
    }
    for (const [chave, reg] of this.viaturas) {
      if (vistas.has(chave)) continue;
      reg.m.map = null;
      this.viaturas.delete(chave);
    }
  }

  private criarHospital(h: HospitalPonto, raio: number): RegHospital {
    // No Destino todo clique no mapa é "a ocorrência é aqui": o raio não pode
    // engolir o clique. Lá ele é só desenho.
    const c = new google.maps.Circle({
      map: this.mapa,
      center: h,
      radius: raio,
      clickable: this.opcoes.rotulosHospital,
      zIndex: 1,
    });
    let m: google.maps.marker.AdvancedMarkerElement | null = null;
    let el: HTMLDivElement | null = null;
    if (this.opcoes.rotulosHospital) {
      el = document.createElement("div");
      m = new google.maps.marker.AdvancedMarkerElement({ map: this.mapa, position: h, content: el, zIndex: 5, title: h.nome });
    }
    const abrir = () => {
      const a = this.atual;
      if (!a) return;
      const dentro = a.noMapa.filter((v) => v.noHospital?.hospitalId === h.id && !v.noHospital.naBase);
      this.balao.setContent(balaoHospital(h, dentro, a.painel.limites.raioM));
      this.balao.setPosition(h);
      this.balao.open({ map: this.mapa });
    };
    c.addListener("click", abrir);
    m?.addListener("click", abrir);
    return { c, m, el };
  }

  limpar(): void {
    this.balao.close();
    for (const r of this.viaturas.values()) r.m.map = null;
    for (const r of this.hospitais.values()) {
      r.c.setMap(null);
      if (r.m) r.m.map = null;
    }
    this.viaturas.clear();
    this.hospitais.clear();
  }
}
