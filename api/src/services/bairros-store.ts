// ═══════════════════════════════════════════════════════════════
// Bairros — persistência da distância materializada.
//
// Separado de bairros.ts porque importar `db` puxa o servidor inteiro: o
// teste do seed e da busca por nome roda sem banco e sem rede, como manda o
// resto do repo.
// ═══════════════════════════════════════════════════════════════

import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { bairroRotas } from "../db/schema.js";
import { BAIRROS } from "./bairros.js";

/**
 * Cria a tabela e materializa o seed. Mesmo padrão de initUpaRestrictions: o
 * deploy (labctl promote) não roda migrations, então garantir aqui evita que a
 * feature suba esperando um passo manual.
 *
 * Reescreve todas as linhas a cada boot. São ~1.200 upserts num único
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

    const linhas = BAIRROS.flatMap((b) =>
        Object.entries(b.rotas ?? {}).map(([hospitalId, [segundos, metros]]) => ({
            bairroKey: b.key,
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
            set: {
                segundos: sql`excluded.segundos`,
                metros: sql`excluded.metros`,
            },
        });
}

export interface Rota {
    hospitalId: string;
    segundos: number;
    metros: number;
}

/**
 * Tempos do bairro até cada hospital, do mais rápido ao mais lento.
 * Lista vazia = ilha sem rota rodoviária, ou bairro que não está no seed.
 */
export async function rotasDoBairro(bairroKey: string): Promise<Rota[]> {
    const linhas = await db
        .select({
            hospitalId: bairroRotas.hospitalId,
            segundos: bairroRotas.segundos,
            metros: bairroRotas.metros,
        })
        .from(bairroRotas)
        .where(sql`${bairroRotas.bairroKey} = ${bairroKey}`);

    return linhas.sort((a, b) => a.segundos - b.segundos);
}
