import { useMemo, useState } from "react";
import { api } from "../api/client";
import type { ReportPreviewResponse, ReportRequestPayload } from "../lib/types";

interface ReportModalProps {
  operador: string;
  onClose: () => void;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60000);
  return local.toISOString().slice(0, 16);
}

function shiftDefaults() {
  const now = new Date();
  const h = now.getHours();
  const diurno = h >= 7 && h < 19;
  const start = new Date(now);
  const end = new Date(now);
  if (diurno) start.setHours(7, 0, 0, 0);
  else {
    start.setHours(19, 0, 0, 0);
    if (h < 7) start.setDate(start.getDate() - 1);
  }
  return {
    turno: diurno ? "diurno" as const : "noturno" as const,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

async function downloadReport(payload: ReportRequestPayload, format: "html" | "markdown", baseName: string): Promise<void> {
  const res = await fetch(`${window.location.origin}/tabela/api/reports/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, format }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.${format === "html" ? "html" : "md"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openHtmlInNewTab(html: string): Window {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank");
  if (!popup) {
    URL.revokeObjectURL(url);
    throw new Error("Não foi possível abrir nova aba. Libere pop-ups para visualizar o relatório.");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return popup;
}

export default function ReportModal({ operador, onClose }: ReportModalProps) {
  const defaults = useMemo(() => shiftDefaults(), []);
  const [form, setForm] = useState<ReportRequestPayload>({
    startAt: defaults.startAt,
    endAt: defaults.endAt,
    turno: defaults.turno,
    responsavel: operador || "",
    observacoes: "",
    incluirCasosDetalhados: true,
    incluirAlertasQualitativos: true,
    incluirAlertasChefia: true,
    incluirLinhaDoTempo: true,
  });
  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState<"html" | "markdown" | "pdf" | null>(null);
  const [preview, setPreview] = useState<ReportPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = Boolean(form.responsavel.trim() && form.startAt && form.endAt);

  const handlePreview = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.previewReport({
        ...form,
        responsavel: form.responsavel.trim(),
        observacoes: form.observacoes?.trim() || "",
      });
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar preview");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (format: "html" | "markdown") => {
    try {
      setDownloadLoading(format);
      setError(null);
      const base = preview?.fileBaseName || `relatorio-${Date.now()}`;

      if (format === "html") {
        if (!preview) {
          throw new Error("Gere o preview antes de exportar em HTML.");
        }
        openHtmlInNewTab(preview.html);
        downloadBlob(new Blob([preview.html], { type: "text/html;charset=utf-8" }), `${base}.html`);
        return;
      }

      await downloadReport(form, format, base);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao baixar relatório");
    } finally {
      setDownloadLoading(null);
    }
  };

  const handleExportPdf = () => {
    if (!preview) return;

    try {
      setDownloadLoading("pdf");
      setError(null);

      const printableHtml = preview.html.replace(
        /<\/body>/i,
        `<script>
          window.addEventListener('load', function () {
            setTimeout(function () {
              window.focus();
              window.print();
            }, 350);
          });
          window.addEventListener('afterprint', function () {
            window.close();
          });
        <\/script></body>`
      );

      openHtmlInNewTab(printableHtml);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao exportar PDF");
    } finally {
      setDownloadLoading(null);
    }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none bg-white text-slate-900";
  const cbRow = "flex items-center gap-2 text-[12px] font-semibold text-slate-600";

  return (
    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center z-[220] p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-[22px] w-full max-w-[1200px] h-[88vh] shadow-2xl overflow-hidden flex" onMouseDown={(e) => e.stopPropagation()}>
        <div className="w-[360px] border-r border-slate-200 bg-slate-50 p-5 overflow-y-auto">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">Encerramento de plantão</div>
          <h3 className="text-[22px] font-black mt-2 text-slate-900">Relatório operacional</h3>
          <p className="text-[13px] text-slate-500 mt-2">Gere um documento elegante para passagem de plantão, auditoria e compartilhamento institucional.</p>

          <div className="mt-5 space-y-4">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">Turno</label>
              <div className="flex gap-2 mt-1">
                {([["diurno", "Diurno"], ["noturno", "Noturno"]] as const).map(([value, label]) => (
                  <button key={value} onClick={() => setForm({ ...form, turno: value })} className="flex-1 py-2 rounded-lg text-sm font-bold border" style={{ backgroundColor: form.turno === value ? "#0f172a" : "#fff", color: form.turno === value ? "#fff" : "#475569", borderColor: form.turno === value ? "#0f172a" : "#cbd5e1" }}>{label}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">Início</label>
              <input type="datetime-local" value={toLocalInputValue(form.startAt)} onChange={(e) => setForm({ ...form, startAt: new Date(e.target.value).toISOString() })} className={inp} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">Fim</label>
              <input type="datetime-local" value={toLocalInputValue(form.endAt)} onChange={(e) => setForm({ ...form, endAt: new Date(e.target.value).toISOString() })} className={inp} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">Responsável</label>
              <input value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} placeholder="Nome de quem fecha o plantão" className={inp} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">Observações finais</label>
              <textarea rows={5} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Síntese do turno, gargalos, pendências e passagem para a próxima equipe..." className={`${inp} resize-none`} />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Seções</div>
              <label className={cbRow}><input type="checkbox" checked={!!form.incluirLinhaDoTempo} onChange={(e) => setForm({ ...form, incluirLinhaDoTempo: e.target.checked })} /> Linha do tempo</label>
              <label className={cbRow}><input type="checkbox" checked={!!form.incluirAlertasQualitativos} onChange={(e) => setForm({ ...form, incluirAlertasQualitativos: e.target.checked })} /> Alertas qualitativos</label>
              <label className={cbRow}><input type="checkbox" checked={!!form.incluirAlertasChefia} onChange={(e) => setForm({ ...form, incluirAlertasChefia: e.target.checked })} /> Alertas da chefia</label>
              <label className={cbRow}><input type="checkbox" checked={!!form.incluirCasosDetalhados} onChange={(e) => setForm({ ...form, incluirCasosDetalhados: e.target.checked })} /> Casos detalhados</label>
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 font-semibold">{error}</div>}

            <div className="flex gap-2 pt-1">
              <button onClick={handlePreview} disabled={!canGenerate || loading} className="flex-1 py-3 rounded-xl bg-slate-900 text-white text-sm font-black disabled:opacity-50">{loading ? "Gerando preview..." : "Gerar preview"}</button>
              <button onClick={onClose} className="py-3 px-4 rounded-xl border border-slate-300 bg-white text-slate-600 text-sm font-bold">Fechar</button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-white min-w-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-white">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Preview profissional</div>
              <div className="text-[15px] font-bold text-slate-900 mt-1">Documento pronto para leitura, passagem e download</div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleExportPdf} disabled={!preview || downloadLoading !== null} className="py-[9px] px-4 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-bold disabled:opacity-40">{downloadLoading === "pdf" ? "Abrindo..." : "⬇ PDF"}</button>
              <button onClick={() => handleDownload("markdown")} disabled={!preview || downloadLoading !== null} className="py-[9px] px-4 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-bold disabled:opacity-40">{downloadLoading === "markdown" ? "Baixando..." : "⬇ MD"}</button>
              <button onClick={() => handleDownload("html")} disabled={!preview || downloadLoading !== null} className="py-[9px] px-4 rounded-xl border-none bg-blue-700 text-white text-sm font-black disabled:opacity-40">{downloadLoading === "html" ? "Baixando..." : "⬇ HTML"}</button>
            </div>
          </div>

          <div className="px-5 py-2 border-b border-slate-100 bg-slate-50 text-[12px] text-slate-500">
            PDF abre o relatório renderizado em outra aba e já chama a impressão para salvar como PDF. HTML baixa o arquivo e também abre a visualização em outra aba.
          </div>

          {preview ? (
            <iframe title="preview-relatorio" srcDoc={preview.html} className="flex-1 w-full bg-slate-100" />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-slate-100">
              <div className="max-w-md text-center px-6">
                <div className="text-5xl mb-3">📄</div>
                <div className="text-[20px] font-black text-slate-900">Relatório premium do plantão</div>
                <p className="text-[14px] text-slate-500 mt-2">Preencha os dados à esquerda para gerar uma prévia moderna do relatório com resumo executivo, consolidado hospitalar, timeline e seções detalhadas.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
