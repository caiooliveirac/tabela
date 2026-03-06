// ═══════════════════════════════════════════════════════════════
// Score → Color — Gradiente HSL não-linear (v3.1)
//
// Curva desenhada para:
//   - Vermelho intenso e alarmente para scores baixos (0-30)
//   - Laranja/âmbar distinto para zona intermediária (30-50)
//   - Amarelo-verde para transição (50-65)
//   - Verde só para scores realmente altos (65-100)
//   - Saturação alta nos extremos para impacto visual
// ═══════════════════════════════════════════════════════════════

export interface ScoreColorSet {
  /** Cor da borda/barra lateral */
  bd: string;
  /** Background claro */
  bg: string;
  /** Cor do texto */
  tx: string;
  /** Glow (box-shadow) — mais intenso para scores baixos */
  glow: string;
}

/**
 * Converte score [0-100] para um set de cores HSL.
 * Curva não-linear: vermelho demora a sair, verde é difícil de alcançar.
 */
export function scoreToColor(score: number): ScoreColorSet {
  const s = Math.max(0, Math.min(100, score));

  // ── Hue não-linear: fica vermelho por mais tempo ──────────
  // 0-25:  hue 0→12   (vermelho profundo → vermelho-alaranjado)
  // 25-45: hue 12→35  (laranja → âmbar)
  // 45-60: hue 35→55  (âmbar → amarelo)
  // 60-75: hue 55→85  (amarelo-verde → verde claro)
  // 75-100: hue 85→140 (verde claro → verde vivo)
  let hue: number;
  if (s <= 25) {
    hue = (s / 25) * 12;
  } else if (s <= 45) {
    hue = 12 + ((s - 25) / 20) * 23;
  } else if (s <= 60) {
    hue = 35 + ((s - 45) / 15) * 20;
  } else if (s <= 75) {
    hue = 55 + ((s - 60) / 15) * 30;
  } else {
    hue = 85 + ((s - 75) / 25) * 55;
  }
  hue = Math.round(hue);

  // ── Saturação: alta para baixos (alarmante), moderada para altos ──
  let sat: number;
  if (s <= 30) {
    sat = Math.round(85 - (s / 30) * 10);   // 85→75%  vivo/alarmante
  } else if (s <= 60) {
    sat = Math.round(70 - ((s - 30) / 30) * 5); // 70→65%
  } else {
    sat = Math.round(60 + ((s - 60) / 40) * 15); // 60→75%  verde vivo
  }

  // ── Luminosidade da cor principal ──────────────────────────
  // Scores baixos: lum mais baixo (vermelho escuro/intenso)
  // Scores altos: lum moderado
  let lum: number;
  if (s <= 20) {
    lum = Math.round(33 + (s / 20) * 5);    // 33→38%  vermelho escuro
  } else if (s <= 50) {
    lum = Math.round(38 + ((s - 20) / 30) * 5); // 38→43%
  } else {
    lum = Math.round(38 + ((s - 50) / 50) * 5); // 38→43%
  }

  const bd = `hsl(${hue}, ${sat}%, ${lum}%)`;

  // ── Background: mais corado para scores baixos ────────────
  let bgSat: number;
  let bgLum: number;
  if (s <= 30) {
    // Fundo levemente rosado/avermelhado — mais notável
    bgSat = Math.round(70 - (s / 30) * 20);   // 70→50%
    bgLum = Math.round(93 - ((30 - s) / 30) * 4); // 89→93%
  } else {
    bgSat = Math.round(40 + (s / 100) * 15);  // 40→55%
    bgLum = Math.round(94 + (s / 100) * 3);   // 94→97%
  }
  const bg = `hsl(${hue}, ${bgSat}%, ${bgLum}%)`;

  // ── Texto ─────────────────────────────────────────────────
  const txLum = Math.round(22 + (s / 100) * 12); // 22→34%
  const tx = `hsl(${hue}, ${sat}%, ${txLum}%)`;

  // ── Glow: mais intenso e maior para scores baixos ────────
  let glowAlpha: number;
  let glowSize: number;
  if (s <= 25) {
    glowAlpha = Math.round(30 - (s / 25) * 10); // 30→20%
    glowSize = 16;
  } else if (s >= 75) {
    glowAlpha = Math.round(15 + ((s - 75) / 25) * 10); // 15→25%
    glowSize = 10;
  } else {
    glowAlpha = 10;
    glowSize = 8;
  }
  const glow = `0 0 ${glowSize}px hsla(${hue}, ${sat}%, ${lum}%, 0.${String(glowAlpha).padStart(2, "0")})`;

  return { bd, bg, tx, glow };
}

/** Neutral style for hospitals without data */
export const NEUTRAL_STYLE: ScoreColorSet = {
  bd: "#cbd5e1",
  bg: "#f8fafc",
  tx: "#64748b",
  glow: "none",
};
