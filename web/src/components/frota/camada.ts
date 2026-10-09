// ═══════════════════════════════════════════════════════════════
// Camada da frota num mapa do Google — usada pela aba Frota e pelo mapa do
// Destino. Desenha o raio de cada hospital e UPA e uma etiqueta por viatura.
// A UPA só mostra o nome quando tem viatura dentro — são 20, poluiriam o mapa.
// Estacionamento aprendido do GPS ganha o próprio círculo, da cor do local.
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
import {
  COR, artigo, corDaIdade, corRisco, duracao, estaNaBase, estadoOcorrencia, frase, hora, nomeProprio,
  type EstadoOcorrencia,
} from "./formato";

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

/**
 * Etiqueta: na base e livre é "SM 01 · base ✓"; na base EM OCORRÊNCIA perde o
 * "base" ("SM 01 🚑0384") — parada no endereço da base não é disponível.
 */
function rotulo(v: ViaturaFrota, est: EstadoOcorrencia | null): string {
  const h = v.noHospital;
  const sufixo =
    est === "ocorrencia"
      ? ` 🚑${v.ocorrencia?.ocorrencia?.protocolo ?? ""}`
      : est === "retornando"
        ? " ↩"
        : est === "livre"
          ? " ✓"
          : "";
  if (h && !h.naBase) return `${v.nome} · ${h.minutos}′${est === "ocorrencia" ? " 🚑" : sufixo}`;
  if (estaNaBase(v)) return est === "ocorrencia" ? `${v.nome}${sufixo}` : `${v.nome} · base${sufixo}`;
  return `${v.nome}${sufixo}`;
}

function estiloViatura(el: HTMLElement, v: ViaturaFrota, p: PainelFrota) {
  const h = v.noHospital;
  const est = estadoOcorrencia(v);
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
    // Faixa à esquerda na cor do risco: em ocorrência se vê de longe.
    est === "ocorrencia" ? `border-left:6px solid ${corRisco(v.ocorrencia?.ocorrencia?.risco)}` : "",
    "box-shadow:0 1px 4px rgba(15,23,42,.35)",
    "white-space:nowrap",
    "cursor:pointer",
  ]
    .filter(Boolean)
    .join(";");
  el.textContent = rotulo(v, est);
}

/** Linhas do mapa de equipes no balão: número, risco, MR, status e queixa. */
function linhasOcorrencia(v: ViaturaFrota, est: EstadoOcorrencia | null): string[] {
  if (est === null) return [];
  const o = v.ocorrencia?.ocorrencia;
  if (est === "livre" || !o) return [`<span style="color:${COR.livre};font-weight:800">✓ Livre no mapa de equipes</span>`];
  const risco = o.risco
    ? ` <span style="background:${corRisco(o.risco)};color:#fff;border-radius:4px;padding:0 5px;font-weight:700">${esc(o.risco)}</span>`
    : "";
  const titulo = est === "retornando" ? "↩ Encerrando ocorrência" : "🚑 Em ocorrência";
  const linhas = [
    `<span style="color:${COR.ocorrencia};font-weight:800">${titulo}${o.protocolo ? ` #${esc(o.protocolo)}` : ""}</span>${risco}`,
  ];
  if (o.medico) linhas.push(`MR <b>${esc(nomeProprio(o.medico))}</b>`);
  if (o.status) linhas.push(`${esc(frase(o.status))}${o.statusEm ? ` às ${hora(o.statusEm)}` : ""}`);
  const queixa = [o.queixa, o.bairro].filter(Boolean).map((x) => esc(x!)).join(" · ");
  if (queixa) linhas.push(`<span style="color:#475569">${queixa}</span>`);
  return linhas;
}

function balaoViatura(v: ViaturaFrota): string {
  const p = v.posicao!;
  const linhas = [
    `<b>${esc(v.nome)}</b>${v.tipo ? ` · ${v.tipo}` : ""}${v.base ? ` · ${esc(v.base)}` : ""}`,
    `Posição de ${hora(p.em)} (há ${duracao(p.idadeMin)})` +
      (v.velocidade != null ? ` · ${v.velocidade} km/h` : "") +
      (v.bateria != null ? ` · bateria ${v.bateria}%` : ""),
  ];
  const est = estadoOcorrencia(v);
  // Na base: disponível só se o mapa de equipes disser livre.
  const naBaseComo =
    est === "ocorrencia"
      ? `<span style="color:${COR.ocorrencia};font-weight:800">No endereço da base, mas EM OCORRÊNCIA</span>`
      : est === "retornando"
        ? "Na própria base, encerrando a ocorrência"
        : est === "livre"
          ? `<span style="color:${COR.livre};font-weight:800">Disponível na própria base</span>`
          : "Na própria base";
  if (v.noHospital?.naBase) {
    const h = v.noHospital;
    linhas.push(`${naBaseComo}, junto d${artigo(h.hospitalNome)} ${esc(h.hospitalNome)} desde ${hora(h.entrada)} (${duracao(h.minutos)}) — não conta para o alerta`);
  } else if (v.noHospital) {
    const h = v.noHospital;
    linhas.push(
      `<span style="color:${h.alerta ? COR.alerta : COR.hospital};font-weight:800">` +
        `N${artigo(h.hospitalNome)} ${esc(h.hospitalNome)} desde ${hora(h.entrada)} — ${duracao(h.minutos)}` +
        `${h.alerta ? " ⚠" : ""}</span>`,
    );
  } else if (v.naBase) {
    linhas.push(naBaseComo);
  }
  // Na base livre já foi dito acima; o resto ganha o bloco do mapa de equipes.
  if (!(est === "livre" && estaNaBase(v))) linhas.push(...linhasOcorrencia(v, est));
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
  const pontos = (h.pontos ?? [])
    .map((p) => `<br><span style="color:#64748b">Estacionamento aprendido do GPS (${p.viaturas} viaturas)</span>`)
    .join("");
  return (
    `<div style="font:13px/1.45 'DM Sans',sans-serif;color:#0f172a">` +
    `<b>${esc(h.nome)}</b> <span style="color:#64748b">· raio de ${raio} m</span><br>${lista}${pontos}</div>`
  );
}

interface RegHospital {
  c: google.maps.Circle;
  m: google.maps.marker.AdvancedMarkerElement | null;
  el: HTMLDivElement | null;
  /** Um círculo por estacionamento aprendido; refeitos quando o aprendizado muda. */
  pontos: google.maps.Circle[];
  chavePontos: string;
  abrir: () => void;
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
      const chavePontos = JSON.stringify(h.pontos ?? []);
      if (reg.chavePontos !== chavePontos) {
        for (const c of reg.pontos) c.setMap(null);
        reg.pontos = (h.pontos ?? []).map((p) => this.circulo(p, painel.limites.raioM, reg!.abrir));
        reg.chavePontos = chavePontos;
      }
      for (const c of [reg.c, ...reg.pontos]) {
        c.setOptions({
          visible: visivel,
          strokeColor: cor,
          strokeOpacity: 0.9,
          strokeWeight: alerta ? 3 : 2,
          fillColor: cor,
          fillOpacity: alerta ? 0.18 : dentro.length ? 0.1 : 0.05,
        });
      }
      if (reg.el) {
        reg.el.className = alerta ? "frota-pulso" : "";
        reg.el.style.cssText =
          `background:#fff;color:#0f172a;border:2px solid ${cor};border-radius:999px;` +
          "padding:2px 7px;font:800 11px/1.2 'DM Sans',sans-serif;white-space:nowrap;cursor:pointer;" +
          "box-shadow:0 1px 4px rgba(15,23,42,.25)" +
          (h.tipo === "upa" && !dentro.length ? ";display:none" : "");
        reg.el.innerHTML =
          `${h.tipo === "upa" ? "" : "H "}${esc(h.nome)}` +
          (dentro.length ? ` <span style="color:${cor}">· ${dentro.length}</span>` : "");
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

  private circulo(centro: google.maps.LatLngLiteral, raio: number, abrir: () => void): google.maps.Circle {
    // No Destino todo clique no mapa é "a ocorrência é aqui": o raio não pode
    // engolir o clique. Lá ele é só desenho.
    const c = new google.maps.Circle({
      map: this.mapa,
      center: centro,
      radius: raio,
      clickable: this.opcoes.rotulosHospital,
      zIndex: 1,
    });
    c.addListener("click", abrir);
    return c;
  }

  private criarHospital(h: HospitalPonto, raio: number): RegHospital {
    let m: google.maps.marker.AdvancedMarkerElement | null = null;
    let el: HTMLDivElement | null = null;
    if (this.opcoes.rotulosHospital) {
      el = document.createElement("div");
      m = new google.maps.marker.AdvancedMarkerElement({ map: this.mapa, position: h, content: el, zIndex: 5, title: h.nome });
    }
    const abrir = () => {
      const a = this.atual;
      if (!a) return;
      const atual = a.painel.hospitais.find((x) => x.id === h.id) ?? h;
      const dentro = a.noMapa.filter((v) => v.noHospital?.hospitalId === h.id && !v.noHospital.naBase);
      this.balao.setContent(balaoHospital(atual, dentro, a.painel.limites.raioM));
      this.balao.setPosition(h);
      this.balao.open({ map: this.mapa });
    };
    const c = this.circulo(h, raio, abrir);
    m?.addListener("click", abrir);
    return { c, m, el, pontos: [], chavePontos: "[]", abrir };
  }

  limpar(): void {
    this.balao.close();
    for (const r of this.viaturas.values()) r.m.map = null;
    for (const r of this.hospitais.values()) {
      r.c.setMap(null);
      for (const c of r.pontos) c.setMap(null);
      if (r.m) r.m.map = null;
    }
    this.viaturas.clear();
    this.hospitais.clear();
  }
}
