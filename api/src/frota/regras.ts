// ═══════════════════════════════════════════════════════════════
// Regras da frota — funções puras, sem rede nem banco (testadas em
// regras.test.ts). O coletor chama; a rota só serializa.
// ═══════════════════════════════════════════════════════════════
import type { ViaturaCatalogo } from "./catalogo.js";
import type { HospitalFrota } from "./hospitais.js";

/** Entra no hospital a 150 m do prédio. */
export const RAIO_M = 150;
/** Só sai a 200 m: o GPS oscila na borda e abriria/fecharia a toda leitura. */
export const RAIO_SAIDA_M = 200;
/** Parada no hospital que vira alerta. */
export const ALERTA_MIN = 40;
/** Posição até 15 min: verde. Até 60 min: âmbar. Mais velha: fora do mapa. */
export const RECENTE_MIN = 15;
export const MAPA_MIN = 60;
/** Sem confirmar a posição há 1 h, a permanência fecha como "sem sinal". */
export const SEM_SINAL_FECHA_MIN = 60;

const MIN = 60_000;

/** `data_evento` do SAMU+ vem sem fuso; é hora de Salvador (UTC-3). */
export function instanteSamu(dataEvento: string): Date | null {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(dataEvento.trim());
    if (!m) return null;
    const d = new Date(`${m[1]}T${m[2]}-03:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}

/** Hospital mais perto dentro do raio. Raios que se cruzam: vence o mais perto. */
export function hospitalNoRaio(
    p: { lat: number; lng: number },
    hospitais: readonly HospitalFrota[],
    raio = RAIO_M,
): HospitalFrota | null {
    let melhor: HospitalFrota | null = null;
    let menor = Infinity;
    for (const h of hospitais) {
        const d = distanciaM(p, h);
        if (d <= raio && d < menor) {
            melhor = h;
            menor = d;
        }
    }
    return melhor;
}

// ── Vínculo: nome no SAMU+ → código do catálogo ────────────────
//
// O SAMU+ escreve "CB 02 (A)", "PB 60 [A]", "LFEX 01 (A)", "MT 07". O
// catálogo tem CB02, BR60, LFEX. O número da viatura é único no catálogo,
// mas o prefixo do SAMU+ às vezes é de outra base (viatura remanejada) e há
// unidades de evento com número repetido ("FV 02", Festival da Virada).
// Por isso duas passadas: primeiro o código exato; depois, só para quem
// sobrou, o número — e nunca para um código que já casou exato.

export interface VinculoCatalogo {
    codigo: string;
    /** O nome no SAMU+ tem prefixo de outra base (ex.: "PB 60" → BR60). */
    nomeDifere: boolean;
}

function lerNome(nome: string): { prefixo: string; numero: string | null } | null {
    const m = /^\s*([A-Za-z]{2,4})\s*-?\s*0*(\d+)?/.exec(nome);
    if (!m) return null;
    return { prefixo: m[1].toUpperCase(), numero: m[2] ? String(Number(m[2])) : null };
}

export function ehMoto(nome: string): boolean {
    return lerNome(nome)?.prefixo === "MT";
}

export function vincular(
    unidades: readonly { unidadeSamu: number; nome: string }[],
    catalogo: readonly ViaturaCatalogo[],
): Map<number, VinculoCatalogo> {
    const porCodigo = new Map(catalogo.map((c) => [c.codigo, c]));
    const porNumero = new Map<string, ViaturaCatalogo>();
    for (const c of catalogo) {
        const n = c.codigo.replace(/\D/g, "");
        if (n) porNumero.set(String(Number(n)), c);
    }
    const saida = new Map<number, VinculoCatalogo>();
    const tomados = new Set<string>();

    for (const u of unidades) {
        const l = lerNome(u.nome);
        if (!l) continue;
        const exato = l.numero
            ? porCodigo.get(l.prefixo + l.numero.padStart(2, "0")) ?? porCodigo.get(l.prefixo)
            : porCodigo.get(l.prefixo);
        if (exato && !tomados.has(exato.codigo)) {
            saida.set(u.unidadeSamu, { codigo: exato.codigo, nomeDifere: false });
            tomados.add(exato.codigo);
        }
    }
    for (const u of unidades) {
        if (saida.has(u.unidadeSamu)) continue;
        const l = lerNome(u.nome);
        if (!l?.numero || l.prefixo === "MT") continue;
        const c = porNumero.get(l.numero);
        if (c && !tomados.has(c.codigo)) {
            saida.set(u.unidadeSamu, { codigo: c.codigo, nomeDifere: true });
            tomados.add(c.codigo);
        }
    }
    return saida;
}

// ── Permanência no hospital ────────────────────────────────────

export interface Leitura {
    /** Código do catálogo, ou `samu:<unidade>` / `equipe:<id>` fora dele. */
    chave: string;
    em: Date;
    lat: number;
    lng: number;
    /** Ponto exato da base da viatura, quando se sabe. */
    base?: { lat: number; lng: number } | null;
}

/** Parada a 150 m da própria base é base, mesmo com hospital do lado. */
export function naBase(l: Pick<Leitura, "lat" | "lng" | "base">): boolean {
    return Boolean(l.base && distanciaM(l, l.base) <= RAIO_M);
}

export interface Permanencia {
    id?: number;
    chave: string;
    hospitalId: string;
    entrada: Date;
    ultimaVez: Date;
    alertaEm: Date | null;
}

export interface Fechamento {
    permanencia: Permanencia;
    /** null = perdeu o sinal lá dentro; não se sabe quando saiu. */
    saida: Date | null;
    motivo: "saiu" | "sem-sinal";
}

/**
 * Quanto tempo a viatura está no hospital. Com posição recente o relógio
 * corre até agora; sem confirmação há mais de 15 min, congela na última
 * posição dentro do raio — não se conta tempo que não se viu.
 */
export function duracaoMin(p: Pick<Permanencia, "entrada" | "ultimaVez">, agora: Date): number {
    const fresca = agora.getTime() - p.ultimaVez.getTime() <= RECENTE_MIN * MIN;
    const fim = fresca ? agora.getTime() : p.ultimaVez.getTime();
    return Math.max(0, Math.floor((fim - p.entrada.getTime()) / MIN));
}

export function avancarPermanencias(
    abertas: ReadonlyMap<string, Permanencia>,
    leituras: readonly Leitura[],
    hospitais: readonly HospitalFrota[],
    agora: Date,
): {
    abertas: Map<string, Permanencia>;
    novas: Permanencia[];
    alteradas: Permanencia[];
    fechadas: Fechamento[];
} {
    const proximas = new Map(abertas);
    const novas: Permanencia[] = [];
    const alteradas: Permanencia[] = [];
    const fechadas: Fechamento[] = [];
    const porId = new Map(hospitais.map((h) => [h.id, h]));

    for (const l of leituras) {
        // Posição velha não abre nem confirma nada.
        if (agora.getTime() - l.em.getTime() > SEM_SINAL_FECHA_MIN * MIN) continue;
        const atual = proximas.get(l.chave);
        const emCasa = naBase(l);
        if (atual) {
            if (l.em.getTime() <= atual.ultimaVez.getTime()) continue;
            const h = porId.get(atual.hospitalId);
            if (h && !emCasa && distanciaM(l, h) <= RAIO_SAIDA_M) {
                const nova: Permanencia = { ...atual, ultimaVez: l.em };
                if (!nova.alertaEm && duracaoMin(nova, agora) >= ALERTA_MIN) nova.alertaEm = agora;
                proximas.set(l.chave, nova);
                alteradas.push(nova);
                continue;
            }
            proximas.delete(l.chave);
            fechadas.push({ permanencia: atual, saida: l.em, motivo: "saiu" });
        }
        const h = emCasa ? null : hospitalNoRaio(l, hospitais);
        if (h) {
            const p: Permanencia = {
                chave: l.chave,
                hospitalId: h.id,
                entrada: l.em,
                ultimaVez: l.em,
                alertaEm: null,
            };
            proximas.set(l.chave, p);
            novas.push(p);
        }
    }

    for (const [chave, p] of proximas) {
        if (agora.getTime() - p.ultimaVez.getTime() > SEM_SINAL_FECHA_MIN * MIN) {
            proximas.delete(chave);
            fechadas.push({ permanencia: p, saida: null, motivo: "sem-sinal" });
        }
    }
    return { abertas: proximas, novas, alteradas, fechadas };
}

// ── Situação de cada viatura no painel ─────────────────────────

export type Situacao = "mapa" | "sem-sinal" | "fora-do-turno" | "desativada";

/**
 * SD e 10h rodam de dia. O horário exato do 10h não está na planilha
 * (NÃO DETERMINADO); assume-se dentro de 07h–19h, a janela do SD.
 */
export function noTurno(turno: string | null, agora: Date): boolean {
    if (turno !== "SD" && turno !== "10h") return true;
    const hora = (agora.getUTCHours() + 24 - 3) % 24;
    return hora >= 7 && hora < 19;
}

/** A planilha oficial põe esta viatura na rua agora? (sem o catálogo: sim) */
function escaladaAgora(v: { turno: string | null; status: string | null }, agora: Date): boolean {
    if (v.status === "DESATIVADA 24H") return false;
    if (v.status === "DESATIVADA SD") return v.turno !== "SD" && !noTurno("SD", agora);
    return noTurno(v.turno, agora);
}

export function situacao(
    v: { codigo: string | null; turno: string | null; status: string | null },
    idadeMin: number | null,
    desativadas: ReadonlySet<string>,
    agora: Date,
): { situacao: Situacao; motivo: string | null } {
    if (v.codigo && desativadas.has(v.codigo)) {
        return { situacao: "desativada", motivo: "até segunda ordem" };
    }
    // Quem transmite agora aparece, mesmo que a planilha diga o contrário:
    // o GPS vê a rua, a planilha pode estar velha.
    if (idadeMin !== null && idadeMin <= MAPA_MIN) {
        return {
            situacao: "mapa",
            motivo: escaladaAgora(v, agora) ? null : "fora da escala oficial agora",
        };
    }
    if (v.status === "DESATIVADA 24H" || (v.status === "DESATIVADA SD" && v.turno === "SD")) {
        return { situacao: "desativada", motivo: "no cadastro oficial" };
    }
    if (!escaladaAgora(v, agora)) {
        return {
            situacao: "fora-do-turno",
            motivo: v.status === "DESATIVADA SD" ? "desativada de dia" : `turno ${v.turno}, só de dia`,
        };
    }
    return {
        situacao: "sem-sinal",
        motivo: idadeMin === null ? "não aparece no SAMU+" : null,
    };
}
