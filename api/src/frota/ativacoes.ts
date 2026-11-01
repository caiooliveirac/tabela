// ═══════════════════════════════════════════════════════════════
// Ativação extraordinária: a viatura da lista "até segunda ordem"
// (DESATIVADAS_ATE_SEGUNDA_ORDEM, catalogo.ts) que a Central põe para rodar
// num plantão — quem ativa diz a equipe no Quadro Informativo, que é por onde
// ela chega aqui. Vale até a virada do plantão de quem ativou (07h/19h; 08h/20h
// nas de 08h–20h), como a desativação informada: a decisão da coordenação não
// se desfaz sozinha. Enquanto vale, a viatura deixa de ser "até segunda ordem"
// em toda conta (painel, avisos, Huddle, Relatório, histórico).
// Aqui: regras e esquemas, puros (testados em ativacoes.test.ts). Banco: coletor.ts.
// ═══════════════════════════════════════════════════════════════
import { z } from "zod";

/** Onde foi ativada. Hoje só o Quadro Informativo ativa; o painel da Frota pode vir depois. */
export const ORIGENS_ATIVACAO = {
    quadro: "Quadro Informativo",
    frota: "painel da Frota",
} as const;
export type OrigemAtivacao = keyof typeof ORIGENS_ATIVACAO;

export interface Ativacao {
    id: number;
    codigo: string;
    ativadaPor: string;
    origem: OrigemAtivacao;
    /** ISO. */
    desde: string;
    encerradaEm: string | null;
    encerradaPor: string | null;
}

export const esquemaAtivar = z.object({
    codigo: z.string().trim().min(2).max(10),
    ativadaPor: z.string().trim().min(2, "Diga quem está ativando").max(80),
    origem: z.enum(Object.keys(ORIGENS_ATIVACAO) as [OrigemAtivacao, ...OrigemAtivacao[]]).default("quadro"),
});

export const esquemaEncerrar = z.object({
    encerradaPor: z.string().trim().min(2, "Diga quem está encerrando").max(80),
});

/** `encerradaPor` de quem a virada encerrou. */
export const VIRADA_ATIVACAO = "virada do plantão";

/** A lista até segunda ordem menos as ativadas neste plantão. */
export function ateSegundaOrdemAgora(lista: ReadonlySet<string>, ativadas: Iterable<string>): ReadonlySet<string> {
    const fora = new Set(lista);
    for (const c of ativadas) fora.delete(c);
    return fora;
}

export class ErroAtivacao extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
