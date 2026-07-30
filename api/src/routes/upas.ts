// ═══════════════════════════════════════════════════════════════
// Restrição de UPA — API.
//
// GET é público (o painel inteiro é aberto aos reguladores e o bot Plantões
// SAMU lê daqui). Escrita exige PIN da chefia, como os alertas de chefia.
// ═══════════════════════════════════════════════════════════════
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { broadcast } from "../ws/handler.js";
import { enforceChefiaPin, realName } from "../lib/chefiaGuard.js";
import {
    InvalidRestrictionDeadline,
    formatDeadline,
    liberateRestriction,
    listActiveRestrictions,
    parseRestrictionDeadline,
    restrictUnit,
    type UpaRestriction,
} from "../services/upa-restrictions.js";
import { announceRestrictionChange } from "../lib/upaRestrictionsBot.js";

const router = Router();

/**
 * Formato do contrato com os consumidores externos (bot Plantões SAMU e o
 * próprio painel): instante ISO cru para quem quer calcular, mais o rótulo já
 * pronto no fuso de Salvador para quem só quer exibir.
 */
function toPublicRestriction(row: UpaRestriction, now: Date) {
    return {
        id: row.id,
        unitKey: row.unitKey,
        unitName: row.unitName,
        until: row.restrictedUntil.toISOString(),
        untilLabel: formatDeadline(row.restrictedUntil, now),
        autor: row.autor,
        since: row.timestamp.toISOString(),
    };
}

const createSchema = z.object({
    unitKey: z.string().trim().min(1, "Unidade obrigatória").max(120),
    unitName: z.string().trim().min(1, "Nome da unidade obrigatório").max(160),
    until: z.string().min(1, "Prazo obrigatório"),
    autor: realName("Nome da chefia"),
    pin: z.string().min(1, "PIN obrigatório"),
});

const removeSchema = z.object({
    removidoPor: realName("Nome da chefia"),
    pin: z.string().min(1, "PIN obrigatório"),
});

// GET /tabela/api/upas/restrictions — restrições vigentes agora
router.get("/restrictions", async (_req: Request, res: Response) => {
    try {
        const now = new Date();
        const rows = await listActiveRestrictions(now);
        res.json({
            ok: true,
            generatedAt: now.toISOString(),
            restrictions: rows.map((row) => toPublicRestriction(row, now)),
        });
    } catch (err) {
        console.error("GET /upas/restrictions error:", err);
        res.status(500).json({ ok: false, error: "Erro ao buscar restrições de UPA" });
    }
});

// POST /tabela/api/upas/restrictions — restringir (ou renovar o prazo)
router.post("/restrictions", async (req: Request, res: Response) => {
    try {
        const data = createSchema.parse(req.body);
        if (!(await enforceChefiaPin(req, res, data.pin))) return;

        const now = new Date();
        const until = parseRestrictionDeadline(data.until, now);
        const { row, renewed } = await restrictUnit({
            unitKey: data.unitKey,
            unitName: data.unitName,
            until,
            autor: data.autor,
            now,
        });

        const payload = toPublicRestriction(row, now);
        broadcast({ type: "upa-restriction:changed", payload });
        // Aviso imediato no grupo dos reguladores — fail-soft: se o Telegram
        // estiver fora, a restrição continua valendo no painel.
        void announceRestrictionChange({ row, kind: renewed ? "renewed" : "created", now });

        res.status(renewed ? 200 : 201).json(payload);
    } catch (err) {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: err.errors });
            return;
        }
        if (err instanceof InvalidRestrictionDeadline) {
            res.status(400).json({ error: err.message });
            return;
        }
        console.error("POST /upas/restrictions error:", err);
        res.status(500).json({ error: "Erro ao restringir a UPA" });
    }
});

// DELETE /tabela/api/upas/restrictions/:id — liberar antes do prazo
router.delete("/restrictions/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: "ID inválido" });
            return;
        }

        const data = removeSchema.parse(req.body);
        if (!(await enforceChefiaPin(req, res, data.pin))) return;

        const row = await liberateRestriction(id, data.removidoPor);
        if (!row) {
            res.status(404).json({ error: "Restrição não encontrada ou já liberada" });
            return;
        }

        const now = new Date();
        const payload = toPublicRestriction(row, now);
        broadcast({ type: "upa-restriction:changed", payload });
        void announceRestrictionChange({ row, kind: "liberated", now });

        res.json(payload);
    } catch (err) {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: err.errors });
            return;
        }
        console.error("DELETE /upas/restrictions error:", err);
        res.status(500).json({ error: "Erro ao liberar a UPA" });
    }
});

export default router;
