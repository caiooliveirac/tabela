// ═══════════════════════════════════════════════════════════════
// Bairros de Salvador — distância materializada.
//
// O tempo de carro de cada bairro até cada hospital é calculado UMA vez, fora
// do ar, e vive numa tabela do nosso Postgres. Em plantão o módulo não fala
// com o Google: consulta o próprio banco. Se a chave vencer, se a cota
// estourar ou se o link cair, o ranking continua respondendo.
//
// Fonte dos bairros: OpenStreetMap (183 bairros com centroide).
// Fonte dos tempos: Routes API do Google, 2026-08-23.
//
// Este módulo é puro: só o seed e a busca por nome. Quem fala com o banco é
// bairros-store.ts — separado justamente para o teste rodar sem subir o
// servidor, como destinosBot.ts já faz.
// Regerar: python3 scripts/gerar-bairros.py (precisa da chave; roda no Mac).
//
// Três bairros são ilhas na Baía de Todos os Santos — Maré, Frades e Bom
// Jesus dos Passos — e não têm rota rodoviária para hospital nenhum. Ficam no
// índice de nomes, sem rota, para o módulo poder dizer "aqui não é caso de
// ranking por tempo de carro" em vez de devolver lista vazia ou inventar
// ordem.
// ═══════════════════════════════════════════════════════════════

import dados from "../data/bairros-salvador.json" with { type: "json" };

export interface BairroSeed {
    nome: string;
    key: string;
    lat: number;
    lng: number;
    /** [segundos, metros] por hospital. Ausente nas ilhas. */
    rotas?: Record<string, [number, number]>;
    semRotaRodoviaria?: boolean;
}

export const BAIRROS = dados.bairros as BairroSeed[];
export const SEED_GERADO_EM = dados.geradoEm;

/**
 * Chave de busca: sem acento, sem pontuação, minúscula, espaço colapsado.
 * "São Caetano", "sao caetano" e "SAO  CAETANO." caem na mesma chave — é o
 * "bairro e variações dele" que a regulação digita às pressas.
 */
export function normalizar(texto: string): string {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // marcas combinantes soltas pelo NFD
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

const PORTIPO = new Map(BAIRROS.map((b) => [b.key, b]));

/**
 * Acha o bairro a partir do que foi digitado.
 *
 * Três tentativas, da mais segura para a mais frouxa: chave exata, bairro
 * contido no texto (para "Rua X, Pituba" cair na Pituba), e prefixo (para
 * "pitub" enquanto o regulador ainda digita). Ambiguidade devolve todos os
 * candidatos em vez de escolher um — quem decide é quem regula.
 */
export function acharBairro(texto: string): BairroSeed[] {
    const alvo = normalizar(texto);
    if (!alvo) return [];

    const exato = PORTIPO.get(alvo);
    if (exato) return [exato];

    const contido = BAIRROS.filter((b) => alvo.includes(b.key));
    if (contido.length) {
        // "Boca do Rio" contém "Rio"? Não neste índice, mas se um dia contiver,
        // o nome mais longo é o mais específico e ganha.
        const maior = Math.max(...contido.map((b) => b.key.length));
        return contido.filter((b) => b.key.length === maior);
    }

    return BAIRROS.filter((b) => b.key.startsWith(alvo));
}
