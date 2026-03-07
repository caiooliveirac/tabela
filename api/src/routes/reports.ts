import { Router, type Request, type Response } from "express";
import { and, desc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../index.js";
import { cases, intel, chefiaAlerts } from "../db/schema.js";
import { buildReport, renderReportHtml, renderReportMarkdown } from "../services/report.js";
import { expireStaleIntel } from "../services/intel-policy.js";

const router = Router();
const REPORT_TIME_ZONE = "America/Bahia";

const reportSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  turno: z.enum(["diurno", "noturno"]),
  responsavel: z.string().min(1, "Responsável obrigatório"),
  observacoes: z.string().optional().default(""),
  incluirCasosDetalhados: z.boolean().optional().default(true),
  incluirAlertasQualitativos: z.boolean().optional().default(true),
  incluirAlertasChefia: z.boolean().optional().default(true),
  incluirLinhaDoTempo: z.boolean().optional().default(true),
});

const downloadSchema = reportSchema.extend({
  format: z.enum(["html", "markdown"]),
});

function fileBaseName(startAt: string, turno: "diurno" | "noturno"): string {
  const d = new Date(startAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const yyyy = parts.find((part) => part.type === "year")?.value ?? String(d.getUTCFullYear());
  const mm = parts.find((part) => part.type === "month")?.value ?? String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = parts.find((part) => part.type === "day")?.value ?? String(d.getUTCDate()).padStart(2, "0");
  return `relatorio-plantao-${yyyy}-${mm}-${dd}-${turno}`;
}

async function loadPeriodData(startAt: string, endAt: string) {
  await expireStaleIntel(db);

  const start = new Date(startAt);
  const end = new Date(endAt);
  const [allCases, allIntel, allChefia] = await Promise.all([
    db.select().from(cases).where(and(gte(cases.timestamp, start), lte(cases.timestamp, end))).orderBy(desc(cases.timestamp)),
    db.select().from(intel).where(and(gte(intel.timestamp, start), lte(intel.timestamp, end))).orderBy(desc(intel.timestamp)),
    db.select().from(chefiaAlerts).where(and(gte(chefiaAlerts.timestamp, start), lte(chefiaAlerts.timestamp, end))).orderBy(desc(chefiaAlerts.timestamp)),
  ]);
  return { allCases, allIntel, allChefia };
}

router.post("/preview", async (req: Request, res: Response) => {
  try {
    const data = reportSchema.parse(req.body);
    const { allCases, allIntel, allChefia } = await loadPeriodData(data.startAt, data.endAt);
    const report = buildReport(data, allCases, allIntel, allChefia);
    const html = renderReportHtml(report, data);
    const markdown = renderReportMarkdown(report, data);
    res.json({
      fileBaseName: fileBaseName(data.startAt, data.turno),
      report,
      html,
      markdown,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("POST /reports/preview error:", err);
    res.status(500).json({ error: "Erro ao gerar preview do relatório" });
  }
});

router.post("/download", async (req: Request, res: Response) => {
  try {
    const data = downloadSchema.parse(req.body);
    const { allCases, allIntel, allChefia } = await loadPeriodData(data.startAt, data.endAt);
    const report = buildReport(data, allCases, allIntel, allChefia);
    const base = fileBaseName(data.startAt, data.turno);
    if (data.format === "html") {
      const html = renderReportHtml(report, data);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.html"`);
      res.send(html);
      return;
    }
    const markdown = renderReportMarkdown(report, data);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.md"`);
    res.send(markdown);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("POST /reports/download error:", err);
    res.status(500).json({ error: "Erro ao baixar relatório" });
  }
});

export default router;
