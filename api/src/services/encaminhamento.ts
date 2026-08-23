// ═══════════════════════════════════════════════════════════════
// Encaminhamento — qual hospital pode receber ESTE paciente.
//
// Camada clínica do módulo: filtro duro, categórico, anterior a qualquer
// conta de distância. Hospital fora da lista do perfil não entra no ranking
// nem se a ocorrência for na porta dele.
//
// O modelo é lista explícita por perfil, não matriz de recursos booleanos.
// Foi assim que a regulação ditou ("trauma é HGE, Subúrbio ou Municipal") e
// é assim que um médico consegue conferir. Derivar a lista a partir de flags
// de recurso acrescentaria uma inferência que ninguém pediu e que poderia
// errar em silêncio.
//
// Fonte: docs/encaminhamento-modulo.md. Mudança aqui é mudança de pactuação:
// só entra com quem regula dizendo, nunca por dedução do código.
// ═══════════════════════════════════════════════════════════════

import { HOSPITALS } from "./score.js";

/**
 * Os hospitais que este módulo ranqueia.
 *
 * O painel tem 11; quatro ficam de fora por decisão da regulação, não por
 * falta de dado: Menandro não participa da feature, e Juliano Moreira, Mário
 * Leal e Couto Maia saem junto com os perfis psiquiátrico e infeccioso, que
 * não entram neste fluxo. Eles continuam normais no resto do painel — só não
 * aparecem aqui, nem como elegíveis nem como excluídos, porque repetir
 * "não participa" em todo ranking seria ruído.
 */
export const HOSPITAIS_NA_FEATURE = [
    "hge",
    "hgrs",
    "hgesf",
    "metropolitano",
    "suburbio",
    "eladio",
    "municipal",
] as const;

export interface PerfilDef {
    id: string;
    label: string;
    /** Hospitais elegíveis. Sem ordem: quem ordena é a distância. */
    destinos: string[];
    /**
     * Ressalva por hospital — informação que o módulo não sabe julgar e por
     * isso devolve ao regulador em vez de decidir por baixo dela.
     */
    ressalvas?: Record<string, string>;
}

const ORTO_MUNICIPAL =
    "Material ortopédico incompleto — confirmar qual é a lesão antes de acionar";

export const PERFIS: PerfilDef[] = [
    // ── Trauma ──
    // Metropolitano entra no trauma geral, mas não tem vascular nem opera
    // fratura exposta: os dois viram perfil próprio para o veto ser explícito
    // em vez de virar nota de rodapé que ninguém lê no plantão.
    {
        id: "trauma",
        label: "Trauma",
        destinos: ["hge", "suburbio", "municipal", "metropolitano"],
        ressalvas: {
            municipal: ORTO_MUNICIPAL,
            metropolitano: "Não opera fratura exposta nem lesão vascular",
        },
    },
    {
        id: "trauma_vascular",
        label: "Trauma com suspeita de lesão vascular",
        destinos: ["suburbio", "hge"],
    },
    {
        id: "fratura_exposta",
        label: "Fratura exposta",
        destinos: ["hge", "suburbio", "municipal"],
        ressalvas: { municipal: ORTO_MUNICIPAL },
    },
    {
        id: "trauma_pediatrico",
        label: "Trauma pediátrico",
        destinos: ["hge", "suburbio", "municipal"],
        ressalvas: {
            hge: "Sem fratura cirúrgica pediátrica — se houver, é Subúrbio",
            municipal: "Sem fratura cirúrgica pediátrica — se houver, é Subúrbio",
        },
    },
    {
        id: "fratura_cirurgica_pediatrica",
        label: "Fratura cirúrgica pediátrica",
        destinos: ["suburbio"],
    },
    {
        id: "queimado",
        label: "Queimado",
        destinos: ["hge"],
    },

    // ── Cardiológico ──
    // Municipal é bloqueado em TODO perfil cardiológico, não só no IAM.
    // Metropolitano não tem hemodinâmica: fica no sem supra, sai do com supra.
    {
        id: "iam_com_supra",
        label: "IAM com supra / suspeita de oclusão coronariana",
        destinos: ["hgrs"],
    },
    {
        id: "iam_sem_supra",
        label: "IAM sem supra",
        destinos: ["hgrs", "hgesf", "eladio", "metropolitano", "suburbio"],
    },
    {
        id: "cardiologico",
        label: "Cardiológico (demais quadros)",
        destinos: ["hgrs", "hgesf", "eladio", "metropolitano", "suburbio"],
    },

    // ── Clínico e cirúrgico ──
    {
        id: "avc",
        label: "AVC",
        destinos: ["hgrs", "suburbio", "municipal", "metropolitano"],
    },
    {
        id: "hemorragia_digestiva",
        label: "Hemorragia digestiva",
        destinos: ["hgrs", "suburbio", "municipal", "metropolitano"],
    },
    {
        id: "cirurgico_nao_trauma",
        label: "Cirúrgico não-trauma",
        destinos: ["suburbio", "municipal", "hgesf", "metropolitano"],
        ressalvas: { municipal: ORTO_MUNICIPAL },
    },
    {
        id: "cirurgico_vascular",
        label: "Cirúrgico vascular (não-trauma)",
        destinos: ["suburbio", "hgrs", "hgesf"],
    },
    {
        id: "clinico_alta_complexidade",
        label: "Clínico de alta complexidade",
        destinos: ["suburbio", "municipal", "hgesf", "metropolitano"],
        ressalvas: { hgesf: "Complexidade média; sem neurocirurgia e sem hemodinâmica" },
    },
    {
        id: "cronico_sepse_paliacao",
        label: "Crônico, sepse ou paliação",
        destinos: ["eladio", "metropolitano"],
    },
    {
        id: "clinica_pediatrica",
        label: "Clínica pediátrica",
        destinos: ["hgrs", "suburbio", "municipal"],
    },
    {
        id: "intoxicacao",
        label: "Intoxicação",
        destinos: ["eladio", "hgesf", "municipal", "suburbio", "hgrs", "metropolitano"],
    },
];

export interface Elegivel {
    hospitalId: string;
    ressalva?: string;
}

export interface Excluido {
    hospitalId: string;
    motivo: string;
}

export interface Encaminhamento {
    perfil: PerfilDef;
    elegiveis: Elegivel[];
    excluidos: Excluido[];
}

export class PerfilDesconhecido extends Error {}

/**
 * Parte os hospitais da feature em elegíveis e excluídos para um perfil.
 *
 * Todo hospital sai em um dos dois lados, e o excluído sempre leva motivo: o
 * painel precisa poder mostrar por que um hospital não apareceu. Sumir calado
 * seria indistinguível de bug, e o regulador ficaria sem saber se confia na
 * lista.
 */
export function encaminhar(perfilId: string): Encaminhamento {
    const perfil = PERFIS.find((p) => p.id === perfilId);
    if (!perfil) throw new PerfilDesconhecido(`Perfil desconhecido: ${perfilId}`);

    const elegiveis: Elegivel[] = [];
    const excluidos: Excluido[] = [];

    for (const id of HOSPITAIS_NA_FEATURE) {
        if (perfil.destinos.includes(id)) {
            const ressalva = perfil.ressalvas?.[id];
            elegiveis.push(ressalva ? { hospitalId: id, ressalva } : { hospitalId: id });
        } else {
            // Sem toLowerCase: destruiria as siglas clínicas ("IAM" → "iam").
            excluidos.push({
                hospitalId: id,
                motivo: `Não é destino de ${perfil.label}`,
            });
        }
    }

    return { perfil, elegiveis, excluidos };
}

/** Nome de exibição, vindo da mesma fonte que o resto do painel usa. */
export function nomeHospital(id: string): string {
    return HOSPITALS.find((h) => h.id === id)?.name ?? id;
}

// ═══════════════════════════════════════════════════════════════
// Coordenadas — origem do cálculo de distância.
//
// Resolvidas pela Geocoding API do Google em 2026-08-23 e conferidas uma a
// uma contra o endereço devolvido. `precisao` guarda o location_type que o
// Google deu, porque a diferença importa: ROOFTOP é o prédio, GEOMETRIC_CENTER
// é o meio da rua. Ficam fixas no código de propósito — hospital não muda de
// lugar, e geocodificar destino a cada consulta seria pagar por uma resposta
// que já sabemos.
// ═══════════════════════════════════════════════════════════════

export interface Coordenada {
    lat: number;
    lng: number;
    /** Endereço que o Google casou — é o que foi conferido, não o que pedimos. */
    endereco: string;
    precisao: "ROOFTOP" | "GEOMETRIC_CENTER";
}

export const COORDENADAS: Record<string, Coordenada> = {
    hge: {
        lat: -12.995065,
        lng: -38.488655,
        endereco: "Av. Vasco da Gama, s/n — Brotas, Salvador/BA, 40286-901",
        precisao: "ROOFTOP",
    },
    hgrs: {
        lat: -12.955444,
        lng: -38.450595,
        endereco: "Rua Direta do Saboeiro, s/n — Cabula, Salvador/BA, 41180-780",
        precisao: "ROOFTOP",
    },
    hgesf: {
        lat: -12.958674,
        lng: -38.486511,
        endereco: "Praça Conselheiro João Alfredo, s/n — Pau Miúdo, Salvador/BA, 40301-155",
        precisao: "ROOFTOP",
    },
    metropolitano: {
        lat: -12.853579,
        lng: -38.349695,
        endereco: "Estr. Quengoma, s/n — Jardim Castelão, Lauro de Freitas/BA, 42700-000",
        precisao: "ROOFTOP",
    },
    suburbio: {
        lat: -12.864858,
        lng: -38.456783,
        endereco: "Rua Manuel Lino, 141 — Periperi, Salvador/BA, 40720-460",
        precisao: "ROOFTOP",
    },
    eladio: {
        // O Google não indexa este hospital como ponto: toda variante de nome
        // cai no bairro. Resolvido pelo endereço da rua, o que dá o centro da
        // via em vez do prédio. ~150 m de erro, irrelevante para ordenar por
        // tempo de carro. ponytail: sobe para ROOFTOP se a Places API entrar.
        lat: -12.888254,
        lng: -38.422068,
        endereco: "R. Cel. Azevedo, s/n — Cajazeiras II, Salvador/BA, 41332-010",
        precisao: "GEOMETRIC_CENTER",
    },
    municipal: {
        lat: -12.897967,
        lng: -38.390374,
        endereco: "R. Ver. Zezéu Ribeiro, s/n — Cajazeiras, Salvador/BA, 41347-000",
        precisao: "ROOFTOP",
    },
};
