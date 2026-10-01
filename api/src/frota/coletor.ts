// ═══════════════════════════════════════════════════════════════
// Coletor da frota: a cada 2 min lê as posições do SAMU+, atualiza as
// permanências nos hospitais e UPAs e grava abertura/fechamento no banco.
// A cada 30 min reaprende os estacionamentos com as paradas dos últimos 30 dias.
// Avisos no grupo da frota (TELEGRAM_FROTA_CHAT_ID): parada de 40 min,
// queda de sinal, bateria, sinal instável e o resumo da troca de plantão
// (regras em sinal.ts). Todo aviso — enviado ou silenciado — fica em
// frota_alertas (GET /frota/alertas).
//
// Estado em memória (um processo só, como o resto da API). O banco guarda
// o que precisa sobreviver a um restart: as permanências (histórico da
// retenção de maca) e o último vínculo equipe↔unidade.
// Sem SAMUMAIS_TOKEN no ambiente: coletor desligado, GET /frota diz isso.
// ═══════════════════════════════════════════════════════════════
import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { CATALOGO, DESATIVADAS_ATE_SEGUNDA_ORDEM, numeroNoLimite } from "./catalogo.js";
import { LOCAIS_FROTA, type HospitalFrota, type PontoAprendido } from "./hospitais.js";
import {
    ALERTA_MIN, APRENDE_RAIO_M, aprenderPontos, avancarPermanencias, distanciaM, duracaoMin, ehMoto,
    type Evidencia, type Fechamento, type Permanencia,
} from "./regras.js";
import { textoAviso, textoCobranca, type DadosAviso, type EstadoCobranca } from "./aviso.js";
import { editarChat, enviarChat, frotaChatId, reguladoresChatId, salvadorChatId } from "../lib/telegram.js";
import { medicosPorBase } from "./plantoes.js";
import {
    avancarQuedas, bateriaBaixa, instaveisAgora, plantaoDe, ranking, resumoDevido,
    textoBateria, textoFimQueda, textoFrota, textoInstavel, textoQueda, textoResumo, textoSurto,
    INSTAVEL_JANELA_MIN, type Queda, type QuedaRecente,
} from "./sinal.js";
import { ABERTA_MAX_MS, acolhimentosLigado, buscarAcolhimentos, cruzar, janela, type Acolhimento } from "./acolhimentos.js";
import { buscarDispositivos, buscarPosicoes, type DispositivoSamu, type PosicaoSamu } from "./samumais.js";
import { leiturasParaPermanencia, montarPainel, resolverPosicoes, type PainelFrota } from "./painel.js";
import {
    ErroDesativacao, MOTIVOS, ORIGENS, POSTOS, textoDesativacao,
    type Desativacao, type Motivo, type Origem, type Posto, esquemaDesativar,
} from "./desativacoes.js";
import type { z } from "zod";

const TOKEN = process.env.SAMUMAIS_TOKEN || "";
const AVISOS = (process.env.FROTA_AVISOS_TELEGRAM ?? "1") !== "0";
const COLETA_MS = 2 * 60_000;
/** A página de status tem ~430 KB: vínculo a cada 10 min, ou antes se aparecer equipe nova. */
const VINCULOS_MS = 10 * 60_000;
const VINCULOS_MIN_MS = 2 * 60_000;
const APRENDE_MS = 30 * 60_000;

let coletadoEm: Date | null = null;
let vinculosEm: Date | null = null;
let tentouVinculosEm = 0;
let erro: string | null = null;
let posicoes: PosicaoSamu[] = [];
let dispositivos: DispositivoSamu[] = [];
let abertas = new Map<string, Permanencia>();
/** Hospitais e UPAs com os estacionamentos aprendidos. */
let locais: readonly HospitalFrota[] = LOCAIS_FROTA;
let aprendidoEm = 0;
let rodando = false;

// ── Diagnóstico (GET /frota/diagnostico) ────────────────────────
// Os logs do container somem a cada deploy; isto fica em frota_estado.
// Erro repetido (SAMU+ fora do ar a cada 2 min) vira uma linha com contagem.
interface ErroFrota { onde: string; msg: string; desde: string; ate: string; vezes: number }
interface MudancaPonto { em: string; local: string; acao: "aprendeu" | "esqueceu"; lat: number; lng: number; viaturas: number }
const ERROS_MAX = 30;
const MUDANCAS_MAX = 100;
let erros: ErroFrota[] = [];
let aprendizado: {
    em: string | null;
    evidencias: number;
    /** Pontos ativos por local — restaurados no boot, para o deploy não "reaprender" tudo. */
    pontos: Record<string, PontoAprendido[]>;
    mudancas: MudancaPonto[];
} = { em: null, evidencias: 0, pontos: {}, mudancas: [] };

const comPontos = (pontos: Record<string, PontoAprendido[]>) =>
    LOCAIS_FROTA.map((h) => (pontos[h.id]?.length ? { ...h, pontos: pontos[h.id] } : h));
/** Último texto publicado por parada — só edita a mensagem quando muda. */
const textoPublicado = new Map<number, string>();
/** Cobrança da denúncia no grupo SAMU - Salvador, por parada (volta do banco no boot). */
const cobrancas = new Map<number, { chat: string; msgId: number; estado: EstadoCobranca }>();

// ── Quedas de sinal, bateria, resumo (sinal.ts) ─────────────────
// Abertas e recentes voltam do banco no boot: o deploy não repete aviso.
let quedas = new Map<string, Queda>();
let quedasRecentes: QuedaRecente[] = [];
const textoQuedaPublicado = new Map<number, string>();
const instavelEm = new Map<string, Date>();
/** `${chave}|${plantão}`: um aviso de bateria por viatura por plantão. */
const bateriaAvisada = new Set<string>();
const resumosFeitos = new Set<string>();

/** Desativações informadas no painel, ativas, por código (desativacoes.ts). */
let desativacoes = new Map<string, Desativacao>();
/** Até segunda ordem (catálogo) + informadas no painel. */
const desativadasAgora = (): ReadonlySet<string> => new Set([...DESATIVADAS_ATE_SEGUNDA_ORDEM, ...desativacoes.keys()]);

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
    await db.execute(sql`ALTER TABLE frota_permanencias ADD COLUMN IF NOT EXISTS aviso_chat varchar(40)`);
    await db.execute(sql`
        ALTER TABLE frota_permanencias
            ADD COLUMN IF NOT EXISTS cobranca_msg_id bigint,
            ADD COLUMN IF NOT EXISTS cobranca_chat varchar(40),
            ADD COLUMN IF NOT EXISTS cobranca_estado varchar(20)`);
    // Última posição confirmada e onde o GPS ficou parado mais tempo (aprendizado).
    await db.execute(sql`
        ALTER TABLE frota_permanencias
            ADD COLUMN IF NOT EXISTS lat double precision,
            ADD COLUMN IF NOT EXISTS lng double precision,
            ADD COLUMN IF NOT EXISTS estavel_lat double precision,
            ADD COLUMN IF NOT EXISTS estavel_lng double precision,
            ADD COLUMN IF NOT EXISTS estavel_n integer NOT NULL DEFAULT 0`);
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS frota_permanencias_abertas_idx
        ON frota_permanencias (chave) WHERE motivo_fim IS NULL`);
    // Registro de todo aviso de sinal/bateria/resumo — o que foi ao grupo e o
    // que foi silenciado (reincidência, surto), para calibrar os limites.
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_alertas (
            id          serial PRIMARY KEY,
            tipo        varchar(20)  NOT NULL,
            chave       varchar(60)  NOT NULL,
            inicio      timestamptz  NOT NULL,
            volta       timestamptz,
            fechado_em  timestamptz,
            motivo_fim  varchar(20),
            avisado     boolean      NOT NULL DEFAULT false,
            silenciado  varchar(20),
            chat_id     varchar(40),
            msg_id      bigint,
            detalhe     jsonb,
            criado_em   timestamptz  NOT NULL DEFAULT now()
        )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS frota_alertas_criado_idx ON frota_alertas (criado_em)`);
    // Desativação informada no painel (rádio, chefe, enfermagem) — uma ativa por viatura.
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_desativacoes (
            id             serial PRIMARY KEY,
            codigo         varchar(10)  NOT NULL,
            motivos        jsonb        NOT NULL,
            observacao     text,
            informado_por  varchar(80)  NOT NULL,
            posto          varchar(20)  NOT NULL,
            desde          timestamptz  NOT NULL DEFAULT now(),
            reativada_em   timestamptz,
            reativada_por  varchar(80)
        )`);
    await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS frota_desativacoes_ativa_idx
        ON frota_desativacoes (codigo) WHERE reativada_em IS NULL`);
    // Onde foi informada (frota | huddle | quadro). Nula = linha antiga = "frota".
    await db.execute(sql`ALTER TABLE frota_desativacoes ADD COLUMN IF NOT EXISTS origem varchar(10)`);
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_estado (
            chave         varchar(40) PRIMARY KEY,
            valor         jsonb       NOT NULL,
            atualizado_em timestamptz NOT NULL DEFAULT now()
        )`);
}

async function salvarEstado(chave: string, valor: unknown): Promise<void> {
    await db.execute(sql`
        INSERT INTO frota_estado (chave, valor, atualizado_em)
        VALUES (${chave}, ${JSON.stringify(valor)}::jsonb, now())
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`);
}

async function registrarErro(onde: string, e: unknown): Promise<void> {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error(`[frota] ${onde}:`, msg);
    const agora = new Date().toISOString();
    const [ultimo] = erros;
    if (ultimo && ultimo.onde === onde && ultimo.msg === msg) {
        ultimo.ate = agora;
        ultimo.vezes++;
    } else {
        erros = [{ onde, msg, desde: agora, ate: agora, vezes: 1 }, ...erros].slice(0, ERROS_MAX);
    }
    await salvarEstado("erros", erros).catch((x) => console.error("[frota] salvar erros:", (x as Error).message));
}

async function carregar(): Promise<void> {
    for (const r of await consultar(sql`
        SELECT id, chave, hospital_id, entrada, ultima_vez, alerta_em, aviso_msg_id, aviso_chat, na_base,
               lat, lng, estavel_lat, estavel_lng, estavel_n, cobranca_msg_id, cobranca_chat, cobranca_estado
        FROM frota_permanencias WHERE motivo_fim IS NULL`)) {
        if (r.cobranca_msg_id != null) {
            cobrancas.set(Number(r.id), {
                chat: String(r.cobranca_chat),
                msgId: Number(r.cobranca_msg_id),
                estado: r.cobranca_estado as EstadoCobranca,
            });
        }
        abertas.set(String(r.chave), {
            id: Number(r.id),
            chave: String(r.chave),
            hospitalId: String(r.hospital_id),
            entrada: new Date(r.entrada as string),
            ultimaVez: new Date(r.ultima_vez as string),
            alertaEm: r.alerta_em ? new Date(r.alerta_em as string) : null,
            avisoMsgId: r.aviso_msg_id != null ? Number(r.aviso_msg_id) : null,
            avisoChat: r.aviso_chat != null ? String(r.aviso_chat) : null,
            naBase: r.na_base === true,
            lat: r.lat != null ? Number(r.lat) : null,
            lng: r.lng != null ? Number(r.lng) : null,
            estavel:
                r.estavel_lat != null && r.estavel_lng != null
                    ? { lat: Number(r.estavel_lat), lng: Number(r.estavel_lng), n: Number(r.estavel_n) }
                    : null,
        });
    }
    for (const r of await consultar(sql`SELECT chave, valor FROM frota_estado WHERE chave IN ('erros', 'aprendizado')`)) {
        if (r.chave === "erros") erros = r.valor as ErroFrota[];
        else aprendizado = { ...aprendizado, ...(r.valor as Partial<typeof aprendizado>) };
    }
    locais = comPontos(aprendizado.pontos);
    await carregarAlertas();
    desativacoes = new Map(
        (await consultar(sql`SELECT * FROM frota_desativacoes WHERE reativada_em IS NULL`)).map((r) => [String(r.codigo), desativacaoDe(r)]),
    );
    const [v] = await consultar(sql`SELECT valor, atualizado_em FROM frota_estado WHERE chave = 'dispositivos'`);
    if (v) {
        dispositivos = v.valor as DispositivoSamu[];
        vinculosEm = new Date(v.atualizado_em as string);
    }
}

async function carregarAlertas(): Promise<void> {
    for (const r of await consultar(sql`
        SELECT id, chave, inicio, criado_em, avisado, silenciado, chat_id, msg_id
        FROM frota_alertas WHERE tipo = 'queda' AND fechado_em IS NULL`)) {
        quedas.set(String(r.chave), {
            id: Number(r.id),
            chave: String(r.chave),
            desde: new Date(r.inicio as string),
            abertaEm: new Date(r.criado_em as string),
            // Não foi por falta do chat: vai agora.
            avisar: r.avisado === true || r.silenciado == null,
            silenciada: (r.silenciado as Queda["silenciada"]) ?? null,
            msgId: r.msg_id != null ? Number(r.msg_id) : null,
            chat: r.chat_id != null ? String(r.chat_id) : null,
        });
    }
    quedasRecentes = (
        await consultar(sql`
            SELECT chave, inicio, volta, fechado_em FROM frota_alertas
            WHERE tipo = 'queda' AND fechado_em > now() - interval '3 hours'`)
    ).map((r) => ({
        chave: String(r.chave),
        desde: new Date(r.inicio as string),
        volta: r.volta ? new Date(r.volta as string) : null,
        fechadaEm: new Date(r.fechado_em as string),
    }));
    for (const r of await consultar(sql`
        SELECT tipo, chave, criado_em, detalhe->>'plantao' AS plantao FROM frota_alertas
        WHERE tipo IN ('instavel', 'bateria', 'resumo') AND criado_em > now() - interval '13 hours'`)) {
        if (r.tipo === "instavel") instavelEm.set(String(r.chave), new Date(r.criado_em as string));
        else if (r.tipo === "bateria") bateriaAvisada.add(`${r.chave}|${r.plantao}`);
        else resumosFeitos.add(String(r.chave));
    }
}

async function atualizarVinculos(): Promise<void> {
    tentouVinculosEm = Date.now();
    const lidos = await buscarDispositivos();
    if (!lidos.length) throw new Error("status-unidades: nenhuma unidade");
    dispositivos = lidos;
    vinculosEm = new Date();
    await salvarEstado("dispositivos", lidos);
}

/** Evidência: onde o GPS parou em cada parada de 10 min ou mais (fora da base), 30 dias. */
async function aprender(): Promise<void> {
    aprendidoEm = Date.now();
    const evidencias: Evidencia[] = (
        await consultar(sql`
            SELECT hospital_id, chave, estavel_lat, estavel_lng,
                   to_char(entrada AT TIME ZONE 'America/Bahia', 'YYYY-MM-DD') AS dia
            FROM frota_permanencias
            WHERE NOT na_base AND estavel_n >= 2 AND estavel_lat IS NOT NULL
              AND ultima_vez - entrada >= interval '10 minutes'
              AND entrada > now() - interval '30 days'`)
    ).map((r) => ({
        hospitalId: String(r.hospital_id),
        chave: String(r.chave),
        lat: Number(r.estavel_lat),
        lng: Number(r.estavel_lng),
        dia: String(r.dia),
    }));
    const pontos = Object.fromEntries(aprenderPontos(evidencias, LOCAIS_FROTA));
    const antes = locais;
    locais = comPontos(pontos);

    // Só registra o que mudou: um ponto a menos de 40 m do anterior é o mesmo.
    const em = new Date().toISOString();
    const mudancas: MudancaPonto[] = [];
    const difere = (de: readonly HospitalFrota[], para: readonly HospitalFrota[], acao: MudancaPonto["acao"]) => {
        for (const h of de) {
            const outros = para.find((x) => x.id === h.id)?.pontos ?? [];
            for (const p of h.pontos ?? []) {
                if (!outros.some((o) => distanciaM(o, p) <= APRENDE_RAIO_M)) mudancas.push({ em, local: h.id, acao, ...p });
            }
        }
    };
    difere(locais, antes, "aprendeu");
    difere(antes, locais, "esqueceu");
    for (const m of mudancas) console.log(`[frota] ${m.acao} estacionamento: ${m.local} (${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}; ${m.viaturas} viaturas)`);
    aprendizado = { em, evidencias: evidencias.length, pontos, mudancas: [...mudancas, ...aprendizado.mudancas].slice(0, MUDANCAS_MAX) };
    await salvarEstado("aprendizado", aprendizado);
}

async function ciclo(): Promise<void> {
    if (rodando) return;
    rodando = true;
    try {
        if (Date.now() - aprendidoEm > APRENDE_MS) {
            await aprender().catch((e) => registrarErro("aprender", e));
        }
        posicoes = await buscarPosicoes(TOKEN);

        const conhecidas = new Set(dispositivos.map((d) => d.equipe));
        const equipeNova = posicoes.some((p) => !conhecidas.has(p.idEquipe));
        const velho = !vinculosEm || Date.now() - vinculosEm.getTime() > VINCULOS_MS;
        if ((velho || equipeNova) && Date.now() - tentouVinculosEm > VINCULOS_MIN_MS) {
            // Página fora do ar não para a coleta: segue com o último vínculo.
            await atualizarVinculos().catch((e) => registrarErro("vínculos", e));
        }

        const agora = new Date();
        const resolvidas = resolverPosicoes(posicoes, dispositivos, CATALOGO);
        // Desativada no painel com parada aberta: a parada fecha agora (e o aviso dela).
        const desativadas = desativadasAgora();
        const r = avancarPermanencias(
            new Map([...abertas].filter(([chave]) => !desativadas.has(chave))),
            leiturasParaPermanencia(resolvidas, desativadas, CATALOGO),
            locais,
            agora,
        );
        for (const p of abertas.values()) {
            if (desativadas.has(p.chave)) r.fechadas.push({ permanencia: p, saida: null, motivo: "desativada" });
        }
        for (const p of r.novas) {
            const [linha] = await consultar(sql`
                INSERT INTO frota_permanencias (chave, hospital_id, entrada, ultima_vez, na_base, lat, lng)
                VALUES (${p.chave}, ${p.hospitalId}, ${p.entrada.toISOString()}, ${p.ultimaVez.toISOString()}, ${p.naBase},
                        ${p.lat ?? null}, ${p.lng ?? null})
                RETURNING id`);
            p.id = Number(linha.id);
        }
        for (const p of r.alteradas) {
            if (p.id === undefined) continue;
            await db.execute(sql`
                UPDATE frota_permanencias
                SET ultima_vez = ${p.ultimaVez.toISOString()}, alerta_em = ${p.alertaEm?.toISOString() ?? null},
                    lat = ${p.lat ?? null}, lng = ${p.lng ?? null},
                    estavel_lat = ${p.estavel?.lat ?? null}, estavel_lng = ${p.estavel?.lng ?? null},
                    estavel_n = ${p.estavel?.n ?? 0}
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
        await avisar(r.fechadas, agora).catch((e) => registrarErro("aviso", e));
        await cobrar(r.fechadas, agora).catch((e) => registrarErro("cobrança", e));
        await avisarSinal(agora).catch((e) => registrarErro("aviso de sinal", e));
    } catch (e) {
        erro = (e as Error).message;
        await registrarErro("coleta", e);
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
    return {
        nome: q.nome, tipo: q.tipo, hospitalNome: h?.nome ?? p.hospitalId,
        entrada: p.entrada, ultimaVez: p.ultimaVez, avisoEm: p.alertaEm,
    };
}

/**
 * Manda ao grupo da frota. Sem chat configurado ou com os avisos desligados,
 * não manda (o registro em frota_alertas fica com avisado = false).
 */
async function mandar(html: string, respondeA?: number | null, chat = frotaChatId()): Promise<{ chat: string; id: number } | null> {
    if (!AVISOS || !chat) return null;
    const id = await enviarChat(chat, html, respondeA);
    if (!id) {
        await registrarErro("aviso Telegram", "envio falhou — detalhe em [telegram] no log");
        return null;
    }
    return { chat, id };
}

/**
 * Uma mensagem por parada no grupo da frota: sai quando a parada passa de
 * 40 min e é editada a cada coleta. Na saída, a mensagem é editada e
 * RESPONDIDA ("saiu às…") — edição não notifica ninguém, resposta sim.
 */
async function avisar(fechadas: Fechamento[], agora: Date): Promise<void> {
    if (!AVISOS) return;
    for (const p of abertas.values()) {
        if (!p.alertaEm || p.id === undefined) continue;
        const texto = textoAviso(dadosAviso(p), { tipo: "parada", minutos: duracaoMin(p, agora) }, agora);
        if (!p.avisoMsgId) {
            const m = await mandar(texto);
            if (!m) continue;
            p.avisoMsgId = m.id;
            p.avisoChat = m.chat;
            await db.execute(sql`UPDATE frota_permanencias SET aviso_msg_id = ${m.id}, aviso_chat = ${m.chat} WHERE id = ${p.id}`);
        } else if (textoPublicado.get(p.id) !== texto) {
            // Falhou: não marca como publicado, a próxima coleta tenta de novo.
            if (!(await editarChat(p.avisoChat ?? reguladoresChatId(), p.avisoMsgId, texto))) {
                await registrarErro("aviso Telegram", "edição falhou");
                continue;
            }
        }
        textoPublicado.set(p.id, texto);
    }
    for (const f of fechadas) {
        const p = f.permanencia;
        if (!p.avisoMsgId) continue;
        const chat = p.avisoChat ?? reguladoresChatId();
        const estado =
            f.motivo === "desativada"
                ? { tipo: "desativada" as const, em: agora }
                : f.saida
                  ? { tipo: "saiu" as const, saida: f.saida }
                  : { tipo: "sem-sinal" as const };
        if (!(await editarChat(chat, p.avisoMsgId, textoAviso(dadosAviso(p), estado, agora)))) {
            await registrarErro("aviso Telegram", "edição da saída falhou");
        }
        // A saída responde o aviso dos 40 min (sem sinal fica só na edição: a queda avisa).
        if (f.saida && !(await enviarChat(chat, textoAviso(dadosAviso(p), estado), p.avisoMsgId))) {
            await registrarErro("aviso Telegram", "resposta da saída falhou");
        }
        if (p.id !== undefined) textoPublicado.delete(p.id);
    }
}

async function registrarAlerta(a: {
    tipo: "queda" | "instavel" | "surto" | "bateria" | "resumo";
    chave: string;
    inicio: Date;
    silenciado?: string | null;
    detalhe?: Record<string, unknown>;
}): Promise<number> {
    const [l] = await consultar(sql`
        INSERT INTO frota_alertas (tipo, chave, inicio, silenciado, detalhe)
        VALUES (${a.tipo}, ${a.chave}, ${a.inicio.toISOString()}, ${a.silenciado ?? null},
                ${a.detalhe ? JSON.stringify(a.detalhe) : null}::jsonb)
        RETURNING id`);
    console.log(`[frota-alerta] ${a.tipo} ${a.chave}${a.silenciado ? ` (silenciado: ${a.silenciado})` : ""}${a.detalhe ? ` ${JSON.stringify(a.detalhe)}` : ""}`);
    return Number(l.id);
}

async function marcarAvisado(id: number, m: { chat: string; id: number } | null): Promise<void> {
    if (m) await db.execute(sql`UPDATE frota_alertas SET avisado = true, chat_id = ${m.chat}, msg_id = ${m.id} WHERE id = ${id}`);
}

/**
 * Quedas de sinal (10 min sem posição), sinal instável, bateria abaixo de
 * 20% e o resumo da troca de plantão — regras em sinal.ts. Queda: uma
 * mensagem, editada a cada coleta, e respondida quando a viatura volta.
 */
async function avisarSinal(agora: Date): Promise<void> {
    let viaturas = painelAtual(agora).viaturas.filter((v) => !v.foraDoCatalogo);
    const r = avancarQuedas(quedas, quedasRecentes, viaturas, instavelEm, agora);
    if (r.novas.length && Date.now() - tentouVinculosEm > VINCULOS_MIN_MS) {
        // A causa (sem internet, bateria) vem da página de status: lê de novo.
        await atualizarVinculos().catch((e) => registrarErro("vínculos", e));
        viaturas = painelAtual(agora).viaturas.filter((v) => !v.foraDoCatalogo);
    }
    const porChave = new Map(viaturas.map((v) => [v.chave, v]));

    if (r.surto) {
        const id = await registrarAlerta({ tipo: "surto", chave: "*", inicio: agora, detalhe: { quedas: r.surto } });
        await marcarAvisado(id, await mandar(textoSurto(r.surto, agora)));
    }
    for (const q of r.novas) {
        q.id = await registrarAlerta({
            tipo: "queda", chave: q.chave, inicio: q.desde, silenciado: q.silenciada,
            detalhe: { conexao: porChave.get(q.chave)?.conexao ?? null, evento: porChave.get(q.chave)?.evento ?? null, bateria: porChave.get(q.chave)?.bateria ?? null },
        });
    }
    for (const q of r.promovidas) {
        console.log(`[frota-alerta] queda ${q.chave} reincidente passou de 30 min — vai ao grupo`);
    }
    for (const f of r.fechadas) {
        const q = f.queda;
        const minutos = Math.round(((f.volta ?? agora).getTime() - q.desde.getTime()) / 60_000);
        console.log(`[frota-alerta] queda ${q.chave} fechou: ${f.motivo} (${minutos} min)`);
        if (q.id !== undefined) {
            await db.execute(sql`
                UPDATE frota_alertas SET fechado_em = ${agora.toISOString()}, volta = ${f.volta?.toISOString() ?? null},
                    motivo_fim = ${f.motivo}
                WHERE id = ${q.id}`);
            textoQuedaPublicado.delete(q.id);
        }
        quedasRecentes.push({ chave: q.chave, desde: q.desde, volta: f.volta, fechadaEm: agora });
        const v = porChave.get(q.chave);
        if (!q.msgId || !q.chat || !v) continue;
        const t = textoFimQueda(v, f, agora);
        if (!(await editarChat(q.chat, q.msgId, t.edicao))) await registrarErro("aviso Telegram", "edição da queda falhou");
        if (t.resposta && !(await enviarChat(q.chat, t.resposta, q.msgId))) await registrarErro("aviso Telegram", "resposta da volta falhou");
    }
    quedas = r.abertas;
    quedasRecentes = quedasRecentes.filter((q) => agora.getTime() - q.fechadaEm.getTime() <= INSTAVEL_JANELA_MIN * 60_000);

    // Abertas: manda a que ainda não foi (nova, promovida, ou sem chat antes); edita as outras.
    for (const q of quedas.values()) {
        const v = porChave.get(q.chave);
        if (!q.avisar || q.id === undefined || !v) continue;
        const texto = textoQueda(v, q, agora);
        if (!q.msgId) {
            const m = await mandar(texto);
            if (!m) continue;
            q.msgId = m.id;
            q.chat = m.chat;
            await marcarAvisado(q.id, m);
        } else if (textoQuedaPublicado.get(q.id) !== texto && !(await editarChat(q.chat!, q.msgId, texto))) {
            await registrarErro("aviso Telegram", "edição da queda falhou");
            continue;
        }
        textoQuedaPublicado.set(q.id, texto);
    }

    for (const i of r.instaveis) {
        const v = porChave.get(i.chave);
        if (!v) continue;
        instavelEm.set(i.chave, agora);
        const id = await registrarAlerta({ tipo: "instavel", chave: i.chave, inicio: agora, detalhe: { quedas: i.quedas, minutos: i.minutos } });
        await marcarAvisado(id, await mandar(textoInstavel(v, i)));
    }

    const plantao = plantaoDe(agora);
    for (const v of viaturas) {
        if (!bateriaBaixa(v, agora) || bateriaAvisada.has(`${v.chave}|${plantao}`)) continue;
        bateriaAvisada.add(`${v.chave}|${plantao}`);
        const id = await registrarAlerta({
            tipo: "bateria", chave: v.chave, inicio: new Date(v.bateriaEm!),
            detalhe: { bateria: v.bateria, antes: v.bateriaAntes, plantao },
        });
        await marcarAvisado(id, await mandar(textoBateria(v, agora)));
    }

    const slot = resumoDevido(agora);
    if (slot && !resumosFeitos.has(slot)) {
        resumosFeitos.add(slot);
        const id = await registrarAlerta({ tipo: "resumo", chave: slot, inicio: agora });
        await marcarAvisado(id, await mandar(textoResumo(viaturas, instaveisAgora(quedasRecentes, quedas, agora), agora)));
    }
}

/** Resposta do /frota: problemas agudos por gravidade (sinal.ts, `ranking`). */
export function textoFrotaAgora(): string {
    const agora = new Date();
    const viaturas = painelAtual(agora).viaturas.filter((v) => !v.foraDoCatalogo);
    return textoFrota(ranking(viaturas, instaveisAgora(quedasRecentes, quedas, agora), agora), agora);
}

/** Registro dos avisos de sinal/bateria/resumo das últimas `horas` (para calibrar). */
export async function alertasRecentes(horas: number) {
    const linhas = await consultar(sql`
        SELECT id, tipo, chave, inicio, volta, fechado_em, motivo_fim, avisado, silenciado, detalhe, criado_em
        FROM frota_alertas
        WHERE criado_em > now() - ${horas} * interval '1 hour'
        ORDER BY id DESC
        LIMIT 1000`);
    const contagem: Record<string, { total: number; avisados: number; silenciados: Record<string, number> }> = {};
    for (const l of linhas) {
        const c = (contagem[String(l.tipo)] ??= { total: 0, avisados: 0, silenciados: {} });
        c.total++;
        if (l.avisado === true) c.avisados++;
        if (l.silenciado) c.silenciados[String(l.silenciado)] = (c.silenciados[String(l.silenciado)] ?? 0) + 1;
    }
    return { horas, chat: Boolean(frotaChatId()), contagem, quedasAbertas: quedas.size, alertas: linhas };
}

/**
 * USA presa 40+ min em hospital sem notificação no Acolhimentos: o grupo
 * SAMU - Salvador recebe uma mensagem chamando o médico da viatura (nome do
 * Plantões) para registrar a retenção no app. Uma por parada; editada para ✅
 * quando a notificação aparece, ou para ⚠️ se a viatura sai sem registro.
 * Acolhimentos fora do ar: ninguém é cobrado sem a prova de que não registrou.
 */
async function cobrar(fechadas: Fechamento[], agora: Date): Promise<void> {
    const chat = salvadorChatId();
    if (!AVISOS || !chat || !acolhimentosLigado()) return;
    // O Acolhimentos casa só hospital (ver linhaDoTempo): UPA nunca é cobrada.
    const upas = new Set(LOCAIS_FROTA.filter((h) => h.tipo === "upa").map((h) => h.id));
    const novas = [...abertas.values()].filter(
        (p) => p.id !== undefined && p.alertaEm && !p.naBase && !upas.has(p.hospitalId) &&
            descreverChave(p.chave).tipo === "USA" && !cobrancas.has(p.id),
    );
    const pendentes = [
        ...[...abertas.values()].map((p) => ({ p, saida: undefined as Date | null | undefined })),
        ...fechadas.map((f) => ({ p: f.permanencia, saida: f.saida })),
    ].filter(({ p }) => p.id !== undefined && cobrancas.get(p.id)?.estado === "aberta");
    if (!novas.length && !pendentes.length) return;

    const todas = [...novas.map((p) => ({ p, saida: undefined as Date | null | undefined })), ...pendentes];
    const desde = new Date(Math.min(...todas.map(({ p }) => p.entrada.getTime())) - ABERTA_MAX_MS);
    const { casadas } = cruzar(
        todas.map(({ p, saida }) => ({
            id: p.id!, chave: p.chave, hospitalId: p.hospitalId, entrada: p.entrada.toISOString(),
            fim: (saida === undefined ? agora : saida ?? p.ultimaVez).toISOString(),
        })),
        await buscarAcolhimentos(desde, agora),
        agora.getTime(),
    );

    const salvar = (id: number, c: { chat: string; msgId: number; estado: EstadoCobranca }) => {
        cobrancas.set(id, c);
        return db.execute(sql`
            UPDATE frota_permanencias
            SET cobranca_msg_id = ${c.msgId}, cobranca_chat = ${c.chat}, cobranca_estado = ${c.estado}
            WHERE id = ${id}`);
    };
    for (const p of novas) {
        if (casadas.has(p.id!)) continue;
        // Plantões fora do ar: a cobrança sai assim mesmo, chamando "médico(a) da SM01".
        const medico = (await medicosPorBase().catch(() => new Map<string, string>())).get(p.chave) ?? null;
        const id = await enviarChat(chat, textoCobranca(dadosAviso(p), medico, "aberta", agora));
        if (!id) {
            await registrarErro("cobrança Telegram", "envio falhou — detalhe em [telegram] no log");
            continue;
        }
        await salvar(p.id!, { chat, msgId: id, estado: "aberta" });
    }
    for (const { p, saida } of pendentes) {
        const c = cobrancas.get(p.id!)!;
        const estado: EstadoCobranca | null = casadas.has(p.id!) ? "registrada" : saida ? "saiu-sem-registro" : null;
        if (!estado) continue;
        if (!(await editarChat(c.chat, c.msgId, textoCobranca(dadosAviso(p), null, estado, saida ?? agora)))) {
            await registrarErro("cobrança Telegram", "edição falhou");
            continue;
        }
        await salvar(p.id!, { ...c, estado });
    }
    for (const f of fechadas) if (f.permanencia.id !== undefined) cobrancas.delete(f.permanencia.id);
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
    motivoFim: "saiu" | "sem-sinal" | "desativada" | null;
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
    // Numeral acima de 74: dado lixo (catalogo.ts, NUMERO_MAX). "Equipe N" não é numeral de viatura.
    const lixo = (r: Linha) => !String(r.chave).startsWith("equipe:") && !numeroNoLimite(descreverChave(String(r.chave)).nome);
    const paradas = linhas.filter((r) => !lixo(r)).map((r): ParadaHistorico => {
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
            motivoFim: aberta ? null : (r.motivo_fim as ParadaHistorico["motivoFim"]),
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

// ── Desativação informada no painel (desativacoes.ts) ───────────

function desativacaoDe(r: Linha): Desativacao {
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    return {
        id: Number(r.id),
        codigo: String(r.codigo),
        motivos: (r.motivos as Motivo[]) ?? [],
        observacao: r.observacao != null ? String(r.observacao) : null,
        informadoPor: String(r.informado_por),
        posto: String(r.posto) as Posto,
        origem: r.origem != null ? (String(r.origem) as Origem) : "frota",
        desde: iso(r.desde)!,
        reativadaEm: iso(r.reativada_em),
        reativadaPor: r.reativada_por != null ? String(r.reativada_por) : null,
    };
}

/** Avisa o grupo da frota: é por ele que todos sabem por que os avisos da viatura pararam (ou voltaram). */
async function avisarDesativacao(d: Desativacao): Promise<void> {
    const tipo = CATALOGO.find((c) => c.codigo === d.codigo)?.tipo ?? null;
    await mandar(textoDesativacao(d, tipo)).catch((e) => registrarErro("aviso Telegram", e));
}

export async function desativarViatura(dados: z.infer<typeof esquemaDesativar>): Promise<Desativacao> {
    if (!TOKEN) throw new ErroDesativacao(503, "Frota desligada neste servidor");
    const c = CATALOGO.find((v) => v.codigo === dados.codigo);
    if (!c) throw new ErroDesativacao(400, `${dados.codigo} não está no catálogo da frota`);
    if (DESATIVADAS_ATE_SEGUNDA_ORDEM.has(c.codigo)) throw new ErroDesativacao(409, `${c.codigo} já está desativada até segunda ordem`);
    if (desativacoes.has(c.codigo)) throw new ErroDesativacao(409, `${c.codigo} já está desativada — reative antes de informar de novo`);
    let linha: Linha | undefined;
    try {
        [linha] = await consultar(sql`
            INSERT INTO frota_desativacoes (codigo, motivos, observacao, informado_por, posto, origem)
            VALUES (${c.codigo}, ${JSON.stringify(dados.motivos)}::jsonb, ${dados.observacao || null}, ${dados.informadoPor}, ${dados.posto}, ${dados.origem})
            RETURNING *`);
    } catch (e) {
        // Índice único parcial: dois cliques ao mesmo tempo.
        if (/frota_desativacoes_ativa_idx|duplicate key/.test(String((e as Error).message))) {
            throw new ErroDesativacao(409, `${c.codigo} já está desativada`);
        }
        throw e;
    }
    const d = desativacaoDe(linha!);
    desativacoes.set(d.codigo, d);
    console.log(`[frota] ${d.codigo} desativada por ${d.informadoPor} (${d.posto}, ${d.origem}): ${d.motivos.join(",")}`);
    await avisarDesativacao(d);
    return d;
}

export async function reativarViatura(id: number, reativadaPor: string): Promise<Desativacao> {
    if (!TOKEN) throw new ErroDesativacao(503, "Frota desligada neste servidor");
    const [linha] = await consultar(sql`
        UPDATE frota_desativacoes SET reativada_em = now(), reativada_por = ${reativadaPor}
        WHERE id = ${id} AND reativada_em IS NULL
        RETURNING *`);
    if (!linha) throw new ErroDesativacao(404, "Desativação não encontrada ou já reativada");
    const d = desativacaoDe(linha);
    desativacoes.delete(d.codigo);
    console.log(`[frota] ${d.codigo} reativada por ${reativadaPor}`);
    await avisarDesativacao(d);
    return d;
}

/**
 * Ativas e as que começaram ou terminaram nas últimas `horas`. É o que o
 * Huddle do SAMU lê (rede Docker, sem o portão) para "fora de operação".
 */
export async function listarDesativacoes(horas: number) {
    if (!TOKEN) return { ativo: false, motivos: MOTIVOS, postos: POSTOS, origens: ORIGENS, desativacoes: [] };
    const linhas = await consultar(sql`
        SELECT * FROM frota_desativacoes
        WHERE reativada_em IS NULL
           OR desde > now() - ${horas} * interval '1 hour'
           OR reativada_em > now() - ${horas} * interval '1 hour'
        ORDER BY desde DESC
        LIMIT 500`);
    return {
        ativo: true,
        motivos: MOTIVOS,
        postos: POSTOS,
        origens: ORIGENS,
        desativacoes: linhas.map((r) => {
            const d = desativacaoDe(r);
            return { ...d, ativa: d.reativadaEm === null };
        }),
    };
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

/**
 * Para vigiar sem depender do log do container: erros recentes, o que o GPS
 * ensinou (e quando), paradas abertas e à espera de decisão (pulo).
 */
export function diagnostico() {
    const agora = Date.now();
    return {
        ativo: Boolean(TOKEN),
        coletadoEm: coletadoEm?.toISOString() ?? null,
        coletaHaMin: coletadoEm ? Math.floor((agora - coletadoEm.getTime()) / 60_000) : null,
        erroAtual: erro,
        erros,
        abertas: abertas.size,
        esperandoPulo: [...abertas.values()].filter((p) => p.fora).length,
        quedasAbertas: quedas.size,
        aprendizado,
    };
}

export function painelAtual(agora = new Date()): PainelFrota {
    return montarPainel({
        ativo: Boolean(TOKEN),
        coletadoEm,
        vinculosEm,
        erro,
        catalogo: CATALOGO,
        desativadas: desativadasAgora(),
        desativacoes,
        hospitais: locais,
        resolvidas: resolverPosicoes(posicoes, dispositivos, CATALOGO),
        dispositivos,
        abertas,
        agora,
    });
}
