import { and, eq, lt, lte } from "drizzle-orm";
import { intel } from "../db/schema.js";
import { resetTs } from "./score.js";

const LOTADO_TTL_MS = 12 * 60 * 60 * 1000;
const AUTO_REMOVAL_ACTOR = "sistema";

export function isIntelExpired(
    row: { tipo: string; timestamp: Date; ativo: boolean },
    nowMs = Date.now()
): boolean {
    if (!row.ativo) return false;

    if (row.tipo === "sem_especialista") {
        return row.timestamp.getTime() < resetTs(nowMs);
    }

    if (row.tipo === "lotado") {
        return row.timestamp.getTime() <= nowMs - LOTADO_TTL_MS;
    }

    return false;
}

export async function expireStaleIntel(db: any, nowMs = Date.now()): Promise<void> {
    const now = new Date(nowMs);
    const currentShiftReset = new Date(resetTs(nowMs));
    const lotadoCutoff = new Date(nowMs - LOTADO_TTL_MS);

    await Promise.all([
        db
            .update(intel)
            .set({
                ativo: false,
                removidoPor: AUTO_REMOVAL_ACTOR,
                removidoEm: now,
            })
            .where(
                and(
                    eq(intel.ativo, true),
                    eq(intel.tipo, "sem_especialista"),
                    lt(intel.timestamp, currentShiftReset)
                )
            ),
        db
            .update(intel)
            .set({
                ativo: false,
                removidoPor: AUTO_REMOVAL_ACTOR,
                removidoEm: now,
            })
            .where(
                and(
                    eq(intel.ativo, true),
                    eq(intel.tipo, "lotado"),
                    lte(intel.timestamp, lotadoCutoff)
                )
            ),
    ]);
}