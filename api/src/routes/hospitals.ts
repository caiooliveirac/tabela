import { Router, type Request, type Response } from "express";
import { gte, desc } from "drizzle-orm";
import { db } from "../index.js";
import { cases, intel } from "../db/schema.js";
import { compute, resetTs, HOSPITALS } from "../services/score.js";
import { expireStaleIntel } from "../services/intel-policy.js";

const router = Router();

// GET /api/hospitals — lista hospitais com scores calculados
router.get("/", async (_req: Request, res: Response) => {
  try {
    await expireStaleIntel(db);

    const rst = resetTs();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [allCases, allIntel] = await Promise.all([
      db.select().from(cases).where(gte(cases.timestamp, since)).orderBy(desc(cases.timestamp)),
      db.select().from(intel).orderBy(desc(intel.timestamp)),
    ]);

    const { hospitalData, timelineCases } = compute(allCases, allIntel, rst);

    res.json({
      hospitals: hospitalData,
      timelineCases,
      resetTimestamp: rst,
    });
  } catch (err) {
    console.error("GET /hospitals error:", err);
    res.status(500).json({ error: "Erro ao calcular scores" });
  }
});

// GET /api/hospitals/list — lista simples de hospitais (sem scores)
router.get("/list", (_req: Request, res: Response) => {
  res.json(HOSPITALS);
});

export default router;
