// ═══════════════════════════════════════════════════════════════
// Mapa externo do SAMU+ (ocorrências + disponibilidade por equipe).
//
// O dado de ocorrência (protocolo, risco, status_deslocamento) só existe no
// painel INTERNO do SAMU+ (172.23.130.87/dashmapa), que o magalu não alcança.
// Uma ponte (coletor-frota.mjs) roda numa máquina da Central, na VPN, lê esse
// painel, corta todo dado de paciente e faz POST aqui a cada ~1 min.
//
// Guardado só em memória, como o painel da Frota: é estado vivo, não histórico,
// e não tem nada de paciente. Some no deploy e se refaz no próximo POST.
//
// Defesa em profundidade: mesmo que a ponte seja contornada, esta API só copia
// os campos da whitelist abaixo — qualquer campo de paciente é descartado aqui.
// ═══════════════════════════════════════════════════════════════

import { z } from "zod";

/** Segredo de envio da ponte. Vazio = rota desligada (503). */
const TOKEN = process.env.PONTE_MAPA_TOKEN || "";

/** Depois disso sem receber, o dado é considerado velho (a tela avisa). */
const VALIDADE_MS = 5 * 60_000;

const esquemaUnidade = z.object({
    equipe: z.string().min(1),
    unidade: z.string().nullish(),
    tipo_unidade: z.string().nullish(),
    latitude: z.union([z.string(), z.number()]).nullish(),
    longitude: z.union([z.string(), z.number()]).nullish(),
    velocidade: z.union([z.string(), z.number()]).nullish(),
    data_gps: z.string().nullish(),
    em_ocorrencia: z.boolean().nullish(),
    ocorrencia: z
        .object({
            protocolo: z.string().nullish(),
            classificacao_risco: z.string().nullish(),
            horario_abertura: z.string().nullish(),
            status_deslocamento: z
                .object({ status: z.string().nullish(), data: z.string().nullish() })
                .nullish(),
            bairro: z.string().nullish(),
            cidade: z.string().nullish(),
        })
        .nullish(),
});

// Corpo = lista de unidades. Campos desconhecidos (inclusive paciente) caem no
// strip do zod por serem fora do esquema.
const esquemaCorpo = z.array(esquemaUnidade);

export type UnidadeMapa = z.infer<typeof esquemaUnidade>;

let equipes: UnidadeMapa[] = [];
let recebidoEm: Date | null = null;

export function pontePronta(): boolean {
    return TOKEN.length > 0;
}

export function tokenConfere(recebido: string | undefined): boolean {
    return TOKEN.length > 0 && recebido === TOKEN;
}

/** Valida e guarda o lote. Lança ZodError se o corpo não casar. */
export function ingerirMapa(corpo: unknown): { equipes: number; emOcorrencia: number } {
    const lote = esquemaCorpo.parse(corpo);
    equipes = lote;
    recebidoEm = new Date();
    return { equipes: lote.length, emOcorrencia: lote.filter((u) => u.em_ocorrencia).length };
}

export function mapaExternoAtual(agora = new Date()): {
    recebidoEm: string | null;
    atual: boolean;
    equipes: UnidadeMapa[];
} {
    const atual = recebidoEm !== null && agora.getTime() - recebidoEm.getTime() < VALIDADE_MS;
    return { recebidoEm: recebidoEm ? recebidoEm.toISOString() : null, atual, equipes };
}
