// ═══════════════════════════════════════════════════════════════
// Prazos de restrição de UPA — as opções clicáveis da chefia.
//
// A restrição quase sempre vale "até a próxima virada de turno": 07:00 ou
// 19:00, de hoje ou de amanhã. Em vez de obrigar a chefia a digitar data e
// hora no meio do plantão, o modal oferece esses instantes prontos.
// O horário é o do navegador (os reguladores estão todos em Salvador, UTC-3);
// o servidor recebe o instante absoluto em ISO e só valida futuro + teto.
// ═══════════════════════════════════════════════════════════════

export interface DeadlineOption {
  /** "hoje 19:00" — o mesmo rótulo que o bot usa no grupo. */
  label: string;
  /** Instante absoluto em ISO, o que vai para a API. */
  iso: string;
}

const SHIFT_HOURS = [7, 19];
const DAY_LABELS = ["hoje", "amanhã", "depois de amanhã"];

/**
 * Próximas viradas de turno a partir de agora, no máximo `max` opções.
 * Descarta as que já passaram — às 20h de terça, a primeira opção é
 * "amanhã 07:00", não "hoje 07:00".
 */
export function deadlineOptions(now: Date = new Date(), max = 4): DeadlineOption[] {
  const out: DeadlineOption[] = [];

  for (let dayOffset = 0; dayOffset < DAY_LABELS.length && out.length < max; dayOffset++) {
    for (const hour of SHIFT_HOURS) {
      if (out.length >= max) break;
      const at = new Date(now);
      at.setDate(at.getDate() + dayOffset);
      at.setHours(hour, 0, 0, 0);
      // Margem de 1 min: "até 19:00" às 18:59 é ambíguo e quase sempre engano.
      if (at.getTime() <= now.getTime() + 60_000) continue;
      out.push({
        label: `${DAY_LABELS[dayOffset]} ${String(hour).padStart(2, "0")}:00`,
        iso: at.toISOString(),
      });
    }
  }

  return out;
}

/** Valor inicial do campo "outro horário" (input datetime-local). */
export function toDatetimeLocalValue(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
