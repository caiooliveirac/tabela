/** ?dias= da GET /frota/adesao: 1–184, padrão 14 — o mesmo teto de período da
    /retencao. O painel do Acolhimentos pede 14; o ranking de médicos do
    plantões → Escalas pede o histórico inteiro. */
export function diasDaAdesao(v: unknown): number {
    return Math.min(184, Math.max(1, Math.floor(Number(v)) || 14));
}
