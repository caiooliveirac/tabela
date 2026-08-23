// ═══════════════════════════════════════════════════════════════
// Lugares — persistência da distância materializada.
//
// Separado de locais.ts porque importar `db` puxa o servidor inteiro: o teste
// do seed e da busca por nome roda sem banco e sem rede, como manda o resto
// do repo.
//
// A tabela chama `bairro_rotas` por história: nasceu quando o módulo só
// conhecia bairros. Hoje guarda largo, estação, terminal e referência também.
// Renomear custaria um DDL em produção e uma tabela órfã para ganhar só
// estética — a coluna é `bairro_key`, mas o que ela guarda é chave de lugar.
// ═══════════════════════════════════════════════════════════════

import { notInArray, sql } from "drizzle-orm";
import { db } from "../index.js";
import { bairroRotas } from "../db/schema.js";
import { LOCAIS } from "./locais.js";

/**
 * Cria a tabela e materializa o seed. Mesmo padrão de initUpaRestrictions: o
 * deploy (labctl promote) não roda migrations, então garantir aqui evita que a
 * feature suba esperando um passo manual.
 *
 * Reescreve todas as linhas a cada boot. São ~1.900 upserts num único
 * statement: mais barato do que versionar o seed, e deixa banco e arquivo
 * committado sempre iguais sem ninguém precisar lembrar de rodar nada.
 */
export async function initBairroRotas(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS bairro_rotas (
            bairro_key  varchar(120) NOT NULL,
            hospital_id varchar(50)  NOT NULL,
            segundos    integer      NOT NULL,
            metros      integer      NOT NULL,
            PRIMARY KEY (bairro_key, hospital_id)
        )
    `);

    const linhas = LOCAIS.flatMap((l) =>
        Object.entries(l.rotas ?? {}).map(([hospitalId, [segundos, metros]]) => ({
            bairroKey: l.key,
            hospitalId,
            segundos,
            metros,
        })),
    );
    if (!linhas.length) return;

    await db
        .insert(bairroRotas)
        .values(linhas)
        .onConflictDoUpdate({
            target: [bairroRotas.bairroKey, bairroRotas.hospitalId],
            set: { segundos: sql`excluded.segundos`, metros: sql`excluded.metros` },
        });

    // Lugar que saiu do seed (renomeado no OSM, ou barrado pela denylist) não
    // pode ficar respondendo do banco com dado velho. Parametrizado pelo
    // drizzle: montar a lista por concatenação de string seria injeção de SQL
    // esperando um nome de bairro com aspas.
    await db.delete(bairroRotas).where(
        notInArray(bairroRotas.bairroKey, LOCAIS.map((l) => l.key)),
    );
}

export interface Rota {
    hospitalId: string;
    segundos: number;
    metros: number;
}

/**
 * Tempos do lugar até cada hospital, do mais rápido ao mais lento.
 * Lista vazia = povoado sem rota rodoviária, ou lugar fora do seed.
 */
export async function rotasDoLocal(localKey: string): Promise<Rota[]> {
    const linhas = await db
        .select({
            hospitalId: bairroRotas.hospitalId,
            segundos: bairroRotas.segundos,
            metros: bairroRotas.metros,
        })
        .from(bairroRotas)
        .where(sql`${bairroRotas.bairroKey} = ${localKey}`);

    return linhas.sort((a, b) => a.segundos - b.segundos);
}
