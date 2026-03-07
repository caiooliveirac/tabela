import { Router, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../index.js";
import { intel } from "../db/schema.js";
import { broadcast } from "../ws/handler.js";
import { expireStaleIntel } from "../services/intel-policy.js";

const router = Router();

const createIntelSchema = z.object({
  hospitalId: z.string().min(1),
  tipo: z.enum([
    "lotado",
    "sem_especialista",
    "sem_recurso",
    "pretendo_enviar",
    "aceitando_bem",
    "normalizado",
  ]),
  nota: z.string().optional().nullable(),
  autor: z.string().min(1, "Operador obrigatório"),
});

const removeIntelSchema = z.object({
  removidoPor: z.string().min(1, "Operador obrigatório"),
});

// GET /api/intel — toda intel (ativa e inativa para histórico)
router.get("/", async (_req: Request, res: Response) => {
  try {
    await expireStaleIntel(db);

    const rows = await db
      .select()
      .from(intel)
      .orderBy(desc(intel.timestamp));
    res.json(rows);
  } catch (err) {
    console.error("GET /intel error:", err);
    res.status(500).json({ error: "Erro ao buscar intel" });
  }
});

// POST /api/intel — registrar nova intel
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = createIntelSchema.parse(req.body);
    const [row] = await db
      .insert(intel)
      .values({
        hospitalId: data.hospitalId,
        tipo: data.tipo,
        nota: data.nota || null,
        autor: data.autor,
      })
      .returning();
    broadcast({ type: "intel:created", payload: row });
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("POST /intel error:", err);
    res.status(500).json({ error: "Erro ao criar intel" });
  }
});

// DELETE /api/intel/:id — soft delete
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    const data = removeIntelSchema.parse(req.body);
    const [row] = await db
      .update(intel)
      .set({
        ativo: false,
        removidoPor: data.removidoPor,
        removidoEm: new Date(),
      })
      .where(and(eq(intel.id, id), eq(intel.ativo, true)))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Intel não encontrada ou já removida" });
      return;
    }

    broadcast({ type: "intel:removed", payload: row });
    res.json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("DELETE /intel error:", err);
    res.status(500).json({ error: "Erro ao remover intel" });
  }
});

export default router;
