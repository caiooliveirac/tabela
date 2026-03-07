import { HOSPITALS } from "./score.js";

const REPORT_TIME_ZONE = "America/Bahia";
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: REPORT_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: REPORT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});
const hourFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
});

export interface ReportCaseRow {
    id: number;
    hospitalId: string;
    timestamp: Date;
    situacao: string;
    caso: string | null;
    mr: string | null;
    medico: string | null;
    oc: string | null;
    ativo: boolean;
    removidoPor: string | null;
    removidoEm: Date | null;
    criadoPor: string;
}

export interface ReportIntelRow {
    id: number;
    hospitalId: string;
    tipo: string;
    nota: string | null;
    autor: string;
    timestamp: Date;
    ativo: boolean;
    removidoPor: string | null;
    removidoEm: Date | null;
}

export interface ReportChefiaRow {
    id: number;
    mensagem: string;
    autor: string;
    timestamp: Date;
    ativo: boolean;
    removidoPor: string | null;
    removidoEm: Date | null;
}

export interface ReportRequestData {
    startAt: string;
    endAt: string;
    turno: "diurno" | "noturno";
    responsavel: string;
    observacoes?: string;
    incluirCasosDetalhados?: boolean;
    incluirAlertasQualitativos?: boolean;
    incluirAlertasChefia?: boolean;
    incluirLinhaDoTempo?: boolean;
}

interface ReportHospitalSummary {
    hospitalId: string;
    hospitalNome: string;
    categoria: "geral" | "psiq" | "infecto";
    total: number;
    aceitos: number;
    zeros: number;
    taxaAceite: number | null;
    ultimoEvento: Date | null;
    ultimoAceite: Date | null;
    ultimoZero: Date | null;
    intelCount: number;
    intelResumo: string[];
}

interface ReportTimelineItem {
    kind: "case" | "intel" | "chefia";
    timestamp: Date;
    title: string;
    subtitle: string;
    severity: "info" | "success" | "warning" | "danger";
}

interface ReportFlowBucket {
    hour: number;
    label: string;
    total: number;
    aceitos: number;
    zeros: number;
}

export interface GeneratedReport {
    meta: {
        startAt: string;
        endAt: string;
        turno: "diurno" | "noturno";
        responsavel: string;
        observacoes: string;
        generatedAt: string;
    };
    summary: {
        totalRegulacoes: number;
        totalAceitos: number;
        totalVagasZero: number;
        taxaAceite: number;
        hospitaisAcionados: number;
        hospitaisComZero: number;
        totalIntel: number;
        totalChefia: number;
        totalRemovidos: number;
        hospitalMaisAcionado: string | null;
        hospitalMaisZero: string | null;
        mediaRegulacoesPorHora: number;
        janelaPico: {
            faixa: string | null;
            total: number;
            aceitos: number;
            zeros: number;
        };
        primeiraRegulacao: string | null;
        ultimaRegulacao: string | null;
    };
    highlights: string[];
    flowByHour: ReportFlowBucket[];
    hospitals: ReportHospitalSummary[];
    timeline: ReportTimelineItem[];
    cases: ReportCaseRow[];
    intel: ReportIntelRow[];
    chefia: ReportChefiaRow[];
}

function fmtDateTime(ts: Date): string {
    return dateTimeFormatter.format(ts);
}

function fmtOnlyTime(ts: Date): string {
    return timeFormatter.format(ts);
}

function getReportHour(ts: Date): number {
    return Number(hourFormatter.format(ts));
}

function fmtHourLabel(hour: number): string {
    return `${String(hour).padStart(2, "0")}h–${String((hour + 1) % 24).padStart(2, "0")}h`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function pct(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 100);
}

function flowBar(width: number, color: string): string {
    return `<div style="height:10px;border-radius:999px;background:${color};width:${Math.max(width, 4)}%"></div>`;
}

const hospitalMap = new Map(HOSPITALS.map((h) => [h.id, h]));

export function buildReport(
    request: ReportRequestData,
    allCases: ReportCaseRow[],
    allIntel: ReportIntelRow[],
    allChefia: ReportChefiaRow[]
): GeneratedReport {
    const cases = [...allCases].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const intel = [...allIntel].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const chefia = [...allChefia].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const hospitals = HOSPITALS.map((hospital) => {
        const hospitalCases = cases.filter((c) => c.hospitalId === hospital.id);
        const hospitalIntel = intel.filter((i) => i.hospitalId === hospital.id);
        const aceitos = hospitalCases.filter((c) => c.situacao === "ACEITO").length;
        const zeros = hospitalCases.filter((c) => c.situacao === "ZERO").length;
        const ultimoEvento = hospitalCases[0]?.timestamp ?? null;
        const ultimoAceite = hospitalCases.find((c) => c.situacao === "ACEITO")?.timestamp ?? null;
        const ultimoZero = hospitalCases.find((c) => c.situacao === "ZERO")?.timestamp ?? null;

        return {
            hospitalId: hospital.id,
            hospitalNome: hospital.name,
            categoria: hospital.cat,
            total: hospitalCases.length,
            aceitos,
            zeros,
            taxaAceite: hospitalCases.length > 0 ? pct(aceitos, hospitalCases.length) : null,
            ultimoEvento,
            ultimoAceite,
            ultimoZero,
            intelCount: hospitalIntel.length,
            intelResumo: hospitalIntel.slice(0, 3).map((i) => `${i.tipo}${i.nota ? `: ${i.nota}` : ""}`),
        };
    }).sort((a, b) => b.total - a.total || a.hospitalNome.localeCompare(b.hospitalNome));

    const flowMap = new Map<number, ReportFlowBucket>();
    for (const c of cases) {
        const hour = getReportHour(c.timestamp);
        const current = flowMap.get(hour) ?? { hour, label: fmtHourLabel(hour), total: 0, aceitos: 0, zeros: 0 };
        current.total += 1;
        if (c.situacao === "ACEITO") current.aceitos += 1;
        if (c.situacao === "ZERO") current.zeros += 1;
        flowMap.set(hour, current);
    }

    const flowByHour = [...flowMap.values()].sort((a, b) => a.hour - b.hour);
    const peakBucket = [...flowByHour].sort((a, b) => b.total - a.total || a.hour - b.hour)[0] ?? null;
    const zeroLeader = [...hospitals].sort((a, b) => b.zeros - a.zeros || b.total - a.total)[0];
    const totalRegulacoes = cases.length;
    const totalAceitos = cases.filter((c) => c.situacao === "ACEITO").length;
    const totalVagasZero = cases.filter((c) => c.situacao === "ZERO").length;
    const totalRemovidos =
        cases.filter((c) => !c.ativo).length +
        intel.filter((i) => !i.ativo).length +
        chefia.filter((c) => !c.ativo).length;

    const timeline: ReportTimelineItem[] = [
        ...cases.map((c) => ({
            kind: "case" as const,
            timestamp: c.timestamp,
            title: `${hospitalMap.get(c.hospitalId)?.name ?? c.hospitalId} · ${c.situacao === "ACEITO" ? "Aceito" : "Vaga Zero"}`,
            subtitle: [c.caso, c.mr ? `MR ${c.mr}` : null, c.oc ? `OC ${c.oc}` : null].filter(Boolean).join(" · "),
            severity: c.situacao === "ACEITO" ? "success" as const : "danger" as const,
        })),
        ...intel.map((i) => ({
            kind: "intel" as const,
            timestamp: i.timestamp,
            title: `${hospitalMap.get(i.hospitalId)?.name ?? i.hospitalId} · ${i.tipo}`,
            subtitle: [i.nota, i.autor].filter(Boolean).join(" · "),
            severity:
                i.tipo === "lotado" || i.tipo === "sem_recurso" || i.tipo === "sem_especialista"
                    ? "warning" as const
                    : "info" as const,
        })),
        ...chefia.map((c) => ({
            kind: "chefia" as const,
            timestamp: c.timestamp,
            title: "Alerta da chefia",
            subtitle: `${c.mensagem} · ${c.autor}`,
            severity: "info" as const,
        })),
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const highlights: string[] = [
        `${totalRegulacoes} regulações foram registradas no período, com ${totalAceitos} aceitações e ${totalVagasZero} respostas em vaga zero.`,
    ];
    if (peakBucket) {
        highlights.push(
            `A maior pressão assistencial ocorreu entre ${peakBucket.label}, com ${peakBucket.total} movimentações (${peakBucket.aceitos} aceitos e ${peakBucket.zeros} zeros).`
        );
    }
    if (hospitals[0]?.total) {
        highlights.push(`O hospital mais demandado foi ${hospitals[0].hospitalNome}, com ${hospitals[0].total} acionamentos no plantão.`);
    }
    if (zeroLeader?.zeros) {
        highlights.push(`A maior concentração de vaga zero ficou em ${zeroLeader.hospitalNome}, com ${zeroLeader.zeros} registros.`);
    }

    return {
        meta: {
            startAt: request.startAt,
            endAt: request.endAt,
            turno: request.turno,
            responsavel: request.responsavel,
            observacoes: request.observacoes?.trim() || "Sem observações registradas.",
            generatedAt: new Date().toISOString(),
        },
        summary: {
            totalRegulacoes,
            totalAceitos,
            totalVagasZero,
            taxaAceite: pct(totalAceitos, totalRegulacoes),
            hospitaisAcionados: hospitals.filter((h) => h.total > 0).length,
            hospitaisComZero: hospitals.filter((h) => h.zeros > 0).length,
            totalIntel: intel.length,
            totalChefia: chefia.length,
            totalRemovidos,
            hospitalMaisAcionado: hospitals.find((h) => h.total > 0)?.hospitalNome ?? null,
            hospitalMaisZero: zeroLeader?.zeros ? zeroLeader.hospitalNome : null,
            mediaRegulacoesPorHora: flowByHour.length > 0 ? Number((totalRegulacoes / flowByHour.length).toFixed(1)) : 0,
            janelaPico: {
                faixa: peakBucket?.label ?? null,
                total: peakBucket?.total ?? 0,
                aceitos: peakBucket?.aceitos ?? 0,
                zeros: peakBucket?.zeros ?? 0,
            },
            primeiraRegulacao: cases.length ? cases[cases.length - 1].timestamp.toISOString() : null,
            ultimaRegulacao: cases.length ? cases[0].timestamp.toISOString() : null,
        },
        highlights,
        flowByHour,
        hospitals,
        timeline,
        cases,
        intel,
        chefia,
    };
}

export function renderReportHtml(report: GeneratedReport, options: ReportRequestData): string {
    const maxFlow = Math.max(...report.flowByHour.map((bucket) => bucket.total), 1);
    const activeHospitals = report.hospitals.filter((h) => h.total > 0 || h.intelCount > 0);
    const summaryCards = [
        ["Regulações", String(report.summary.totalRegulacoes), "#0f766e", "movimentação total do plantão"],
        ["Aceitos", String(report.summary.totalAceitos), "#166534", "destinos que absorveram demanda"],
        ["Vaga zero", String(report.summary.totalVagasZero), "#b91c1c", "negativas assistenciais registradas"],
        ["Taxa de aceite", `${report.summary.taxaAceite}%`, "#9a3412", "eficiência global do giro hospitalar"],
    ] as const;

    const highlightsHtml = report.highlights
        .map((item) => `<li style="margin:0 0 10px 0;line-height:1.6;color:#334155;">${escapeHtml(item)}</li>`)
        .join("");

    const flowRows = report.flowByHour.length
        ? report.flowByHour
            .map(
                (bucket) => `
            <tr>
              <td style="padding:10px 12px;font-weight:700;color:#0f172a;white-space:nowrap;">${bucket.label}</td>
              <td style="padding:10px 12px;min-width:260px;">
                <div style="background:#e2e8f0;border-radius:999px;height:10px;overflow:hidden;">
                  ${flowBar((bucket.total / maxFlow) * 100, bucket.zeros > bucket.aceitos ? "#ef4444" : "#0f766e")}
                </div>
              </td>
              <td style="padding:10px 12px;text-align:center;font-weight:800;">${bucket.total}</td>
              <td style="padding:10px 12px;text-align:center;color:#166534;font-weight:700;">${bucket.aceitos}</td>
              <td style="padding:10px 12px;text-align:center;color:#b91c1c;font-weight:700;">${bucket.zeros}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5" style="padding:14px 12px;color:#64748b;">Sem movimentação horária no período.</td></tr>`;

    const hospitalRows = activeHospitals.length
        ? activeHospitals
            .map((h) => {
                const total = h.total || 1;
                const aceitosPct = pct(h.aceitos, total);
                const zerosPct = pct(h.zeros, total);
                return `
            <tr>
              <td style="padding:12px 14px;">
                <div style="font-weight:800;color:#0f172a;">${escapeHtml(h.hospitalNome)}</div>
                <div style="font-size:12px;color:#64748b;text-transform:capitalize;">${escapeHtml(h.categoria)}</div>
              </td>
              <td style="padding:12px 14px;text-align:center;font-weight:800;">${h.total}</td>
              <td style="padding:12px 14px;min-width:180px;">
                <div style="display:flex;gap:6px;align-items:center;">
                  <div style="flex:1;background:#e2e8f0;border-radius:999px;height:10px;overflow:hidden;display:flex;">
                    <div style="width:${aceitosPct}%;background:#22c55e;"></div>
                    <div style="width:${zerosPct}%;background:#ef4444;"></div>
                  </div>
                  <span style="font-size:12px;color:#475569;font-weight:700;">${h.taxaAceite == null ? "—" : `${h.taxaAceite}%`}</span>
                </div>
              </td>
              <td style="padding:12px 14px;text-align:center;color:#166534;font-weight:700;">${h.aceitos}</td>
              <td style="padding:12px 14px;text-align:center;color:#b91c1c;font-weight:700;">${h.zeros}</td>
              <td style="padding:12px 14px;color:#475569;">${h.ultimoEvento ? escapeHtml(fmtDateTime(h.ultimoEvento)) : "—"}</td>
              <td style="padding:12px 14px;color:#475569;">${h.intelResumo.length ? escapeHtml(h.intelResumo.join(" | ")) : "—"}</td>
            </tr>`;
            })
            .join("")
        : `<tr><td colspan="7" style="padding:14px 12px;color:#64748b;">Sem movimentação hospitalar no período.</td></tr>`;

    const timelineRows = report.timeline.length
        ? report.timeline
            .map((item) => {
                const accent =
                    item.severity === "success"
                        ? "#16a34a"
                        : item.severity === "danger"
                            ? "#dc2626"
                            : item.severity === "warning"
                                ? "#d97706"
                                : "#2563eb";
                return `
            <tr>
              <td style="padding:12px 14px;vertical-align:top;font-weight:800;color:${accent};white-space:nowrap;">${escapeHtml(fmtOnlyTime(item.timestamp))}</td>
              <td style="padding:12px 14px;vertical-align:top;border-left:4px solid ${accent};">
                <div style="font-weight:800;color:#0f172a;margin-bottom:4px;">${escapeHtml(item.title)}</div>
                <div style="color:#64748b;line-height:1.55;">${escapeHtml(item.subtitle || "—")}</div>
              </td>
            </tr>`;
            })
            .join("")
        : `<tr><td colspan="2" style="padding:14px 12px;color:#64748b;">Sem eventos no período.</td></tr>`;

    const caseRows = report.cases.length
        ? report.cases
            .map(
                (c) => `
            <tr>
              <td style="padding:10px 12px;white-space:nowrap;">${escapeHtml(fmtDateTime(c.timestamp))}</td>
              <td style="padding:10px 12px;">${escapeHtml(hospitalMap.get(c.hospitalId)?.name ?? c.hospitalId)}</td>
              <td style="padding:10px 12px;font-weight:800;color:${c.situacao === "ACEITO" ? "#166534" : "#b91c1c"};">${escapeHtml(c.situacao)}</td>
              <td style="padding:10px 12px;">${escapeHtml(c.caso || "—")}</td>
              <td style="padding:10px 12px;">${escapeHtml(c.mr || "—")}</td>
              <td style="padding:10px 12px;">${escapeHtml(c.medico || "—")}</td>
              <td style="padding:10px 12px;">${escapeHtml(c.oc || "—")}</td>
              <td style="padding:10px 12px;">${escapeHtml(c.criadoPor)}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="8" style="padding:14px 12px;color:#64748b;">Nenhum caso registrado no período.</td></tr>`;

    const intelRows = report.intel.length
        ? report.intel
            .map(
                (i) => `
            <tr>
              <td style="padding:10px 12px;white-space:nowrap;">${escapeHtml(fmtDateTime(i.timestamp))}</td>
              <td style="padding:10px 12px;">${escapeHtml(hospitalMap.get(i.hospitalId)?.name ?? i.hospitalId)}</td>
              <td style="padding:10px 12px;">${escapeHtml(i.tipo)}</td>
              <td style="padding:10px 12px;">${escapeHtml(i.nota || "—")}</td>
              <td style="padding:10px 12px;">${escapeHtml(i.autor)}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5" style="padding:14px 12px;color:#64748b;">Nenhum alerta qualitativo no período.</td></tr>`;

    const chefiaRows = report.chefia.length
        ? report.chefia
            .map(
                (c) => `
            <tr>
              <td style="padding:10px 12px;white-space:nowrap;">${escapeHtml(fmtDateTime(c.timestamp))}</td>
              <td style="padding:10px 12px;">${escapeHtml(c.autor)}</td>
              <td style="padding:10px 12px;">${escapeHtml(c.mensagem)}</td>
              <td style="padding:10px 12px;">${c.ativo ? "Ativo" : "Removido"}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="4" style="padding:14px 12px;color:#64748b;">Nenhum alerta da chefia no período.</td></tr>`;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório de Plantão</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:24px;background:#eef2f7;color:#0f172a;font-family:Arial,Helvetica,sans-serif;line-height:1.5}
    .page{max-width:980px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ee;border-radius:20px;overflow:hidden}
    .hero{padding:28px 30px;background:#0f172a;color:#ffffff}
    .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#93c5fd;font-weight:700;margin-bottom:10px}
    .title{font-size:30px;line-height:1.2;font-weight:800;margin:0 0 10px 0}
    .sub{font-size:14px;color:#cbd5e1;max-width:720px}
    .meta-table,.kpi-table,.table{width:100%;border-collapse:collapse}
    .meta-table td{padding:14px 12px;background:#f8fafc;border:1px solid #e2e8f0;vertical-align:top}
    .meta-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:6px}
    .meta-value{font-size:14px;font-weight:700;color:#0f172a}
    .section{padding:24px 30px;border-top:1px solid #e2e8f0}
    .section-title{font-size:21px;font-weight:800;margin:0 0 6px 0;color:#0f172a}
    .section-sub{font-size:13px;color:#64748b;margin:0 0 18px 0}
    .kpi-table td{padding:0 8px 0 0}
    .kpi{padding:18px;border-radius:16px;color:#fff;min-height:92px}
    .kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.82;font-weight:700}
    .kpi-value{font-size:30px;font-weight:800;margin-top:10px}
    .info-strip{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px 18px;margin-top:14px}
    .info-strip strong{color:#0f172a}
    .bullet-list{padding-left:18px;margin:0}
    .table{table-layout:fixed}
    .table th,.table td{border:1px solid #e2e8f0;word-break:break-word;overflow-wrap:anywhere;vertical-align:top}
    .table th{padding:11px 12px;background:#f8fafc;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.08em;text-align:left}
    .table--analytics th:nth-child(1){width:16%}
    .table--analytics th:nth-child(2){width:28%}
    .table--timeline td:nth-child(1){width:86px}
    .table--compact th:nth-child(1){width:16%}
    .table--detailed th:nth-child(1){width:13%}
    .table--detailed th:nth-child(2){width:15%}
    .table--detailed th:nth-child(3){width:10%}
    .table--detailed th:nth-child(4){width:18%}
    .table--detailed th:nth-child(5){width:10%}
    .table--detailed th:nth-child(6){width:14%}
    .table--detailed th:nth-child(7){width:8%}
    .table--detailed th:nth-child(8){width:12%}
    .note{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px 18px;color:#334155}
    @page{size:A4 portrait;margin:12mm}
    @media print{
      html,body{background:#fff !important}
      body{padding:0;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .page{max-width:none;border:none;border-radius:0;overflow:visible;box-shadow:none}
      .hero{padding:18px 20px}
      .title{font-size:24px}
      .sub{font-size:12px;max-width:none}
      .section{padding:14px 18px;page-break-inside:avoid}
      .section-title{font-size:17px}
      .section-sub{font-size:11px;margin-bottom:10px}
      .meta-table td{padding:8px 9px;font-size:11px}
      .kpi-table{table-layout:fixed}
      .kpi-table td{padding-right:6px}
      .kpi{padding:10px 10px 12px;min-height:auto}
      .kpi-label{font-size:9px}
      .kpi-value{font-size:21px;margin-top:6px}
      .info-strip{padding:10px 12px;margin-top:10px}
      .table{table-layout:fixed !important;font-size:9.5px}
      .table thead{display:table-header-group}
      .table tr{break-inside:avoid;page-break-inside:avoid}
      .table th,.table td{padding:6px 7px !important;white-space:normal !important;word-break:break-word !important;overflow-wrap:anywhere !important}
      .table--analytics th:nth-child(2),.table--analytics td:nth-child(2){width:24%}
      .table--timeline td:nth-child(1){width:58px !important}
      .table--compact{font-size:9px !important}
      .table--detailed{font-size:8.5px !important}
      .table--detailed th:nth-child(6),.table--detailed td:nth-child(6),
      .table--detailed th:nth-child(8),.table--detailed td:nth-child(8){display:none}
      .note{padding:10px 12px;font-size:10.5px}
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="eyebrow">SAMU Salvador · Encerramento de plantão</div>
      <h1 class="title">Relatório operacional do plantão</h1>
      <div class="sub">Documento pensado para leitura linear, envio por e-mail e passagem entre equipes, destacando pressão assistencial, janela de pico e desempenho por hospital.</div>
    </section>

    <section class="section" style="border-top:none;">
      <table class="meta-table">
        <tr>
          <td><div class="meta-label">Turno</div><div class="meta-value">${escapeHtml(options.turno === "diurno" ? "Diurno" : "Noturno")}</div></td>
          <td><div class="meta-label">Período</div><div class="meta-value">${escapeHtml(fmtDateTime(new Date(report.meta.startAt)))} → ${escapeHtml(fmtDateTime(new Date(report.meta.endAt)))}</div></td>
          <td><div class="meta-label">Responsável</div><div class="meta-value">${escapeHtml(report.meta.responsavel)}</div></td>
          <td><div class="meta-label">Gerado em</div><div class="meta-value">${escapeHtml(fmtDateTime(new Date(report.meta.generatedAt)))}</div></td>
        </tr>
      </table>
    </section>

    <section class="section">
      <h2 class="section-title">1. Panorama executivo</h2>
      <p class="section-sub">Leitura rápida das métricas que mais importam para entender a pressão do plantão e a capacidade de absorção hospitalar.</p>
      <table class="kpi-table">
        <tr>
          ${summaryCards
            .map(
                ([label, value, color, helper]) => `
              <td>
                <div class="kpi" style="background:${color};">
                  <div class="kpi-label">${label}</div>
                  <div class="kpi-value">${value}</div>
                  <div style="font-size:12px;opacity:.88;margin-top:8px;">${helper}</div>
                </div>
              </td>`
            )
            .join("")}
        </tr>
      </table>
      <div class="info-strip">
        <div style="font-size:14px;color:#334155;line-height:1.7;">
          <strong>Janela de maior fluxo:</strong> ${escapeHtml(report.summary.janelaPico.faixa ?? "—")} ·
          <strong>Pico:</strong> ${report.summary.janelaPico.total} movimentações ·
          <strong>Média por hora ativa:</strong> ${String(report.summary.mediaRegulacoesPorHora).replace(".", ",")} regulações/h ·
          <strong>Hospitais acionados:</strong> ${report.summary.hospitaisAcionados}
        </div>
      </div>
      <div class="info-strip">
        <ul class="bullet-list">${highlightsHtml}</ul>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">2. Fluxo assistencial ao longo do turno</h2>
      <p class="section-sub">Distribuição horária das regulações para localizar pico de demanda e entender concentração de aceites versus negativas.</p>
      <table class="table table--analytics">
        <thead>
          <tr>
            <th>Faixa</th>
            <th>Intensidade</th>
            <th>Total</th>
            <th>Aceitos</th>
            <th>ZERO</th>
          </tr>
        </thead>
        <tbody>${flowRows}</tbody>
      </table>
    </section>

    <section class="section">
      <h2 class="section-title">3. Consolidado hospitalar</h2>
      <p class="section-sub">Ranking por volume, com leitura direta do balanceamento entre aceites, vaga zero e última movimentação útil para reavaliar destinos.</p>
      <table class="table table--analytics">
        <thead>
          <tr>
            <th>Hospital</th>
            <th>Total</th>
            <th>Proporção</th>
            <th>Aceitos</th>
            <th>ZERO</th>
            <th>Último evento</th>
            <th>Intel resumida</th>
          </tr>
        </thead>
        <tbody>${hospitalRows}</tbody>
      </table>
    </section>

    ${options.incluirLinhaDoTempo !== false ? `
      <section class="section">
        <h2 class="section-title">4. Linha de leitura do plantão</h2>
        <p class="section-sub">Sequência cronológica contínua para reconstruir o plantão e entender momentos de virada, saturação e acomodação de fluxo.</p>
        <table class="table table--timeline"><tbody>${timelineRows}</tbody></table>
      </section>` : ""}

    ${options.incluirAlertasQualitativos !== false ? `
      <section class="section">
        <h2 class="section-title">5. Alertas qualitativos</h2>
        <p class="section-sub">Contexto operacional relevante para explicar gargalos, indisponibilidades e mudança de perfil dos hospitais.</p>
        <table class="table table--compact">
          <thead><tr><th>Horário</th><th>Hospital</th><th>Tipo</th><th>Nota</th><th>Autor</th></tr></thead>
          <tbody>${intelRows}</tbody>
        </table>
      </section>` : ""}

    ${options.incluirAlertasChefia !== false ? `
      <section class="section">
        <h2 class="section-title">6. Alertas da chefia</h2>
        <p class="section-sub">Registros institucionais que devem compor a passagem e eventual comunicação posterior.</p>
        <table class="table table--compact">
          <thead><tr><th>Horário</th><th>Autor</th><th>Mensagem</th><th>Status</th></tr></thead>
          <tbody>${chefiaRows}</tbody>
        </table>
      </section>` : ""}

    ${options.incluirCasosDetalhados !== false ? `
      <section class="section">
        <h2 class="section-title">7. Casuística detalhada</h2>
        <p class="section-sub">Tabela analítica para auditoria, e-mail de passagem e revisão posterior do que foi regulado em cada hospital.</p>
        <table class="table table--detailed">
          <thead><tr><th>Horário</th><th>Hospital</th><th>Situação</th><th>Caso</th><th>MR</th><th>Médico</th><th>OC</th><th>Registrado por</th></tr></thead>
          <tbody>${caseRows}</tbody>
        </table>
      </section>` : ""}

    <section class="section">
      <h2 class="section-title">8. Observações finais e passagem</h2>
      <p class="section-sub">Espaço para síntese clínica-operacional, pendências, orientações e destaque do que precisa ser acompanhado no próximo turno.</p>
      <div class="note">${escapeHtml(report.meta.observacoes)}</div>
    </section>
  </div>
</body>
</html>`;
}

export function renderReportMarkdown(report: GeneratedReport, options: ReportRequestData): string {
    const lines: string[] = [];
    lines.push(`# Relatório Operacional do Plantão`);
    lines.push("");
    lines.push(`- **Turno:** ${options.turno === "diurno" ? "Diurno" : "Noturno"}`);
    lines.push(`- **Período:** ${fmtDateTime(new Date(report.meta.startAt))} → ${fmtDateTime(new Date(report.meta.endAt))}`);
    lines.push(`- **Responsável:** ${report.meta.responsavel}`);
    lines.push(`- **Gerado em:** ${fmtDateTime(new Date(report.meta.generatedAt))}`);
    lines.push("");
    lines.push(`## 1. Panorama executivo`);
    lines.push(`- Regulações: ${report.summary.totalRegulacoes}`);
    lines.push(`- Aceitos: ${report.summary.totalAceitos}`);
    lines.push(`- Vaga zero: ${report.summary.totalVagasZero}`);
    lines.push(`- Taxa de aceite: ${report.summary.taxaAceite}%`);
    lines.push(`- Hospitais acionados: ${report.summary.hospitaisAcionados}`);
    lines.push(`- Hospitais com ZERO: ${report.summary.hospitaisComZero}`);
    lines.push(`- Janela de pico: ${report.summary.janelaPico.faixa ?? "—"} (${report.summary.janelaPico.total})`);
    lines.push(`- Média por hora ativa: ${String(report.summary.mediaRegulacoesPorHora).replace(".", ",")}`);
    lines.push("");
    lines.push(`### Leituras rápidas`);
    report.highlights.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push(`## 2. Fluxo por hora`);
    lines.push(`| Faixa | Total | Aceitos | ZERO |`);
    lines.push(`|---|---:|---:|---:|`);
    report.flowByHour.forEach((bucket) => {
        lines.push(`| ${bucket.label} | ${bucket.total} | ${bucket.aceitos} | ${bucket.zeros} |`);
    });
    lines.push("");
    lines.push(`## 3. Consolidado por hospital`);
    lines.push(`| Hospital | Total | Aceitos | ZERO | Taxa | Intel |`);
    lines.push(`|---|---:|---:|---:|---:|---|`);
    report.hospitals.filter((h) => h.total > 0 || h.intelCount > 0).forEach((h) => {
        lines.push(`| ${h.hospitalNome} | ${h.total} | ${h.aceitos} | ${h.zeros} | ${h.taxaAceite == null ? "—" : `${h.taxaAceite}%`} | ${h.intelResumo.join("; ") || "—"} |`);
    });
    if (options.incluirLinhaDoTempo !== false) {
        lines.push("");
        lines.push(`## 4. Linha de leitura do plantão`);
        report.timeline.forEach((item) => {
            lines.push(`- **${fmtOnlyTime(item.timestamp)}** — ${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""}`);
        });
    }
    if (options.incluirAlertasQualitativos !== false) {
        lines.push("");
        lines.push(`## 5. Alertas qualitativos`);
        if (report.intel.length === 0) lines.push(`- Nenhum alerta qualitativo no período.`);
        report.intel.forEach((i) => lines.push(`- **${fmtOnlyTime(i.timestamp)}** ${hospitalMap.get(i.hospitalId)?.name ?? i.hospitalId} · ${i.tipo}${i.nota ? ` · ${i.nota}` : ""} (${i.autor})`));
    }
    if (options.incluirAlertasChefia !== false) {
        lines.push("");
        lines.push(`## 6. Alertas da chefia`);
        if (report.chefia.length === 0) lines.push(`- Nenhum alerta da chefia no período.`);
        report.chefia.forEach((c) => lines.push(`- **${fmtOnlyTime(c.timestamp)}** ${c.autor}: ${c.mensagem}`));
    }
    if (options.incluirCasosDetalhados !== false) {
        lines.push("");
        lines.push(`## 7. Casos detalhados`);
        report.cases.forEach((c) => lines.push(`- **${fmtDateTime(c.timestamp)}** · ${hospitalMap.get(c.hospitalId)?.name ?? c.hospitalId} · ${c.situacao} · ${c.caso || "—"} · MR ${c.mr || "—"} · Médico ${c.medico || "—"} · OC ${c.oc || "—"}`));
    }
    lines.push("");
    lines.push(`## 8. Observações finais`);
    lines.push(report.meta.observacoes);
    lines.push("");
    return lines.join("\n");
}
