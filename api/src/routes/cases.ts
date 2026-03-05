import { Router, type Request, type Response } from "express";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../index.js";
import { cases } from "../db/schema.js";
import { broadcast } from "../ws/handler.js";

const router = Router();

const createCaseSchema = z.object({
  hospitalId: z.string().min(1),
  situacao: z.enum(["ACEITO", "ZERO"]),
  caso: z.string().optional().nullable(),
  mr: z.string().optional().nullable(),
  medico: z.string().optional().nullable(),
  oc: z.string().optional().nullable(),
  criadoPor: z.string().min(1, "Operador obrigatório"),
});

const removeCaseSchema = z.object({
  removidoPor: z.string().min(1, "Operador obrigatório"),
});

// GET /api/cases — últimas 24h, ativos e inativos
router.get("/", async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(cases)
      .where(gte(cases.timestamp, since))
      .orderBy(desc(cases.timestamp));
    res.json(rows);
  } catch (err) {
    console.error("GET /cases error:", err);
    res.status(500).json({ error: "Erro ao buscar casos" });
  }
});

// POST /api/cases — registrar novo caso
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = createCaseSchema.parse(req.body);
    const [row] = await db
      .insert(cases)
      .values({
        hospitalId: data.hospitalId,
        situacao: data.situacao,
        caso: data.caso || null,
        mr: data.mr || null,
        medico: data.medico || null,
        oc: data.oc || null,
        criadoPor: data.criadoPor,
      })
      .returning();
    broadcast({ type: "case:created", payload: row });
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("POST /cases error:", err);
    res.status(500).json({ error: "Erro ao criar caso" });
  }
});

// DELETE /api/cases/:id — soft delete (marca como inativo)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    const data = removeCaseSchema.parse(req.body);
    const [row] = await db
      .update(cases)
      .set({
        ativo: false,
        removidoPor: data.removidoPor,
        removidoEm: new Date(),
      })
      .where(and(eq(cases.id, id), eq(cases.ativo, true)))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Caso não encontrado ou já removido" });
      return;
    }

    broadcast({ type: "case:removed", payload: row });
    res.json(row);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("DELETE /cases error:", err);
    res.status(500).json({ error: "Erro ao remover caso" });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/cases/bulk-import — importar em massa da planilha
// Aceita timestamp customizado para preservar horário original
// Limpa casos do dia antes de importar (replace completo)
// ──────────────────────────────────────────────────────────────
const bulkImportSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato: YYYY-MM-DD"),
  operador: z.string().min(1),
  cases: z.array(
    z.object({
      hospitalId: z.string().min(1),
      horario: z.string().regex(/^\d{2}:\d{2}$/, "Formato: HH:MM"),
      situacao: z.enum(["ACEITO", "ZERO"]),
      caso: z.string().optional().nullable(),
      mr: z.string().optional().nullable(),
      medico: z.string().optional().nullable(),
      oc: z.string().optional().nullable(),
    })
  ).min(1),
});

router.post("/bulk-import", async (req: Request, res: Response) => {
  try {
    const data = bulkImportSchema.parse(req.body);
    const dateStr = data.date; // "2026-03-05"

    // Limpar todos os casos ativos do dia
    const dayStart = new Date(`${dateStr}T00:00:00-03:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59-03:00`);
    await db
      .delete(cases)
      .where(
        and(
          gte(cases.timestamp, dayStart),
          lte(cases.timestamp, dayEnd)
        )
      );

    // Inserir novos
    const rows = [];
    for (const c of data.cases) {
      const ts = new Date(`${dateStr}T${c.horario}:00-03:00`);
      const [row] = await db
        .insert(cases)
        .values({
          hospitalId: c.hospitalId,
          timestamp: ts,
          situacao: c.situacao,
          caso: c.caso || null,
          mr: c.mr || null,
          medico: c.medico || null,
          oc: c.oc || null,
          criadoPor: data.operador,
        })
        .returning();
      rows.push(row);
    }

    broadcast({ type: "refresh" });
    res.status(201).json({
      message: `Importados ${rows.length} casos para ${dateStr}`,
      count: rows.length,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("POST /cases/bulk-import error:", err);
    res.status(500).json({ error: "Erro na importação em massa" });
  }
});

export default router;
