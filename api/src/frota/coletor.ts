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
import { baseOcupada, textoAviso, textoBalanco, textoBaseOcupada, textoCobranca, type DadosAviso } from "./aviso.js";
import { editarChat, enviarChat, frotaChatId, notifyAdmin, reguladoresChatId } from "../lib/telegram.js";
import { medicosPorBase, mesaAgora } from "./plantoes.js";
import {
    diagnosticoOcorrencias, lembreteFonteCaiu, ocorrenciaDe, receberOcorrencias, situacoesRecebidas, vigiarMapa, type esquemaOcorrencias,
} from "./ocorrencias.js";
import {
    avancarQuedas, bateriaBaixa, instaveisAgora, plantaoDe, ranking, resumoDevido,
    textoBateria, textoFimQueda, textoFrota, textoInstavel, textoQueda, textoResumo, textoSurto,
    INSTAVEL_JANELA_MIN, type Queda, type QuedaRecente,
} from "./sinal.js";
import { ABERTA_MAX_MS, acolhimentosLigado, buscarAcolhimentos, cruzar, janela, type Acolhimento } from "./acolhimentos.js";
import { buscarDispositivos, buscarPosicoes, type DispositivoSamu, type PosicaoSamu } from "./samumais.js";
import { leiturasParaPermanencia, montarPainel, resolverPosicoes, type PainelFrota } from "./painel.js";
import {
    ErroDesativacao, MOTIVOS, ORIGENS, POSTOS, VIRADA, textoDesativacao, textoMotivo, textoVirada,
    type Desativacao, type Motivo, type Origem, type Posto, esquemaDesativar, esquemaMotivo,
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
/** Paradas com o médico já gravado (o UPDATE também confere `medico IS NULL`). */
const medicoGravado = new Set<number>();

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
    // Médico da USA (Plantões) na hora da retenção: o balanço das 07h/19h chama
    // quem estava lá, não o colega que acabou de assumir.
    await db.execute(sql`ALTER TABLE frota_permanencias ADD COLUMN IF NOT EXISTS medico varchar(200)`);
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
    // Histórico do mapa de equipes (ocorrencias.ts), para os relatórios: uma
    // linha por ocorrência de cada viatura e uma por status que ela passou,
    // com o MR da hora. `ultima_vez` = última vez vista no mapa.
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_ocorrencias (
            id                   serial PRIMARY KEY,
            chave                varchar(60)  NOT NULL,
            protocolo            varchar(30)  NOT NULL,
            medico               varchar(120),
            risco                varchar(30),
            regulacao_secundaria boolean      NOT NULL DEFAULT false,
            abertura             timestamptz,
            endereco             text,
            bairro               varchar(100),
            queixa               text,
            hma                  text,
            primeira_vez         timestamptz  NOT NULL,
            ultima_vez           timestamptz  NOT NULL,
            UNIQUE (chave, protocolo)
        )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS frota_ocorrencias_ultima_idx ON frota_ocorrencias (ultima_vez)`);
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_ocorrencia_status (
            ocorrencia_id integer      NOT NULL REFERENCES frota_ocorrencias (id) ON DELETE CASCADE,
            status        varchar(60)  NOT NULL,
            em            timestamptz  NOT NULL,
            medico        varchar(120),
            PRIMARY KEY (ocorrencia_id, status, em)
        )`);
    // A parada no hospital/UPA × o mapa de equipes: em quantas coletas (2 min
    // cada) a viatura estava em ocorrência e em quantas estava livre — coleta
    // sem dado do mapa não conta em nenhuma —, e a última ocorrência e MR.
    await db.execute(sql`
        ALTER TABLE frota_permanencias
            ADD COLUMN IF NOT EXISTS oc_coletas integer NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS livre_coletas integer NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS oc_protocolo varchar(30),
            ADD COLUMN IF NOT EXISTS oc_mr varchar(120)`);
    // "Na base, mas ainda em ocorrência" já avisado — um por viatura e
    // ocorrência, e não repete a cada deploy.
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS frota_base_ocupada (
            chave      varchar(60) NOT NULL,
            protocolo  varchar(30) NOT NULL DEFAULT '',
            avisado_em timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (chave, protocolo)
        )`);
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
               lat, lng, estavel_lat, estavel_lng, estavel_n
        FROM frota_permanencias WHERE motivo_fim IS NULL`)) {
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
        await vencerDesativacoes(agora).catch((e) => registrarErro("virada das desativações", e));
        await espelharMesa(agora).catch((e) => registrarErro("desativações da Mesa", e));
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
        await avisarBaseOcupada(agora).catch((e) => registrarErro("aviso base ocupada", e));
        await gravarMedicos().catch((e) => registrarErro("médico da parada", e));
        await gravarOcorrenciaDasParadas(agora).catch((e) => registrarErro("ocorrência da parada", e));
        await avisarSinal(agora).catch((e) => registrarErro("aviso de sinal", e));
        // Ponte do mapa de equipes muda (ou de volta): só o admin, no privado.
        const mapa = vigiarMapa(agora);
        if (mapa && AVISOS) await notifyAdmin(mapa).catch((e) => registrarErro("aviso do mapa de equipes", e));
        // Fonte caída: lembra o GRUPO a cada 5 min para reabrir o lançador.
        const fonte = lembreteFonteCaiu(agora);
        if (fonte && AVISOS) await mandar(fonte).catch((e) => registrarErro("lembrete fonte caiu", e));
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

function dadosAviso(p: Permanencia, agora = new Date()): DadosAviso {
    const q = descreverChave(p.chave);
    const h = LOCAIS_FROTA.find((x) => x.id === p.hospitalId);
    return {
        nome: q.nome, tipo: q.tipo, hospitalNome: h?.nome ?? p.hospitalId,
        entrada: p.entrada, ultimaVez: p.ultimaVez, avisoEm: p.alertaEm,
        ocorrencia: ocorrenciaDe(p.chave, agora),
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
/** Desde quando cada viatura está na área da própria base (base fora de hospital não tem permanência gravada). */
const naBaseDesde = new Map<string, Date>();
/** Cache de "chave|protocolo" já avisado (a tabela frota_base_ocupada é a verdade). */
const baseOcupadaAvisada = new Set<string>();

/** Na própria base há 40+ min e o mapa de equipes ainda a dá em ocorrência: aviso especial, uma vez. */
async function avisarBaseOcupada(agora: Date): Promise<void> {
    if (!AVISOS) return;
    const naBaseAgora = new Set<string>();
    for (const v of painelAtual(agora).viaturas) {
        if (v.situacao !== "mapa" || v.foraDoCatalogo) continue;
        if (!(v.naBase || v.noHospital?.naBase)) continue;
        naBaseAgora.add(v.chave);
        // Base dentro de hospital/UPA: a permanência tem a entrada real (sobrevive ao deploy).
        const desde = v.noHospital?.naBase ? new Date(v.noHospital.entrada) : (naBaseDesde.get(v.chave) ?? agora);
        naBaseDesde.set(v.chave, desde);
        const b = baseOcupada(v, desde, agora, ALERTA_MIN);
        if (!b) continue;
        const protocolo = b.ocorrencia.protocolo ?? "";
        const k = `${v.chave}|${protocolo}`;
        if (baseOcupadaAvisada.has(k)) continue;
        const [ja] = await consultar(sql`SELECT 1 AS x FROM frota_base_ocupada WHERE chave = ${v.chave} AND protocolo = ${protocolo}`);
        if (!ja) {
            if (!(await mandar(textoBaseOcupada(b)))) continue; // falhou: tenta na próxima coleta
            await db.execute(sql`INSERT INTO frota_base_ocupada (chave, protocolo) VALUES (${v.chave}, ${protocolo}) ON CONFLICT DO NOTHING`);
        }
        baseOcupadaAvisada.add(k);
    }
    // Saiu da base (ou sumiu do mapa): o cronômetro recomeça na próxima chegada.
    for (const c of naBaseDesde.keys()) if (!naBaseAgora.has(c)) naBaseDesde.delete(c);
}

async function avisar(fechadas: Fechamento[], agora: Date): Promise<void> {
    if (!AVISOS) return;
    for (const p of abertas.values()) {
        if (!p.alertaEm || p.id === undefined) continue;
        const texto = textoAviso(dadosAviso(p, agora), { tipo: "parada", minutos: duracaoMin(p, agora) }, agora);
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

/** USA que passou de 40 min fora da base: grava quem é o médico dela agora (Plantões). */
async function gravarMedicos(): Promise<void> {
    const faltam = [...abertas.values()].filter(
        (p) => p.id !== undefined && p.alertaEm && !p.naBase && !medicoGravado.has(p.id) && descreverChave(p.chave).tipo === "USA",
    );
    if (!faltam.length) return;
    const medicos = await medicosPorBase();
    for (const p of faltam) {
        const medico = medicos.get(p.chave);
        if (!medico) continue;
        await db.execute(sql`UPDATE frota_permanencias SET medico = ${medico} WHERE id = ${p.id} AND medico IS NULL`);
        medicoGravado.add(p.id!);
    }
}

/** Cada parada aberta × o mapa de equipes nesta coleta (colunas oc_* de frota_permanencias). */
async function gravarOcorrenciaDasParadas(agora: Date): Promise<void> {
    for (const p of abertas.values()) {
        const s = p.id === undefined ? null : ocorrenciaDe(p.chave, agora);
        if (!s) continue;
        if (!s.ocorrencia) {
            await db.execute(sql`UPDATE frota_permanencias SET livre_coletas = livre_coletas + 1 WHERE id = ${p.id}`);
            continue;
        }
        await db.execute(sql`
            UPDATE frota_permanencias
            SET oc_coletas = oc_coletas + 1,
                oc_protocolo = COALESCE(${s.ocorrencia.protocolo}, oc_protocolo),
                oc_mr = COALESCE(${s.ocorrencia.medico}, oc_mr)
            WHERE id = ${p.id}`);
    }
}

/**
 * Envio do coletor do mapa de equipes: vale na hora (memória) e fica no
 * histórico. Banco fora do ar não derruba o envio — o aviso segue com a memória.
 */
export async function registrarOcorrencias(envio: z.infer<typeof esquemaOcorrencias>) {
    const agora = new Date();
    const resposta = receberOcorrencias(envio, CATALOGO, agora);
    try {
        for (const [chave, s] of situacoesRecebidas()) {
            const o = s.ocorrencia;
            if (!o?.protocolo) continue;
            const [linha] = await consultar(sql`
                INSERT INTO frota_ocorrencias
                    (chave, protocolo, medico, risco, regulacao_secundaria, abertura, endereco, bairro, queixa, hma, primeira_vez, ultima_vez)
                VALUES (${chave}, ${o.protocolo}, ${o.medico}, ${o.risco}, ${o.regulacaoSecundaria}, ${o.abertura},
                        ${o.endereco}, ${o.bairro}, ${o.queixa}, ${o.hma}, ${agora.toISOString()}, ${agora.toISOString()})
                ON CONFLICT (chave, protocolo) DO UPDATE
                SET medico = EXCLUDED.medico, risco = EXCLUDED.risco, regulacao_secundaria = EXCLUDED.regulacao_secundaria,
                    endereco = EXCLUDED.endereco, bairro = EXCLUDED.bairro, queixa = EXCLUDED.queixa, hma = EXCLUDED.hma,
                    ultima_vez = EXCLUDED.ultima_vez
                RETURNING id`);
            if (!o.status || !o.statusEm) continue;
            await db.execute(sql`
                INSERT INTO frota_ocorrencia_status (ocorrencia_id, status, em, medico)
                VALUES (${Number(linha.id)}, ${o.status}, ${o.statusEm}, ${o.medico})
                ON CONFLICT DO NOTHING`);
        }
    } catch (e) {
        await registrarErro("histórico de ocorrências", e);
    }
    return resposta;
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
    /** Médico da USA na hora da retenção (Plantões), gravado aos 40 min. */
    medico: string | null;
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
        SELECT id, chave, hospital_id, entrada, ultima_vez, saida, motivo_fim, alerta_em, na_base, medico
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
            medico: r.medico != null ? String(r.medico) : null,
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

/**
 * Cobrança da denúncia: USA presa 40+ min em hospital sem notificação no
 * Acolhimentos, com o médico da viatura (Plantões) e o texto pronto para o
 * WhatsApp. Quem entrega é o Tom (secretário), no grupo SAMU-Salvador: ele
 * busca isto e manda cada `id` (a parada) uma vez só.
 * Acolhimentos fora do ar: erro — ninguém é cobrado sem a prova de que não registrou.
 */
export async function cobrancasPendentes(): Promise<{
    id: number; codigo: string; hospital: string; entrada: string; minutos: number; medico: string | null; texto: string;
}[]> {
    if (!acolhimentosLigado()) throw new Error("Acolhimentos desligado (sem ACOLHIMENTOS_TOKEN)");
    const t = await linhaDoTempo(1);
    if (t.acolhimentos.erro) throw new Error(t.acolhimentos.erro);
    const presas = t.paradas.filter((p) => p.aberta && p.semNotificacao);
    if (!presas.length) return [];
    // Plantões fora do ar: a cobrança sai assim mesmo, chamando "médico(a) da SM01".
    const medicos = await medicosPorBase().catch(() => new Map<string, string>());
    const agora = new Date();
    return presas.map((p) => {
        const hospital = t.hospitais.find((h) => h.id === p.hospitalId)?.nome ?? p.hospitalId;
        const medico = medicos.get(p.chave) ?? null;
        return {
            id: p.id, codigo: p.nome, hospital, entrada: p.entrada, minutos: p.minutos, medico,
            texto: textoCobranca({ nome: p.nome, hospitalNome: hospital, entrada: new Date(p.entrada) }, medico, agora),
        };
    });
}

/**
 * Balanço da virada (07h e 19h), para o Tom levar ao grupo SAMU-Salvador:
 * viaturas 40+ min paradas em hospital nas últimas 12 h, por hospital — as
 * que ainda estão presas na virada contam até agora. USA sem notificação no
 * Acolhimentos vai para o convite a registrar, com o médico da hora.
 * Acolhimentos fora do ar: o balanço sai sem o convite (não dá para afirmar).
 */
export async function balancoPlantao(agora = new Date()): Promise<{ texto: string; retidas: number; semRegistro: number }> {
    const t = await linhaDoTempo(12);
    const nomes = new Map(t.hospitais.filter((h) => h.tipo === "hospital").map((h) => [h.id, h.nome]));
    const retidas = t.paradas
        .filter((p) => !p.naBase && nomes.has(p.hospitalId) && p.minutos >= ALERTA_MIN)
        .map((p) => ({
            codigo: p.nome, tipo: p.tipo, hospital: nomes.get(p.hospitalId)!, minutos: p.minutos,
            presa: p.aberta, semRegistro: p.semNotificacao, medico: p.medico,
        }));
    const conferido = t.acolhimentos.ligado && !t.acolhimentos.erro;
    return {
        texto: textoBalanco(retidas, { agora, conferido, alertaMin: ALERTA_MIN }),
        retidas: retidas.length,
        semRegistro: retidas.filter((r) => r.semRegistro).length,
    };
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

/** Encerra as desativações informadas em plantão que já virou (desativacoes.ts). */
async function vencerDesativacoes(agora: Date): Promise<void> {
    const plantao = plantaoDe(agora);
    const velhas = [...desativacoes.values()].filter((d) => plantaoDe(new Date(d.desde)) !== plantao);
    const encerradas: Desativacao[] = [];
    for (const d of velhas) {
        const [linha] = await consultar(sql`
            UPDATE frota_desativacoes SET reativada_em = now(), reativada_por = ${VIRADA}
            WHERE id = ${d.id} AND reativada_em IS NULL
            RETURNING *`);
        desativacoes.delete(d.codigo);
        if (linha) encerradas.push(d);
    }
    if (!encerradas.length) return;
    console.log(`[frota] virada do plantão encerrou: ${encerradas.map((d) => d.codigo).join(", ")}`);
    await mandar(textoVirada(encerradas)).catch((e) => registrarErro("aviso Telegram", e));
}

/** `reativadaPor` de quem a Mesa reativou (a base voltou a ter médico ou a chefia reativou lá). */
const MESA = "Mesa operacional";

/**
 * Base que a chefia desativou na Mesa operacional (plantoes) vale aqui: vira
 * desativação de origem "mesa", sem motivo (a Mesa não pede), e é reativada
 * quando a Mesa reativa. Reativada à mão aqui com a Mesa ainda desativada: não
 * volta neste plantão.
 */
async function espelharMesa(agora: Date): Promise<void> {
    const mesa = await mesaAgora();
    // Leitura do plantão anterior (memória de 5 min): a virada já encerrou o que era dela.
    if (!mesa || plantaoDe(new Date(mesa.em)) !== plantaoDe(agora)) return;
    for (const d of [...desativacoes.values()]) {
        if (d.origem === "mesa" && !mesa.desativadas.has(d.codigo)) await reativarViatura(d.id, MESA);
    }
    for (const codigo of mesa.desativadas) {
        if (desativacoes.has(codigo) || DESATIVADAS_ATE_SEGUNDA_ORDEM.has(codigo) || !CATALOGO.some((c) => c.codigo === codigo)) continue;
        const antes = await consultar(sql`
            SELECT desde FROM frota_desativacoes
            WHERE codigo = ${codigo} AND origem = 'mesa' AND reativada_por NOT IN (${MESA}, ${VIRADA})
              AND desde > now() - interval '13 hours'`);
        if (antes.some((r) => plantaoDe(new Date(r.desde as string)) === plantaoDe(agora))) continue;
        await desativarViatura({ codigo, motivos: [], observacao: null, informadoPor: "chefia de plantão", posto: "chefe", origem: "mesa" });
    }
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

/** Motivo de uma desativação aberta — a que chegou sem ele, ou para corrigir. */
export async function informarMotivo(id: number, dados: z.infer<typeof esquemaMotivo>): Promise<Desativacao> {
    if (!TOKEN) throw new ErroDesativacao(503, "Frota desligada neste servidor");
    const [linha] = await consultar(sql`
        UPDATE frota_desativacoes SET motivos = ${JSON.stringify(dados.motivos)}::jsonb, observacao = ${dados.observacao || null}
        WHERE id = ${id} AND reativada_em IS NULL
        RETURNING *`);
    if (!linha) throw new ErroDesativacao(404, "Desativação não encontrada ou já reativada");
    const d = desativacaoDe(linha);
    desativacoes.set(d.codigo, d);
    console.log(`[frota] ${d.codigo}: motivo informado por ${dados.informadoPor}: ${d.motivos.join(",")}`);
    await mandar(textoMotivo(d, dados.informadoPor)).catch((e) => registrarErro("aviso Telegram", e));
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
        mapaEquipes: diagnosticoOcorrencias(agora),
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
        ocorrenciaDe: (chave) => ocorrenciaDe(chave, agora),
        agora,
    });
}
