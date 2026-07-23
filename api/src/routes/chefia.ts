import { Router, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../index.js";
import { chefiaAlerts } from "../db/schema.js";
import { broadcast } from "../ws/handler.js";
import {
    chefiaPinConfigured,
    verifyChefiaPin,
    checkPinRateLimit,
    registerPinFailure,
    registerPinSuccess,
} from "../lib/chefiaPin.js";

const router = Router();

function clientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || "unknown";
}

// Garante que a ação foi autorizada por um PIN de chefia válido.
// Responde e retorna false se bloqueada; retorna true para prosseguir.
function enforceChefiaPin(req: Request, res: Response, pin: string): boolean {
    const ip = clientIp(req);

    const rl = checkPinRateLimit(ip);
    if (!rl.ok) {
        res.status(429).json({
            error: `Muitas tentativas. Aguarde ${Math.ceil(rl.retryAfterMs / 1000)}s e tente de novo.`,
        });
        return false;
    }

    if (!chefiaPinConfigured()) {
        res.status(503).json({
            error: "PIN da chefia não configurado no servidor. Contate o administrador.",
        });
        return false;
    }

    if (!verifyChefiaPin(pin)) {
        registerPinFailure(ip);
        res.status(403).json({ error: "PIN incorreto." });
        return false;
    }

    registerPinSuccess(ip);
    return true;
}

// Nomes reservados/placeholder que não identificam uma pessoa real.
// Bloqueados no servidor para que exclusões/edições fiquem sempre atribuíveis,
// mesmo vindas de um frontend em cache ou de chamada direta à API.
const RESERVED_NAMES = ["sistema", "tutorial"];
const realName = (label: string) =>
    z
        .string()
        .trim()
        .min(1, `${label} obrigatório`)
        .refine(
            (v) => !RESERVED_NAMES.includes(v.toLowerCase()),
            `${label} inválido (nome reservado)`
        );

const createChefiaSchema = z.object({
    mensagem: z.string().min(1, "Mensagem obrigatória"),
    autor: realName("Nome"),
});

const updateChefiaSchema = z.object({
    mensagem: z.string().min(1, "Mensagem obrigatória"),
    autor: realName("Nome"),
    pin: z.string().min(1, "PIN obrigatório"),
});

const removeChefiaSchema = z.object({
    removidoPor: realName("Operador"),
    pin: z.string().min(1, "PIN obrigatório"),
});

// GET /api/chefia — todos os alertas ativos
router.get("/", async (_req: Request, res: Response) => {
    try {
        const rows = await db
            .select()
            .from(chefiaAlerts)
            .where(eq(chefiaAlerts.ativo, true))
            .orderBy(desc(chefiaAlerts.timestamp));
        res.json(rows);
    } catch (err) {
        console.error("GET /chefia error:", err);
        res.status(500).json({ error: "Erro ao buscar alertas da chefia" });
    }
});

// POST /api/chefia — criar alerta
router.post("/", async (req: Request, res: Response) => {
    try {
        const data = createChefiaSchema.parse(req.body);
        const [row] = await db
            .insert(chefiaAlerts)
            .values({
                mensagem: data.mensagem,
                autor: data.autor,
            })
            .returning();
        broadcast({ type: "chefia:created", payload: row });
        res.status(201).json(row);
    } catch (err) {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: err.errors });
            return;
        }
        console.error("POST /chefia error:", err);
        res.status(500).json({ error: "Erro ao criar alerta da chefia" });
    }
});

// DELETE /api/chefia/:id — soft delete
router.delete("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: "ID inválido" });
            return;
        }
        const data = removeChefiaSchema.parse(req.body);
        if (!enforceChefiaPin(req, res, data.pin)) return;
        const [row] = await db
            .update(chefiaAlerts)
            .set({
                ativo: false,
                removidoPor: data.removidoPor,
                removidoEm: new Date(),
            })
            .where(and(eq(chefiaAlerts.id, id), eq(chefiaAlerts.ativo, true)))
            .returning();

        if (!row) {
            res.status(404).json({ error: "Alerta não encontrado ou já removido" });
            return;
        }

        broadcast({ type: "chefia:removed", payload: row });
        res.json(row);
    } catch (err) {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: err.errors });
            return;
        }
        console.error("DELETE /chefia error:", err);
        res.status(500).json({ error: "Erro ao remover alerta da chefia" });
    }
});

// PATCH /api/chefia/:id — editar alerta
router.patch("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) {
            res.status(400).json({ error: "ID inválido" });
            return;
        }
        const data = updateChefiaSchema.parse(req.body);
        if (!enforceChefiaPin(req, res, data.pin)) return;
        const [row] = await db
            .update(chefiaAlerts)
            .set({
                mensagem: data.mensagem,
                autor: data.autor,
            })
            .where(and(eq(chefiaAlerts.id, id), eq(chefiaAlerts.ativo, true)))
            .returning();

        if (!row) {
            res.status(404).json({ error: "Alerta não encontrado" });
            return;
        }

        broadcast({ type: "chefia:updated", payload: row });
        res.json(row);
    } catch (err) {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: err.errors });
            return;
        }
        console.error("PATCH /chefia error:", err);
        res.status(500).json({ error: "Erro ao editar alerta da chefia" });
    }
});

export default router;
