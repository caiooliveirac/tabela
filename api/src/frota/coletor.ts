// ═══════════════════════════════════════════════════════════════
// Coletor da frota: a cada 2 min lê as posições do SAMU+, atualiza as
// permanências nos hospitais e grava abertura/fechamento no banco.
//
// Estado em memória (um processo só, como o resto da API). O banco guarda
// o que precisa sobreviver a um restart: as permanências (histórico da
// retenção de maca) e o último vínculo equipe↔unidade.
// Sem SAMUMAIS_TOKEN no ambiente: coletor desligado, GET /frota diz isso.
// ═══════════════════════════════════════════════════════════════
import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { CATALOGO, DESATIVADAS_ATE_SEGUNDA_ORDEM } from "./catalogo.js";
import { LOCAIS_FROTA } from "./hospitais.js";
import { ALERTA_MIN, avancarPermanencias, duracaoMin, ehMoto, type Fechamento, type Permanencia } from "./regras.js";
import { textoAviso, type DadosAviso } from "./aviso.js";
import { editarReguladores, enviarReguladores } from "../lib/telegram.js";
import { ABERTA_MAX_MS, acolhimentosLigado, buscarAcolhimentos, cruzar, janela, type Acolhimento } from "./acolhimentos.js";
import { buscarDispositivos, buscarPosicoes, type DispositivoSamu, type PosicaoSamu } from "./samumais.js";
import { leiturasParaPermanencia, montarPainel, resolverPosicoes, type PainelFrota } from "./painel.js";

const TOKEN = process.env.SAMUMAIS_TOKEN || "";
const AVISOS = (process.env.FROTA_AVISOS_TELEGRAM ?? "1") !== "0";
const COLETA_MS = 2 * 60_000;
/** A página de status tem ~430 KB: vínculo a cada 10 min, ou antes se aparecer equipe nova. */
const VINCULOS_MS = 10 * 60_000;
const VINCULOS_MIN_MS = 2 * 60_000;

let coletadoEm: Date | null = null;
let vinculosEm: Date | null = null;
let tentouVinculosEm = 0;
let erro: string | null = null;
let posicoes: PosicaoSamu[] = [];
let dispositivos: DispositivoSamu[] = [];
let abertas = new Map<string, Permanencia>();
let rodando = false;
/** Último texto publicado por parada — só edita a mensagem quando muda. */
const textoPublicado = new Map<number, string>();

type Linha = Record<string, unknown>;
const consultar = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Linha[];

async function criarTabelas(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_permanencias (
            id          serial PRIMARY KEY,
            chave       varchar(60)  NOT NULL,
            hospital_id varchar(50)  NOT NULL,
            entrada     timestamptz  NOT NULL,
            ultima_vez  timestamptz  NOT NULL,
            saida       timestamptz,
            motivo_fim  varchar(20),
            alerta_em   timestamptz
        )`);
    await db.execute(sql`ALTER TABLE frota_permanencias ADD COLUMN IF NOT EXISTS aviso_msg_id bigint`);
    await db.execute(sql`ALTER TABLE frota_permanencias ADD COLUMN IF NOT EXISTS na_base boolean NOT NULL DEFAULT false`);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS frota_permanencias_abertas_idx
        ON frota_permanencias (chave) WHERE motivo_fim IS NULL`);
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_estado (
            chave         varchar(40) PRIMARY KEY,
            valor         jsonb       NOT NULL,
            atualizado_em timestamptz NOT NULL DEFAULT now()
        )`);
}

async function carregar(): Promise<void> {
    for (const r of await consultar(sql`
        SELECT id, chave, hospital_id, entrada, ultima_vez, alerta_em, aviso_msg_id, na_base
        FROM frota_permanencias WHERE motivo_fim IS NULL`)) {
        abertas.set(String(r.chave), {
            id: Number(r.id),
            chave: String(r.chave),
            hospitalId: String(r.hospital_id),
            entrada: new Date(r.entrada as string),
            ultimaVez: new Date(r.ultima_vez as string),
            alertaEm: r.alerta_em ? new Date(r.alerta_em as string) : null,
            avisoMsgId: r.aviso_msg_id != null ? Number(r.aviso_msg_id) : null,
            naBase: r.na_base === true,
        });
    }
    const [v] = await consultar(sql`SELECT valor, atualizado_em FROM frota_estado WHERE chave = 'dispositivos'`);
    if (v) {
        dispositivos = v.valor as DispositivoSamu[];
        vinculosEm = new Date(v.atualizado_em as string);
    }
}

async function atualizarVinculos(): Promise<void> {
    tentouVinculosEm = Date.now();
    const lidos = await buscarDispositivos();
    if (!lidos.length) throw new Error("status-unidades: nenhuma unidade");
    dispositivos = lidos;
    vinculosEm = new Date();
    await db.execute(sql`
        INSERT INTO frota_estado (chave, valor, atualizado_em)
        VALUES ('dispositivos', ${JSON.stringify(lidos)}::jsonb, now())
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`);
}

async function ciclo(): Promise<void> {
    if (rodando) return;
    rodando = true;
    try {
        posicoes = await buscarPosicoes(TOKEN);

        const conhecidas = new Set(dispositivos.map((d) => d.equipe));
        const equipeNova = posicoes.some((p) => !conhecidas.has(p.idEquipe));
        const velho = !vinculosEm || Date.now() - vinculosEm.getTime() > VINCULOS_MS;
        if ((velho || equipeNova) && Date.now() - tentouVinculosEm > VINCULOS_MIN_MS) {
            // Página fora do ar não para a coleta: segue com o último vínculo.
            await atualizarVinculos().catch((e) => console.warn("[frota] vínculos:", (e as Error).message));
        }

        const agora = new Date();
        const resolvidas = resolverPosicoes(posicoes, dispositivos, CATALOGO);
        const r = avancarPermanencias(
            abertas,
            leiturasParaPermanencia(resolvidas, DESATIVADAS_ATE_SEGUNDA_ORDEM, CATALOGO),
            LOCAIS_FROTA,
            agora,
        );
        for (const p of r.novas) {
            const [linha] = await consultar(sql`
                INSERT INTO frota_permanencias (chave, hospital_id, entrada, ultima_vez, na_base)
                VALUES (${p.chave}, ${p.hospitalId}, ${p.entrada.toISOString()}, ${p.ultimaVez.toISOString()}, ${p.naBase})
                RETURNING id`);
            p.id = Number(linha.id);
        }
        for (const p of r.alteradas) {
            if (p.id === undefined) continue;
            await db.execute(sql`
                UPDATE frota_permanencias
                SET ultima_vez = ${p.ultimaVez.toISOString()}, alerta_em = ${p.alertaEm?.toISOString() ?? null}
                WHERE id = ${p.id}`);
        }
        for (const f of r.fechadas) {
            if (f.permanencia.id === undefined) continue;
            await db.execute(sql`
                UPDATE frota_permanencias
                SET saida = ${f.saida?.toISOString() ?? null}, motivo_fim = ${f.motivo}
                WHERE id = ${f.permanencia.id}`);
        }
        abertas = r.abertas;
        coletadoEm = agora;
        erro = null;
        // Telegram fora do ar não é falha de coleta.
        await avisar(r.fechadas, agora).catch((e) => console.error("[frota] aviso:", (e as Error).message));
    } catch (e) {
        erro = (e as Error).message;
        console.error("[frota] coleta:", erro);
    } finally {
        rodando = false;
    }
}

/** Nome, tipo e base de uma chave do coletor (catálogo, ou o nome do SAMU+). */
export function descreverChave(chave: string): { nome: string; tipo: string | null; base: string | null } {
    const c = CATALOGO.find((v) => v.codigo === chave);
    if (c) return { nome: c.codigo, tipo: c.tipo, base: c.base };
    const unidade = Number(chave.replace(/^samu:/, ""));
    const d = chave.startsWith("samu:") ? dispositivos.find((x) => x.unidadeSamu === unidade) : undefined;
    const nome = d?.nome ?? chave.replace(/^equipe:/, "Equipe ");
    return { nome, tipo: ehMoto(nome) ? "MOTO" : null, base: null };
}

function dadosAviso(p: Permanencia): DadosAviso {
    const q = descreverChave(p.chave);
    const h = LOCAIS_FROTA.find((x) => x.id === p.hospitalId);
    return { nome: q.nome, tipo: q.tipo, hospitalNome: h?.nome ?? p.hospitalId, entrada: p.entrada, ultimaVez: p.ultimaVez };
}

/**
 * Uma mensagem por parada em HOSPITAL no grupo dos reguladores: sai quando a parada
 * passa de 40 min, é editada a cada coleta e fecha com a saída (ou sem sinal).
 */
async function avisar(fechadas: Fechamento[], agora: Date): Promise<void> {
    if (!AVISOS) return;
    for (const p of abertas.values()) {
        if (!p.alertaEm || p.id === undefined) continue;
        // UPA: alerta só no painel por ora — o grupo não foi autorizado para ela.
        if (LOCAIS_FROTA.find((h) => h.id === p.hospitalId)?.tipo === "upa") continue;
        const texto = textoAviso(dadosAviso(p), { tipo: "parada", minutos: duracaoMin(p, agora) });
        if (!p.avisoMsgId) {
            const id = await enviarReguladores(texto);
            if (!id) continue;
            p.avisoMsgId = id;
            await db.execute(sql`UPDATE frota_permanencias SET aviso_msg_id = ${id} WHERE id = ${p.id}`);
        } else if (textoPublicado.get(p.id) !== texto) {
            await editarReguladores(p.avisoMsgId, texto);
        }
        textoPublicado.set(p.id, texto);
    }
    for (const f of fechadas) {
        const p = f.permanencia;
        if (!p.avisoMsgId) continue;
        const estado = f.saida ? { tipo: "saiu" as const, saida: f.saida } : { tipo: "sem-sinal" as const };
        await editarReguladores(p.avisoMsgId, textoAviso(dadosAviso(p), estado));
        if (p.id !== undefined) textoPublicado.delete(p.id);
    }
}

export interface ParadaHistorico {
    id: number;
    chave: string;
    nome: string;
    tipo: string | null;
    base: string | null;
    hospitalId: string;
    entrada: string;
    /** Até onde a barra vai: saída, última posição vista, ou agora se ainda está lá. */
    fim: string;
    aberta: boolean;
    motivoFim: "saiu" | "sem-sinal" | null;
    minutos: number;
    alertou: boolean;
    /** Parada na própria base, que fica no hospital (sem alerta). */
    naBase: boolean;
    /** O que a equipe notificou no Acolhimentos para esta parada. */
    acolhimento: NotificacaoResumo | null;
    /** USA parada 40+ min sem notificação no Acolhimentos (que só cobre USA). */
    semNotificacao: boolean;
}

export interface NotificacaoResumo {
    chegada: string | null;
    passagem: string | null;
    liberada: string | null;
    /** Onde a faixa termina: liberação, ou até 2 h depois da chegada. */
    fim: string;
    minutos: number | null;
    maca: { inicio: string; fim: string | null } | null;
    motivos: string[];
}

function resumo(a: Acolhimento, agora: number): NotificacaoResumo {
    const maca = a.retencoes.find((r) => r.equipamento === "maca") ?? null;
    const j = janela(a, agora);
    return {
        chegada: a.chegada,
        passagem: a.passagem,
        liberada: a.liberada,
        fim: new Date(j ? j[1] : agora).toISOString(),
        minutos: a.totalS != null ? Math.round(a.totalS / 60) : null,
        maca: maca ? { inicio: maca.inicio, fim: maca.fim } : null,
        motivos: a.motivos,
    };
}

/** Paradas em hospital que tocam as últimas `horas` (as abertas sempre entram). */
export async function linhaDoTempo(horas: number): Promise<{
    ativo: boolean;
    desde: string;
    ate: string;
    alertaMin: number;
    hospitais: { id: string; nome: string; tipo: "hospital" | "upa" }[];
    paradas: ParadaHistorico[];
    acolhimentos: {
        ligado: boolean;
        erro: string | null;
        /** Notificações sem parada do GPS casada (viatura sem sinal, outro hospital…). */
        soltas: (NotificacaoResumo & { unidade: string; hospitalId: string })[];
    };
}> {
    const agora = new Date();
    const desde = new Date(agora.getTime() - horas * 3_600_000);
    const base = {
        ativo: Boolean(TOKEN),
        desde: desde.toISOString(),
        ate: agora.toISOString(),
        alertaMin: ALERTA_MIN,
        hospitais: LOCAIS_FROTA.map((h) => ({ id: h.id, nome: h.nome, tipo: h.tipo })),
    };
    const semCruzamento = { ligado: acolhimentosLigado(), erro: null, soltas: [] };
    if (!TOKEN) return { ...base, paradas: [], acolhimentos: semCruzamento };
    const linhas = await consultar(sql`
        SELECT id, chave, hospital_id, entrada, ultima_vez, saida, motivo_fim, alerta_em, na_base
        FROM frota_permanencias
        WHERE motivo_fim IS NULL OR COALESCE(saida, ultima_vez) >= ${desde.toISOString()}
        ORDER BY entrada`);
    const paradas = linhas.map((r): ParadaHistorico => {
        const entrada = new Date(r.entrada as string);
        const ultimaVez = new Date(r.ultima_vez as string);
        const aberta = r.motivo_fim == null;
        const minutos = aberta
            ? duracaoMin({ entrada, ultimaVez }, agora)
            : Math.max(0, Math.floor(((r.saida ? new Date(r.saida as string) : ultimaVez).getTime() - entrada.getTime()) / 60_000));
        const fim = new Date(entrada.getTime() + minutos * 60_000);
        const q = descreverChave(String(r.chave));
        return {
            id: Number(r.id),
            chave: String(r.chave),
            ...q,
            hospitalId: String(r.hospital_id),
            entrada: entrada.toISOString(),
            fim: fim.toISOString(),
            aberta,
            motivoFim: aberta ? null : (r.motivo_fim as "saiu" | "sem-sinal"),
            minutos,
            alertou: r.alerta_em != null,
            naBase: r.na_base === true,
            acolhimento: null,
            semNotificacao: false,
        };
    });

    if (!acolhimentosLigado()) return { ...base, paradas, acolhimentos: semCruzamento };
    try {
        // Quem chegou até 2 h antes da janela ainda pode estar dentro dela.
        const lidos = await buscarAcolhimentos(new Date(desde.getTime() - ABERTA_MAX_MS), agora);
        const { casadas, soltas } = cruzar(paradas, lidos, agora.getTime());
        // O Acolhimentos só registra hospital: parada em UPA nunca é "sem notificação".
        const upas = new Set(LOCAIS_FROTA.filter((h) => h.tipo === "upa").map((h) => h.id));
        for (const p of paradas) {
            const a = casadas.get(p.id);
            p.acolhimento = a ? resumo(a, agora.getTime()) : null;
            p.semNotificacao = !a && !p.naBase && !upas.has(p.hospitalId) && p.tipo === "USA" && p.minutos >= ALERTA_MIN;
        }
        return {
            ...base,
            paradas,
            acolhimentos: {
                ligado: true,
                erro: null,
                soltas: soltas
                    .filter((a) => a.hospital && janela(a, agora.getTime())![1] >= desde.getTime())
                    .map((a) => ({ ...resumo(a, agora.getTime()), unidade: a.unidade, hospitalId: a.hospital! })),
            },
        };
    } catch (e) {
        // Acolhimentos fora do ar não derruba a linha do tempo do GPS.
        return { ...base, paradas, acolhimentos: { ...semCruzamento, erro: (e as Error).message } };
    }
}

export async function initFrota(): Promise<void> {
    if (!TOKEN) {
        console.log("[frota] SAMUMAIS_TOKEN vazio — coletor desligado");
        return;
    }
    await criarTabelas();
    await carregar();
    void ciclo();
    setInterval(() => void ciclo(), COLETA_MS);
    console.log(`[frota] coletor ligado (${abertas.size} permanências abertas)`);
}

export function painelAtual(): PainelFrota {
    const agora = new Date();
    return montarPainel({
        ativo: Boolean(TOKEN),
        coletadoEm,
        vinculosEm,
        erro,
        catalogo: CATALOGO,
        desativadas: DESATIVADAS_ATE_SEGUNDA_ORDEM,
        hospitais: LOCAIS_FROTA,
        resolvidas: resolverPosicoes(posicoes, dispositivos, CATALOGO),
        dispositivos,
        abertas,
        agora,
    });
}
