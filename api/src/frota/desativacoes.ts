// ═══════════════════════════════════════════════════════════════
// Desativação informada no painel da Frota: o rádio-operador, a chefia ou a
// enfermagem avisa que a viatura saiu de operação (mecânica, falta de
// condutor…). Até alguém reativar — ou até a virada do plantão (07h/19h) de
// quem informou —, ela conta como desativada: sai dos avisos (parada, sinal,
// bateria) e do ranking, e aparece no resumo. Cada chefia responde pelo
// próprio plantão: o que continuar fora, o plantão seguinte informa de novo.
//
// O Huddle do SAMU (repo hge-huddle) lê GET /frota/desativacoes pela rede
// Docker do tabela e pré-preenche "viatura fora de operação". Por isso os
// códigos de motivo são os MESMOS do grupo `motivo_baixa` de lá.
//
// Quem informou é o nome do cabeçalho do painel + o posto: o portão do
// login único só diz "logado", não quem (docs/login-unico.md, fase 2).
// Aqui: regras e textos, puros (testados em sinal.test.ts). Banco: coletor.ts.
// ═══════════════════════════════════════════════════════════════
import { z } from "zod";
import { escapeHtml } from "../lib/telegram.js";
import { hhmm } from "./aviso.js";

/** Mesmos códigos e rótulos de `motivo_baixa` no hge-huddle (server/src/db/seed-data.ts). */
export const MOTIVOS = {
    condutor: "Condutor(a)",
    tecnico: "Técnico(a) de Enfermagem",
    enfermeiro: "Enfermeiro(a)",
    medico: "Médico(a)",
    mecanica: "Mecânica ou pneu",
    sem_oxigenio: "Sem oxigênio",
    sem_maca: "Sem maca, prancha ou colar",
    sem_monitor: "Sem monitor ou DEA",
    sem_radio: "Sem rádio ou telefone",
    outro: "Outro",
} as const;
export type Motivo = keyof typeof MOTIVOS;

export const POSTOS = {
    radio: "Rádio-operador(a)",
    chefe: "Chefe",
    enfermeiro: "Enfermeiro(a)",
} as const;
export type Posto = keyof typeof POSTOS;

/**
 * Onde foi informada: aqui, no Huddle, no Quadro Informativo
 * (quadro.mnrs.com.br) ou no Relatório da chefia (relatorio.mnrs.com.br, a
 * chefia marca a unidade como desativada). Todos escrevem nesta mesma lista.
 * "mesa": base desativada pela chefia na Mesa operacional (plantoes) — quem
 * escreve é o coletor daqui, que lê a Mesa a cada ciclo (espelharMesa).
 */
export const ORIGENS = {
    frota: "painel da Frota",
    huddle: "Huddle",
    quadro: "Quadro Informativo",
    relatorio: "Relatório da chefia",
    mesa: "Mesa operacional",
} as const;
export type Origem = keyof typeof ORIGENS;

export interface Desativacao {
    id: number;
    codigo: string;
    motivos: Motivo[];
    observacao: string | null;
    informadoPor: string;
    posto: Posto;
    /** Linha antiga (sem a coluna) conta como "frota". */
    origem: Origem;
    /** ISO. */
    desde: string;
    reativadaEm: string | null;
    reativadaPor: string | null;
}

export const esquemaDesativar = z
    .object({
        codigo: z.string().trim().min(2).max(10),
        motivos: z.array(z.enum(Object.keys(MOTIVOS) as [Motivo, ...Motivo[]])).max(10),
        observacao: z.string().trim().max(300).optional().nullable(),
        informadoPor: z.string().trim().min(2, "Preencha seu nome no cabeçalho").max(80),
        posto: z.enum(Object.keys(POSTOS) as [Posto, ...Posto[]]),
        origem: z.enum(Object.keys(ORIGENS) as [Origem, ...Origem[]]).default("frota"),
    })
    // Sem motivo só vindo de fora (Relatório, Mesa…): lá a chefia desativa num
    // clique e o motivo vem depois (esquemaMotivo). Aqui no painel é obrigatório.
    .refine((d) => d.motivos.length > 0 || d.origem !== "frota", { message: "Escolha pelo menos um motivo", path: ["motivos"] })
    .refine((d) => !d.motivos.includes("outro") || (d.observacao ?? "").length >= 3, {
        message: "Motivo \"Outro\": diga qual na observação",
        path: ["observacao"],
    });

/** Motivo informado depois, para a desativação que chegou sem ele. */
export const esquemaMotivo = z
    .object({
        motivos: z.array(z.enum(Object.keys(MOTIVOS) as [Motivo, ...Motivo[]])).min(1, "Escolha pelo menos um motivo").max(10),
        observacao: z.string().trim().max(300).optional().nullable(),
        informadoPor: z.string().trim().min(2, "Preencha seu nome no cabeçalho").max(80),
    })
    .refine((d) => !d.motivos.includes("outro") || (d.observacao ?? "").length >= 3, {
        message: "Motivo \"Outro\": diga qual na observação",
        path: ["observacao"],
    });

export const esquemaReativar = z.object({
    reativadaPor: z.string().trim().min(2, "Preencha seu nome no cabeçalho").max(80),
});

export const SEM_MOTIVO = "sem motivo informado";

/** "Mecânica ou pneu, Sem oxigênio" — ou "sem motivo informado". */
export const rotuloMotivos = (d: Pick<Desativacao, "motivos" | "observacao">) =>
    d.motivos.map((m) => (m === "outro" && d.observacao ? d.observacao : MOTIVOS[m])).join(", ") || SEM_MOTIVO;

/** " no Quadro Informativo" — vazio quando foi no próprio painel da Frota. */
const onde = (d: Pick<Desativacao, "origem">) =>
    d.origem && d.origem !== "frota" ? ` n${d.origem === "mesa" ? "a" : "o"} ${ORIGENS[d.origem]}` : "";

/** Motivo curto para o painel: "Mecânica ou pneu · Fulano (Rádio-operador(a)) às 08:10". */
export const motivoPainel = (d: Desativacao) =>
    `${rotuloMotivos(d)} · ${d.informadoPor} (${POSTOS[d.posto]})${onde(d)} às ${hhmm(new Date(d.desde))}`;

const minutos = (de: string, ate: string) => Math.max(0, Math.round((Date.parse(ate) - Date.parse(de)) / 60_000));
const duracao = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);

export function textoDesativacao(d: Desativacao, tipo: string | null): string {
    const quem = `<b>${escapeHtml(d.codigo)}</b>${tipo ? ` (${escapeHtml(tipo)})` : ""}`;
    if (d.reativadaEm) {
        return (
            `✅ ${quem} <b>reativada</b> por ${escapeHtml(d.reativadaPor ?? "?")} às ${hhmm(new Date(d.reativadaEm))} — ` +
            `ficou ${duracao(minutos(d.desde, d.reativadaEm))} desativada (${escapeHtml(rotuloMotivos(d))}). Avisos dela voltam a valer.`
        );
    }
    const obs = d.observacao && !d.motivos.includes("outro") ? ` — ${escapeHtml(d.observacao)}` : "";
    return (
        `⛔ ${quem} <b>desativada</b>${onde(d)} por ${escapeHtml(d.informadoPor)} (${POSTOS[d.posto]}): ` +
        `${d.motivos.length ? escapeHtml(rotuloMotivos(d)) : `<b>${SEM_MOTIVO}</b>`}${obs}\n` +
        `Sem avisos dela até alguém reativar no painel da Frota.` +
        (d.motivos.length ? "" : `\n⚠️ Falta o <b>motivo</b>: quem souber informa no painel da Frota ou no Relatório da chefia.`)
    );
}

/** O motivo chegou depois (desativação que veio sem ele). */
export const textoMotivo = (d: Desativacao, por: string) =>
    `📝 <b>${escapeHtml(d.codigo)}</b> desativada: motivo informado por ${escapeHtml(por)} — ${escapeHtml(rotuloMotivos(d))}`;

/** `reativadaPor` de quem a virada do plantão encerrou (ninguém clicou). */
export const VIRADA = "virada do plantão";

/**
 * Um aviso só para todas as que a virada encerrou: o plantão que entra é
 * outra equipe e informa de novo o que continuar fora.
 */
export function textoVirada(ds: Pick<Desativacao, "codigo" | "motivos" | "observacao">[]): string {
    return (
        `🔄 <b>Virada do plantão</b>: desativações informadas no plantão anterior foram encerradas.\n` +
        ds.map((d) => `• <b>${escapeHtml(d.codigo)}</b> — ${escapeHtml(rotuloMotivos(d))}`).join("\n") +
        `\nContinua fora? Informe de novo (Frota, Huddle ou Quadro). Os avisos delas voltam a valer.`
    );
}

export class ErroDesativacao extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
