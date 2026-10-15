// Relatório da linha do tempo em CSV (abre no Excel): uma linha por parada em
// hospital ou UPA na janela escolhida. Sai do que a tela já tem carregado —
// nada novo no servidor. Só GPS e contagem; sem paciente nem protocolo.
import type { LinhaDoTempoFrota, ParadaHistorico } from "../../lib/types";

const FUSO = "America/Bahia";

function campo(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function situacao(p: ParadaHistorico): string {
  if (p.aberta) return "ainda lá";
  if (p.motivoFim === "sem-sinal") return "sem sinal";
  if (p.motivoFim === "desativada") return "desativada no painel";
  return "saiu";
}

export function relatorioParadasCsv(data: LinhaDoTempoFrota): string {
  const nomes = new Map(data.hospitais.map((h) => [h.id, h]));
  const cruzando = data.acolhimentos.ligado && !data.acolhimentos.erro;
  const cabecalho = [
    "Viatura", "Tipo", "Base", "Local", "Tipo do local", "Entrada", "Saída", "Minutos", "Situação",
    `Passou de ${data.alertaMin} min`, "Sem notificação (USA)",
  ];
  const linhas = data.paradas
    .filter((p) => !p.naBase && nomes.has(p.hospitalId))
    .sort((a, b) => Date.parse(a.entrada) - Date.parse(b.entrada))
    .map((p) => {
      const local = nomes.get(p.hospitalId)!;
      return [
        p.nome, p.tipo, p.base, local.nome, local.tipo === "upa" ? "UPA" : "Hospital",
        dataHora(p.entrada), p.aberta ? "" : dataHora(p.fim), p.minutos, situacao(p),
        p.minutos >= data.alertaMin ? "Sim" : "Não",
        cruzando ? (p.semNotificacao ? "Sim" : "Não") : "",
      ].map(campo).join(";");
    });
  return "﻿" + [cabecalho.map(campo).join(";"), ...linhas].join("\r\n");
}

export function baixarRelatorio(nome: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
