// ═══════════════════════════════════════════════════════════════
// /destinos — para onde os pacientes foram regulados, por turno.
//
// Funções PURAS: recebem linhas do banco, devolvem as mensagens prontas.
// Nada de Telegram, nada de SQL aqui — é o que permite testar o texto sem
// subir banco (mesmo motivo pelo qual services/report.ts separa buildReport
// de renderReportHtml).
//
// O bot COMPILA, não interpreta: não há tipagem de perfil de hospital nem
// julgamento de adequação clínica. Ele lista quantos e quais, sempre com o
// nome de quem regulou, e quem lê decide.
// ═══════════════════════════════════════════════════════════════
import { HOSPITALS } from "../services/score.js";
import type { EnvioRow, IntelRow } from "../services/metrics.js";
import {
    formatDate,
    formatDateTime,
    formatRange,
    formatTime,
    turnoOf,
    type Periodo,
    type Turno,
} from "./periodo.js";

/** Limite por mensagem. O teto do Telegram é 4096; 3500 deixa folga. */
export const CHUNK_LIMIT = 3500;
/** Máximo de envios listados por hospital/turno antes de resumir a cauda. */
const MAX_ENVIOS_POR_TURNO = 40;
/** Quadro clínico é texto livre: trunca para não estourar a mensagem. */
const MAX_CASO_CHARS = 120;
const MAX_NOME_CHARS = 40;
const MAX_NOTA_CHARS = 140;

// Regra do alerta por taxa: metade ou mais dos envios em vaga zero, com pelo
// menos 2 envios E 2 vagas zero. O piso duplo evita o falso alarme do "1 de 1"
// e do "1 de 2", que são ruído e não lotação.
const ALERTA_TAXA_ZERO = 0.5;
const ALERTA_MIN_ENVIOS = 2;
const ALERTA_MIN_ZEROS_TAXA = 2;
/** Vagas zero em números absolutos que já pedem atenção sozinhas. */
const ALERTA_ZEROS_ABSOLUTO = 3;
/** Tipos de intel que indicam lotação/indisponibilidade. */
const INTEL_LOTACAO: Record<string, string> = {
    lotado: "lotado",
    sem_recurso: "sem recurso",
    sem_especialista: "sem especialista",
};

const HOSPITAL_NAMES = new Map(HOSPITALS.map((h) => [h.id, h.name]));

/** Escapa o que vai dentro de parse_mode HTML. Todo valor vindo do banco passa aqui. */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, max: number): string {
    const t = s.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function hospitalName(id: string): string {
    return HOSPITAL_NAMES.get(id) || id;
}

/**
 * Autor da regulação: `mr` (Médico Regulador) com fallback para `criado_por`.
 * NUNCA `medico` — esse é o médico que recebeu no hospital de destino, e
 * atribuir a regulação a ele seria acusar a pessoa errada.
 */
export function autorDaRegulacao(e: Pick<EnvioRow, "mr" | "criadoPor">): string {
    const mr = (e.mr || "").trim();
    if (mr) return mr;
    const criado = (e.criadoPor || "").trim();
    return criado || "não informado";
}

// ── Agregação ────────────────────────────────────────────────

export interface TurnoBlock {
    turno: Turno;
    envios: EnvioRow[];
}

export interface HospitalBlock {
    hospitalId: string;
    nome: string;
    total: number;
    zeros: number;
    aceitos: number;
    turnos: TurnoBlock[];
    /** Vagas zero deste hospital, da mais recente para a mais antiga. */
    zerosRows: EnvioRow[];
}

export function agregarDestinos(envios: EnvioRow[]): HospitalBlock[] {
    const byHospital = new Map<string, EnvioRow[]>();
    for (const e of envios) {
        const arr = byHospital.get(e.hospitalId);
        if (arr) arr.push(e);
        else byHospital.set(e.hospitalId, [e]);
    }

    const blocks: HospitalBlock[] = [];
    for (const [hospitalId, rows] of byHospital) {
        const sorted = [...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const zerosRows = sorted.filter((r) => r.situacao === "ZERO");
        blocks.push({
            hospitalId,
            nome: hospitalName(hospitalId),
            total: sorted.length,
            zeros: zerosRows.length,
            aceitos: sorted.length - zerosRows.length,
            turnos: (["SD", "SN"] as Turno[]).map((turno) => ({
                turno,
                envios: sorted.filter((r) => turnoOf(r.timestamp) === turno),
            })),
            zerosRows: [...zerosRows].reverse(),
        });
    }

    // Do que MAIS recebeu para o que MENOS recebeu; empate desempata por
    // vaga zero e depois por nome, para a ordem ser estável entre execuções.
    blocks.sort(
        (a, b) => b.total - a.total || b.zeros - a.zeros || a.nome.localeCompare(b.nome, "pt-BR")
    );
    return blocks;
}

// ── Alertas de lotação ───────────────────────────────────────

export interface AlertaLotacao {
    hospitalId: string;
    nome: string;
    zeros: number;
    linhas: string[];
}

export function montarAlertas(
    blocks: HospitalBlock[],
    intelRows: IntelRow[],
    showDate: boolean
): AlertaLotacao[] {
    const byHospital = new Map<string, AlertaLotacao>();
    const stamp = (d: Date) => (showDate ? formatDateTime(d) : formatTime(d));

    const ensure = (hospitalId: string, zeros: number): AlertaLotacao => {
        let a = byHospital.get(hospitalId);
        if (!a) {
            a = { hospitalId, nome: hospitalName(hospitalId), zeros, linhas: [] };
            byHospital.set(hospitalId, a);
        }
        a.zeros = Math.max(a.zeros, zeros);
        return a;
    };

    for (const b of blocks) {
        const taxa = b.total ? b.zeros / b.total : 0;
        const taxaAlta =
            b.total >= ALERTA_MIN_ENVIOS &&
            b.zeros >= ALERTA_MIN_ZEROS_TAXA &&
            taxa >= ALERTA_TAXA_ZERO;
        if (!taxaAlta && b.zeros < ALERTA_ZEROS_ABSOLUTO) continue;
        const a = ensure(b.hospitalId, b.zeros);
        a.linhas.push(
            `🚫 ${b.zeros} de ${b.total} em vaga zero (${Math.round(taxa * 100)}%)`
        );
        const ultima = b.zerosRows[0];
        if (ultima) a.linhas.push(`↳ última vaga zero: ${stamp(ultima.timestamp)}`);
    }

    for (const i of intelRows) {
        const rotulo = INTEL_LOTACAO[i.tipo];
        if (!rotulo) continue;
        const zeros = blocks.find((b) => b.hospitalId === i.hospitalId)?.zeros ?? 0;
        const a = ensure(i.hospitalId, zeros);
        const autor = escapeHtml(truncate(i.autor, MAX_NOME_CHARS));
        let linha = `🔴 ${rotulo} — ${stamp(i.timestamp)} por <i>${autor}</i>`;
        const nota = (i.nota || "").trim();
        if (nota) linha += `\n     “${escapeHtml(truncate(nota, MAX_NOTA_CHARS))}”`;
        a.linhas.push(linha);
    }

    return [...byHospital.values()].sort(
        (a, b) => b.zeros - a.zeros || a.nome.localeCompare(b.nome, "pt-BR")
    );
}

// ── Renderização ─────────────────────────────────────────────

const RANK_EMOJI = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

function rankEmoji(i: number): string {
    return RANK_EMOJI[i] || "▫️";
}

function envioLine(e: EnvioRow, showDate: boolean): string {
    const quando = showDate ? formatDateTime(e.timestamp) : formatTime(e.timestamp);
    const marca = e.situacao === "ZERO" ? "🚫" : "•";
    const caso = (e.caso || "").trim();
    // O perfil do paciente é o que o banco tem: o campo `caso`, texto livre.
    // Não há idade/sexo/gravidade estruturados — ver rodapé da mensagem.
    const perfil = caso ? escapeHtml(truncate(caso, MAX_CASO_CHARS)) : "(sem descrição)";
    const autor = escapeHtml(truncate(autorDaRegulacao(e), MAX_NOME_CHARS));
    return `   ${marca} ${quando} · ${perfil} — <i>${autor}</i>`;
}

function turnoLines(t: TurnoBlock, showDate: boolean): string[] {
    const cabecalho =
        t.turno === "SD"
            ? `  ☀️ <b>SD</b> 07–19h · ${t.envios.length}`
            : `  🌙 <b>SN</b> 19–07h · ${t.envios.length}`;
    const lines = [cabecalho];
    const mostrados = t.envios.slice(0, MAX_ENVIOS_POR_TURNO);
    for (const e of mostrados) lines.push(envioLine(e, showDate));
    const restante = t.envios.length - mostrados.length;
    if (restante > 0) lines.push(`   ▫️ +${restante} envios não listados (limite da mensagem)`);
    return lines;
}

export interface DestinosInput {
    periodo: Periodo;
    envios: EnvioRow[];
    intel: IntelRow[];
}

/**
 * Monta o relatório como BLOCOS. Cada bloco é atômico para o fatiador: um
 * hospital com seus envios, ou um hospital com seus alertas, nunca é cortado
 * ao meio entre duas mensagens (a menos que sozinho já estoure o limite).
 */
export function buildDestinosBlocks(input: DestinosInput): string[] {
    const { periodo, envios, intel } = input;
    const showDate = periodo.key === "7d";
    const blocks = agregarDestinos(envios);
    const total = envios.length;
    const zeros = envios.filter((e) => e.situacao === "ZERO").length;

    const cabecalho =
        `🚑 <b>DESTINOS DAS REGULAÇÕES</b> — ${escapeHtml(periodo.label)}\n` +
        `📅 ${formatRange(periodo)} (America/Sao_Paulo)`;

    if (!total) return [`${cabecalho}\n\n✅ Nenhum paciente regulado no período.`];

    const units: string[] = [
        cabecalho +
            `\n\n📊 ${total} paciente${total === 1 ? "" : "s"} regulado${total === 1 ? "" : "s"} · ` +
            `${zeros} em vaga zero · ${blocks.length} destino${blocks.length === 1 ? "" : "s"}`,
    ];

    blocks.forEach((b, i) => {
        const zeroTxt = b.zeros ? ` · 🚫 ${b.zeros} vaga zero` : "";
        const lines = [
            `${rankEmoji(i)} <b>${escapeHtml(b.nome)}</b> — ${b.total} regulado${b.total === 1 ? "" : "s"}${zeroTxt}`,
        ];
        for (const t of b.turnos) lines.push(...turnoLines(t, showDate));
        units.push(lines.join("\n"));
    });

    const alertas = montarAlertas(blocks, intel, showDate);
    units.push("⚠️ <b>ALERTAS DE LOTAÇÃO</b>");
    if (!alertas.length) {
        units.push("✅ Nenhum indicador de lotação no período.");
    } else {
        for (const a of alertas) {
            units.push([`<b>${escapeHtml(a.nome)}</b>`, ...a.linhas.map((l) => `  ${l}`)].join("\n"));
        }
    }

    units.push(
        "ℹ️ O sistema não registra leitos, capacidade nem motivo da vaga zero. " +
            "Os alertas acima são os únicos indicadores existentes: vagas zero " +
            "registradas e alertas de intel lançados pelos reguladores.\n" +
            "ℹ️ O perfil do paciente é o campo <b>Caso</b> do painel (texto livre) — " +
            "não há idade, sexo nem gravidade estruturados. O bot compila; a leitura clínica é humana."
    );

    return units;
}

/** O relatório inteiro num texto só — usado nos testes e na leitura humana. */
export function buildDestinosText(input: DestinosInput): string {
    return buildDestinosBlocks(input).join("\n\n");
}

/**
 * Fatia em mensagens ≤ `limit`, sem cortar um bloco ao meio. Um bloco que
 * sozinho já passa do limite é quebrado em linhas; uma linha que sozinha passa
 * do limite é cortada na força (não deveria acontecer: tudo é truncado antes).
 */
export function chunkBlocks(units: string[], limit = CHUNK_LIMIT): string[] {
    const RESERVA = 40; // espaço para o sufixo "parte i/n"
    const max = limit - RESERVA;
    const chunks: string[] = [];
    let atual = "";

    const flush = () => {
        if (atual.length) chunks.push(atual);
        atual = "";
    };
    const add = (pedaco: string, sep: string) => {
        const candidato = atual ? `${atual}${sep}${pedaco}` : pedaco;
        if (candidato.length > max) {
            flush();
            atual = pedaco;
        } else {
            atual = candidato;
        }
    };

    for (const unit of units) {
        if (unit.length <= max) {
            add(unit, "\n\n");
            continue;
        }
        // Bloco grande demais: desce para linhas. Sem flush() aqui — o que já
        // está na mensagem corrente continua valendo, senão o cabeçalho sairia
        // sozinho numa mensagem de 200 caracteres.
        let primeira = true;
        for (const raw of unit.split("\n")) {
            let linha = raw;
            while (linha.length > max) {
                flush();
                chunks.push(linha.slice(0, max));
                linha = linha.slice(max);
            }
            add(linha, primeira ? "\n\n" : "\n");
            primeira = false;
        }
    }
    flush();

    if (chunks.length <= 1) return chunks.length ? chunks : [""];
    return chunks.map((c, i) => `${c}\n\n<i>parte ${i + 1}/${chunks.length}</i>`);
}

/** Mensagens prontas para o sendMessage. */
export function buildDestinosReply(input: DestinosInput): string[] {
    return chunkBlocks(buildDestinosBlocks(input));
}

/** Ajuda curta para argumento inválido. */
export function destinosHelp(): string {
    return (
        "🚑 <b>/destinos</b> — para onde os pacientes foram regulados\n\n" +
        "Períodos: <code>hoje</code> (padrão) · <code>ontem</code> · <code>7d</code>\n" +
        "Ex.: <code>/destinos 7d</code>\n\n" +
        "O dia começa às 07:00 (SD 07–19h · SN 19–07h)."
    );
}
