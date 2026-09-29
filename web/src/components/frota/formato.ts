// Cores e textos da aba Frota. Cor carrega estado: verde/âmbar é a idade da
// posição (a mesma régua do painel de destino), azul é "parada em hospital",
// vermelho é só o alerta de 40 min.

export const COR = {
  recente: "#16a34a",
  atrasada: "#d97706",
  alerta: "#dc2626",
  hospital: "#1d4ed8",
  vazio: "#64748b",
} as const;

export function corDaIdade(idadeMin: number, recenteMin: number): string {
  return idadeMin <= recenteMin ? COR.recente : COR.atrasada;
}

/** Barra da parada: azul até 30 min, âmbar chegando, vermelho no limite. */
export function corDaParada(minutos: number, alertaMin: number): string {
  if (minutos >= alertaMin) return COR.alerta;
  if (minutos >= alertaMin - 10) return COR.atrasada;
  return COR.hospital;
}

export function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m && h < 6 ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.floor(min / 1440)} dias`;
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Bahia",
  });
}

export function ha(iso: string | null, agora = Date.now()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  return s < 90 ? `há ${s} s` : `há ${duracao(Math.round(s / 60))}`;
}
