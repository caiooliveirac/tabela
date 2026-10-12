// ═══════════════════════════════════════════════════════════════
// Histórico da frota em agregados, para quem olha tendência (o dash da
// gestão): retenção por local e por dia, uso de cada viatura por dia e
// tempo fora de operação. Função pura — o coletor busca as linhas e a rota
// `GET /frota/historico?dias=N` devolve o que sai daqui.
//
// Só agregado: nada de paciente, protocolo, endereço, MR ou médico.
// ═══════════════════════════════════════════════════════════════
import type { ViaturaCatalogo } from "./catalogo.js";
import type { HospitalFrota } from "./hospitais.js";
import { ALERTA_MIN, donoDaPorta } from "./regras.js";

/** Abaixo disto a viatura só passou em frente (GPS a cada 2 min, raio de 150 m). */
export const VISITA_MIN = 10;

const MIN = 60_000;
const DIA = 86_400_000;
/** Salvador é UTC−3 o ano todo. */
const FUSO_MS = 3 * 3_600_000;

export const diaBahia = (d: Date): string => new Date(d.getTime() - FUSO_MS).toISOString().slice(0, 10);
const horaBahia = (d: Date): number => new Date(d.getTime() - FUSO_MS).getUTCHours();
/** Meia-noite (Salvador) do dia AAAA-MM-DD, em UTC. */
const inicioDoDia = (dia: string): number => Date.parse(`${dia}T00:00:00Z`) + FUSO_MS;

export interface ParadaBruta {
    chave: string;
    hospitalId: string;
    entrada: Date;
    /** Saída, ou a última posição confirmada quando perdeu o sinal ou segue aberta. */
    fim: Date;
    naBase: boolean;
    /** Onde o GPS ficou parado (ou a última posição, sem `estavel`). */
    lat: number | null;
    lng: number | null;
}
export interface OcorrenciaBruta {
    chave: string;
    primeiraVez: Date;
    ultimaVez: Date;
    /** Primeiro "CHEGADA AO HOSPITAL" (vale também para UPA), se houve. */
    chegadaDestino: Date | null;
}
export interface DesativacaoBruta {
    codigo: string;
    desde: Date;
    /** null = ainda fora de operação. */
    reativadaEm: Date | null;
    motivos: string[];
}

export interface Historico {
    de: string;
    ate: string;
    dias: string[];
    alertaMin: number;
    visitaMin: number;
    locais: { id: string; nome: string; tipo: "hospital" | "upa" }[];
    /** Catálogo ativo: o denominador de "frota disponível". */
    viaturas: { codigo: string; tipo: string; base: string; turno: string }[];
    /** Paradas de 10 min ou mais fora da própria base, pelo dia da entrada. */
    retencao: { dia: string; localId: string; visitas: number; retidas: number; minutos: number; excedenteMin: number }[];
    /** As mesmas paradas por faixa de 3 h da entrada (0, 3, … 21), no período todo. */
    faixas: { localId: string; hora: number; visitas: number; retidas: number }[];
    /** Por viatura do catálogo e por dia; minutos recortados no dia. */
    uso: { dia: string; codigo: string; ocorrencias: number; minOcorrencia: number; minPorta: number; minRetida: number; minFora: number }[];
    /** Minutos fora de operação por dia e motivo ("sem_motivo" quando veio vazio). */
    fora: { dia: string; motivo: string; viaturas: number; minutos: number }[];
    /** Do "chegada ao hospital" à liberação, pelo dia da chegada. Só ocorrência já encerrada. */
    destino: { dia: string; n: number; medianaMin: number; p90Min: number }[];
    /**
     * Horas do dia com alguma ocorrência no mapa de equipes. A ponte do mapa
     * pode ficar muda: dia com poucas horas não serve de base para "uso".
     */
    mapa: { dia: string; horas: number }[];
}

type Intervalo = [number, number];

function unir(xs: Intervalo[]): Intervalo[] {
    const ord = xs.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    const saida: Intervalo[] = [];
    for (const [a, b] of ord) {
        const u = saida[saida.length - 1];
        if (u && a <= u[1]) u[1] = Math.max(u[1], b);
        else saida.push([a, b]);
    }
    return saida;
}

/** Minutos de cada intervalo que caem em cada dia (Salvador). */
function porDia(xs: Intervalo[], dias: readonly string[]): Map<string, number> {
    const saida = new Map<string, number>();
    for (const dia of dias) {
        const ini = inicioDoDia(dia);
        let ms = 0;
        for (const [a, b] of xs) ms += Math.max(0, Math.min(b, ini + DIA) - Math.max(a, ini));
        if (ms > 0) saida.set(dia, Math.round(ms / MIN));
    }
    return saida;
}

function quantil(ordenado: number[], q: number): number {
    const i = (ordenado.length - 1) * q;
    const a = Math.floor(i);
    const b = Math.ceil(i);
    return Math.round(ordenado[a] + (ordenado[b] - ordenado[a]) * (i - a));
}

export function agregarHistorico(
    e: { paradas: readonly ParadaBruta[]; ocorrencias: readonly OcorrenciaBruta[]; desativacoes: readonly DesativacaoBruta[] },
    locais: readonly HospitalFrota[],
    catalogo: readonly ViaturaCatalogo[],
    de: Date,
    ate: Date,
): Historico {
    const dias: string[] = [];
    for (let t = inicioDoDia(diaBahia(de)); t < ate.getTime(); t += DIA) dias.push(diaBahia(new Date(t)));
    const noPeriodo = new Set(dias);
    const doCatalogo = new Set(catalogo.map((c) => c.codigo));

    // ── Retenção por local ──
    const ret = new Map<string, Historico["retencao"][number]>();
    const fx = new Map<string, Historico["faixas"][number]>();
    const porta: Intervalo[][] = [];
    const retida: Intervalo[][] = [];
    const idx = new Map<string, number>();
    const daViatura = (codigo: string) => {
        if (!idx.has(codigo)) {
            idx.set(codigo, porta.length);
            porta.push([]);
            retida.push([]);
        }
        return idx.get(codigo)!;
    };
    for (const p of e.paradas) {
        if (p.naBase) continue;
        const dia = diaBahia(p.entrada);
        const min = Math.floor((p.fim.getTime() - p.entrada.getTime()) / MIN);
        if (min < VISITA_MIN || !noPeriodo.has(dia)) continue;
        // Parada antiga travada no vizinho: quem parou na porta declarada é de lá.
        const dono = p.lat != null && p.lng != null ? donoDaPorta({ lat: p.lat, lng: p.lng }, locais) : null;
        const localId = dono?.id ?? p.hospitalId;
        const longa = min >= ALERTA_MIN;
        const r = ret.get(`${dia}|${localId}`) ?? { dia, localId, visitas: 0, retidas: 0, minutos: 0, excedenteMin: 0 };
        r.visitas++;
        r.minutos += min;
        if (longa) {
            r.retidas++;
            r.excedenteMin += min - ALERTA_MIN;
        }
        ret.set(`${dia}|${localId}`, r);
        const hora = Math.floor(horaBahia(p.entrada) / 3) * 3;
        const f = fx.get(`${localId}|${hora}`) ?? { localId, hora, visitas: 0, retidas: 0 };
        f.visitas++;
        if (longa) f.retidas++;
        fx.set(`${localId}|${hora}`, f);
        if (doCatalogo.has(p.chave)) {
            const i = daViatura(p.chave);
            porta[i].push([p.entrada.getTime(), p.fim.getTime()]);
            if (longa) retida[i].push([p.entrada.getTime(), p.fim.getTime()]);
        }
    }

    // ── Uso por viatura ──
    const ocs = new Map<string, OcorrenciaBruta[]>();
    for (const o of e.ocorrencias) {
        if (!doCatalogo.has(o.chave)) continue;
        ocs.set(o.chave, [...(ocs.get(o.chave) ?? []), o]);
    }
    const des = new Map<string, DesativacaoBruta[]>();
    for (const d of e.desativacoes) {
        if (!doCatalogo.has(d.codigo)) continue;
        des.set(d.codigo, [...(des.get(d.codigo) ?? []), d]);
    }
    const foraDe = (d: DesativacaoBruta): Intervalo => [d.desde.getTime(), (d.reativadaEm ?? ate).getTime()];
    const uso: Historico["uso"] = [];
    for (const c of catalogo) {
        const minhas = ocs.get(c.codigo) ?? [];
        const emOc = porDia(unir(minhas.map((o) => [o.primeiraVez.getTime(), o.ultimaVez.getTime()])), dias);
        const i = idx.get(c.codigo);
        const naPorta = i === undefined ? new Map<string, number>() : porDia(unir(porta[i]), dias);
        const presa = i === undefined ? new Map<string, number>() : porDia(unir(retida[i]), dias);
        const fora = porDia(unir((des.get(c.codigo) ?? []).map(foraDe)), dias);
        const n = new Map<string, number>();
        for (const o of minhas) n.set(diaBahia(o.primeiraVez), (n.get(diaBahia(o.primeiraVez)) ?? 0) + 1);
        for (const dia of dias) {
            const linha = {
                dia, codigo: c.codigo, ocorrencias: n.get(dia) ?? 0, minOcorrencia: emOc.get(dia) ?? 0,
                minPorta: naPorta.get(dia) ?? 0, minRetida: presa.get(dia) ?? 0, minFora: fora.get(dia) ?? 0,
            };
            if (linha.ocorrencias || linha.minOcorrencia || linha.minPorta || linha.minFora) uso.push(linha);
        }
    }

    // ── Fora de operação por motivo ──
    const fora = new Map<string, { dia: string; motivo: string; codigos: Set<string>; minutos: number }>();
    for (const d of e.desativacoes) {
        if (!doCatalogo.has(d.codigo)) continue;
        const motivos = d.motivos.length ? d.motivos : ["sem_motivo"];
        for (const [dia, minutos] of porDia([foraDe(d)], dias)) {
            for (const motivo of motivos) {
                const f = fora.get(`${dia}|${motivo}`) ?? { dia, motivo, codigos: new Set<string>(), minutos: 0 };
                f.codigos.add(d.codigo);
                f.minutos += minutos;
                fora.set(`${dia}|${motivo}`, f);
            }
        }
    }

    // ── Tempo no destino e cobertura do mapa ──
    const esperas = new Map<string, number[]>();
    for (const o of e.ocorrencias) {
        if (!o.chegadaDestino || !doCatalogo.has(o.chave)) continue;
        const dia = diaBahia(o.chegadaDestino);
        const min = Math.round((o.ultimaVez.getTime() - o.chegadaDestino.getTime()) / MIN);
        // Ainda no mapa há menos de 10 min: pode não ter acabado.
        if (min < 0 || !noPeriodo.has(dia) || ate.getTime() - o.ultimaVez.getTime() < 10 * MIN) continue;
        esperas.set(dia, [...(esperas.get(dia) ?? []), min]);
    }
    const ativa = unir(e.ocorrencias.map((o) => [o.primeiraVez.getTime(), o.ultimaVez.getTime()]));
    const mapa = dias.map((dia) => {
        const ini = inicioDoDia(dia);
        let horas = 0;
        for (let h = 0; h < 24; h++) {
            const a = ini + h * 3_600_000;
            if (ativa.some(([x, y]) => x < a + 3_600_000 && y > a)) horas++;
        }
        return { dia, horas };
    });

    const ordem = (a: { dia: string }, b: { dia: string }) => a.dia.localeCompare(b.dia);
    return {
        de: de.toISOString(),
        ate: ate.toISOString(),
        dias,
        alertaMin: ALERTA_MIN,
        visitaMin: VISITA_MIN,
        locais: locais.map((h) => ({ id: h.id, nome: h.nome, tipo: h.tipo })),
        viaturas: catalogo.map((c) => ({ codigo: c.codigo, tipo: c.tipo, base: c.base, turno: c.turno })),
        retencao: [...ret.values()].sort(ordem),
        faixas: [...fx.values()].sort((a, b) => a.localId.localeCompare(b.localId) || a.hora - b.hora),
        uso,
        fora: [...fora.values()].map((f) => ({ dia: f.dia, motivo: f.motivo, viaturas: f.codigos.size, minutos: f.minutos })).sort(ordem),
        destino: [...esperas.entries()]
            .map(([dia, xs]) => {
                const s = [...xs].sort((a, b) => a - b);
                return { dia, n: s.length, medianaMin: quantil(s, 0.5), p90Min: quantil(s, 0.9) };
            })
            .sort(ordem),
        mapa,
    };
}
