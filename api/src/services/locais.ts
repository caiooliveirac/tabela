// ═══════════════════════════════════════════════════════════════
// Lugares de Salvador — busca por nome.
//
// "Lugar" é mais que bairro. A regulação não fala a divisão oficial: fala
// largo, estação, terminal, rótula e apelido. Salvador tem 182 bairros aqui,
// e outros 109 pontos que as pessoas tratam como se fossem bairro.
//
// Fontes (ver scripts/gerar-locais.py): geografia do OpenStreetMap,
// referências curadas geocodificadas no Google, e apelidos escritos à mão.
//
// Este módulo é puro: só o seed e a busca. Quem fala com o banco é
// locais-store.ts — separado para o teste rodar sem subir o servidor, como
// destinosBot.ts já faz.
//
// Os povoados das ilhas da Baía de Todos os Santos não têm rota rodoviária
// para hospital nenhum. Ficam no índice, sem rota, para o módulo poder dizer
// "aqui não é caso de ranking por tempo de carro" em vez de devolver lista
// vazia ou inventar ordem.
// ═══════════════════════════════════════════════════════════════

import dados from "../data/locais-salvador.json" with { type: "json" };

export type TipoLocal =
    | "bairro"
    | "localidade"
    | "largo"
    | "estacao"
    | "terminal"
    | "ilha"
    | "referencia";

export interface Local {
    nome: string;
    key: string;
    tipo: TipoLocal;
    lat: number;
    lng: number;
    /** [segundos, metros] por hospital. Ausente nos povoados sem estrada. */
    rotas?: Record<string, [number, number]>;
    semRotaRodoviaria?: boolean;
}

export const LOCAIS = dados.locais as Local[];
/** Apelido → chave do lugar real. "iguatemi" continua sendo o Shopping da Bahia. */
export const APELIDOS = dados.apelidos as Record<string, string>;
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

const POR_CHAVE = new Map(LOCAIS.map((l) => [l.key, l]));

/**
 * Índice de busca: toda chave de lugar e todo apelido apontando para o mesmo
 * objeto. Unificar aqui faz as três estratégias abaixo valerem para apelido
 * também, sem repetir a lógica.
 */
const INDICE = new Map<string, Local>(POR_CHAVE);
for (const [apelido, alvo] of Object.entries(APELIDOS)) {
    const local = POR_CHAVE.get(alvo);
    if (local) INDICE.set(apelido, local);
}
const TERMOS = [...INDICE.keys()];

/**
 * Acha o lugar a partir do que foi digitado.
 *
 * Três tentativas, da mais segura para a mais frouxa: termo exato, termo
 * contido no texto (para "Rua X, 200, Pituba" cair na Pituba), e prefixo (para
 * "pitub" enquanto o regulador ainda digita). Ambiguidade devolve todos os
 * candidatos em vez de escolher um — quem decide é quem regula.
 *
 * No caso "contido", o termo mais longo vence: quem digita "Boa Vista de
 * Brotas" quer aquilo, não Brotas.
 */
export function acharLocal(texto: string): Local[] {
    const alvo = normalizar(texto);
    if (!alvo) return [];

    const exato = INDICE.get(alvo);
    if (exato) return [exato];

    const contidos = TERMOS.filter((t) => alvo.includes(t));
    if (contidos.length) {
        const maior = Math.max(...contidos.map((t) => t.length));
        return unicos(contidos.filter((t) => t.length === maior).map((t) => INDICE.get(t)!));
    }

    return unicos(TERMOS.filter((t) => t.startsWith(alvo)).map((t) => INDICE.get(t)!));
}

/** Um lugar alcançado por dois termos (nome e apelido) é um resultado só. */
function unicos(achados: Local[]): Local[] {
    const vistos = new Set<string>();
    return achados.filter((l) => !vistos.has(l.key) && vistos.add(l.key));
}

/**
 * Lugar conhecido mais próximo de um ponto, com a distância em linha reta.
 *
 * É como o clique no mapa vira ranking sem chamar o Google: em vez de calcular
 * a rota do ponto exato, reusa a rota já materializada do lugar mais próximo.
 * Só considera lugar COM rota — encaixar num povoado de ilha devolveria uma
 * lista sem tempo nenhum, que é pior que encaixar longe.
 *
 * A distância volta junto de propósito. O encaixe é uma aproximação, e a
 * mediana de 406 m esconde a periferia: Valéria e Cassange têm o vizinho a
 * mais de 2 km. Quem regula precisa VER o quanto foi aproximado para julgar,
 * em vez de receber um ranking que finge precisão que não tem.
 */
export function localMaisProximo(
    lat: number,
    lng: number,
): { local: Local; metros: number } | null {
    let achado: Local | null = null;
    let menor = Infinity;
    for (const l of LOCAIS) {
        if (l.semRotaRodoviaria) continue;
        const d = distanciaEmMetros(lat, lng, l.lat, l.lng);
        if (d < menor) {
            menor = d;
            achado = l;
        }
    }
    return achado ? { local: achado, metros: Math.round(menor) } : null;
}

/** Haversine. Salvador cabe em poucos quilômetros — a curvatura mal aparece,
 *  mas usar a fórmula certa custa o mesmo que usar a errada. */
function distanciaEmMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
