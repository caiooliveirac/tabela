import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import type { UpaRestriction } from "../lib/types";
import { useUpaRestrictions, useRestrictUpa, useLiberateUpa } from "../hooks/useUpaRestrictions";
import UpaRestrictionModal from "./UpaRestrictionModal";
import PinDialog from "./PinDialog";

// Aba UPAs — visão da cidade do Giro de Leitos, consumindo a API pública do
// giro-de-leitos montada em /tabela/upas/api (nginx).
//
// Linguagem visual: "instrumento de regulação" — filtro segmentado responde
// uma pergunta por vez (vermelha? amarela? isolamento? especialista?), o card
// inteiro carrega a cor do estado, e a linha de vida (ECG) na base mostra a
// idade do dado. Dado >6h "empoeira" o card e abre a ficha de reincidência.
//
// Sobreposto vem a RESTRIÇÃO da chefia (banco do próprio tabela, não do giro):
// vinho escuro, mais grave que lotada — a decisão de não encaminhar não
// depende de ter leito livre.

interface Room { occupied?: number | null; capacity?: number | null }
interface UnitRow {
  unit_key: string;
  canonical_name: string;
  displayed_name?: string | null;
  updated_at?: string | null;
  is_critical?: boolean;
  red_occupied?: number | null;
  red_capacity?: number | null;
  yellow_occupied?: number | null;
  yellow_capacity?: number | null;
  isolation_total_occupied?: number | null;
  isolation_total_capacity?: number | null;
  has_orthopedist?: boolean;
  has_surgeon?: boolean;
  has_psychiatrist?: boolean;
  isolation_mode?: string | null;
  isolation_male_occupied?: number | null;
  isolation_male_capacity?: number | null;
  isolation_female_occupied?: number | null;
  isolation_female_capacity?: number | null;
  isolation_pediatric_occupied?: number | null;
  isolation_pediatric_capacity?: number | null;
  payload?: { data?: { rooms?: Record<string, Room> } } | null;
}
interface HistEvent { payload?: Record<string, unknown> }

const API = "/tabela/upas/api";
const LIVRE = "var(--livre)";
const LOTADA = "var(--lotada)";
const RESTRITA = "var(--restrita)";
const ATENCAO = "var(--atencao)";
const ISO = "var(--iso)";
const NEUTRO = "#64748b";

const norm = (s: string | null | undefined) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const room = (u: UnitRow, k: string): Room | null => u.payload?.data?.rooms?.[k] ?? null;
const vac = (o?: number | null, c?: number | null) =>
  c == null || o == null ? null : Math.max(c - o, 0);
const rvac = (r: Room | null) => vac(r?.occupied, r?.capacity);
const nome = (u: UnitRow) => u.displayed_name || u.canonical_name;
const ageMin = (iso?: string | null) =>
  iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;
const ageLabel = (a: number | null) =>
  a == null ? "sem atualização" : a >= 60 ? `há ${Math.floor(a / 60)}h${String(a % 60).padStart(2, "0")}` : `há ${a} min`;
const hLabel = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}` : `${min}min`;

// ── Idade do dado: fresco / envelhecendo / empoeirado ──
const STALE_MIN = 360;
type Tier = "fresh" | "aging" | "stale";
const tierOf = (a: number | null): Tier =>
  a == null || a > STALE_MIN ? "stale" : a > 180 ? "aging" : "fresh";

const temSplitAmarela = (u: UnitRow) => Boolean(room(u, "yellow_male") || room(u, "yellow_female"));

// Salas de uma unidade, na ordem de exibição — só as que existem no giro.
// Matiz identifica a categoria (vermelha/amarela/isolamento); o "+n" verde
// identifica vaga.
type SalaCat = "red" | "yellow" | "iso";
function salas(u: UnitRow): { rot: string; cor: string; cat: SalaCat; o?: number | null; c?: number | null }[] {
  const out: { rot: string; cor: string; cat: SalaCat; o?: number | null; c?: number | null }[] = [
    { rot: "VERM", cor: LOTADA, cat: "red", o: u.red_occupied, c: u.red_capacity },
  ];
  if (temSplitAmarela(u)) {
    out.push({ rot: "AMAR ♂", cor: ATENCAO, cat: "yellow", o: room(u, "yellow_male")?.occupied, c: room(u, "yellow_male")?.capacity });
    out.push({ rot: "AMAR ♀", cor: ATENCAO, cat: "yellow", o: room(u, "yellow_female")?.occupied, c: room(u, "yellow_female")?.capacity });
  } else {
    out.push({ rot: "AMAR", cor: ATENCAO, cat: "yellow", o: u.yellow_occupied, c: u.yellow_capacity });
  }
  if (u.isolation_mode === "split") {
    out.push({ rot: "ISO ♂", cor: ISO, cat: "iso", o: u.isolation_male_occupied, c: u.isolation_male_capacity });
    out.push({ rot: "ISO ♀", cor: ISO, cat: "iso", o: u.isolation_female_occupied, c: u.isolation_female_capacity });
    if (u.isolation_pediatric_capacity != null)
      out.push({ rot: "ISO PED", cor: ISO, cat: "iso", o: u.isolation_pediatric_occupied, c: u.isolation_pediatric_capacity });
  } else {
    out.push({ rot: "ISO", cor: ISO, cat: "iso", o: u.isolation_total_occupied, c: u.isolation_total_capacity });
  }
  return out.filter((s) => s.c != null);
}

// ── Filtro segmentado: a pergunta ativa da tela ──
type FiltroKey = "todas" | "red" | "yellow" | "iso" | "surgeon" | "psych" | "ortho";

const amarelaVac = (u: UnitRow) => temSplitAmarela(u)
  ? (rvac(room(u, "yellow_male")) ?? 0) + (rvac(room(u, "yellow_female")) ?? 0)
  : vac(u.yellow_occupied, u.yellow_capacity);
const isoVac = (u: UnitRow) => u.isolation_mode === "split"
  ? (vac(u.isolation_male_occupied, u.isolation_male_capacity) ?? 0)
    + (vac(u.isolation_female_occupied, u.isolation_female_capacity) ?? 0)
    + (vac(u.isolation_pediatric_occupied, u.isolation_pediatric_capacity) ?? 0)
  : vac(u.isolation_total_occupied, u.isolation_total_capacity);

// Vaga da categoria ativa — filtros de especialista e "todas" leem a vermelha
// (é a pergunta clínica default).
const catVac = (u: UnitRow, f: FiltroKey): number | null =>
  f === "yellow" ? amarelaVac(u) : f === "iso" ? isoVac(u) : vac(u.red_occupied, u.red_capacity);

const CAT_LABEL: Record<FiltroKey, string> = {
  todas: "vermelha", red: "vermelha", yellow: "amarela", iso: "isolamento",
  surgeon: "vermelha", psych: "vermelha", ortho: "vermelha",
};

const SEGS: { k: FiltroKey; rot: string; cor: string }[] = [
  { k: "todas", rot: "Todas", cor: "var(--ink)" },
  { k: "red", rot: "Vermelha", cor: LOTADA },
  { k: "yellow", rot: "Amarela", cor: ATENCAO },
  { k: "iso", rot: "Isolamento", cor: ISO },
  { k: "surgeon", rot: "Cirurgião", cor: "var(--ink)" },
  { k: "psych", rot: "Psiquiatra", cor: "var(--ink)" },
  { k: "ortho", rot: "Ortopedista", cor: "var(--ink)" },
];

const vtName = (k: string) => `upa-${k.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

// ── Alertas de transição de vaga: abriu (0 → >0) e fechou (>0 → 0), por
// categoria, detectados a cada refresh. Só somem com clique. ──
type CatKey = "red" | "yellow" | "iso";
const CAT_NOME: Record<CatKey, string> = { red: "vermelha", yellow: "amarela", iso: "isolamento" };
interface Alerta {
  id: number;
  unitKey: string;
  unitName: string;
  cat: CatKey;
  kind: "abriu" | "fechou";
  n: number;
  hora: string;
}

// ── Ficha corrida: reincidência de silêncio no giro, medida nos eventos do
// /history (mesma relação que o bot do Telegram faz no grupo) ──
interface GiroStats { last: number; gaps: number[]; episodes: number; worst: number; mean: number }

function buildStatsFor(hist: HistEvent[]): (u: UnitRow) => GiroStats | null {
  const evs: { keys: string[]; t: number }[] = [];
  for (const ev of hist) {
    const p = (ev.payload || ev) as Record<string, unknown>;
    const e = ev as unknown as Record<string, unknown>;
    let t: number | null = null;
    for (const f of ["created_at", "received_at", "timestamp", "ts", "updated_at", "time", "date"]) {
      const v = e[f] ?? p[f];
      if (typeof v === "string" || typeof v === "number") {
        const d = new Date(v).getTime();
        if (!Number.isNaN(d)) { t = d; break; }
      }
    }
    if (t == null) continue;
    const keys = [p.unit_key, p.unit_code].filter((x): x is string => typeof x === "string");
    const nm = norm(String(p.canonical_name || p.unit_name || ""));
    if (nm) keys.push(nm);
    if (keys.length) evs.push({ keys, t });
  }
  return (u: UnitRow) => {
    const times = [...new Set(
      evs.filter((ev) => ev.keys.includes(u.unit_key) || ev.keys.includes(norm(u.canonical_name)))
        .map((ev) => ev.t),
    )].sort((a, b) => a - b);
    if (times.length < 2) return null;
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(Math.round((times[i] - times[i - 1]) / 60000));
    const episodes = gaps.filter((g) => g > STALE_MIN).length;
    return {
      last: times[times.length - 1],
      gaps,
      episodes,
      worst: Math.max(...gaps),
      mean: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
    };
  };
}

// ── Linha de vida: pulso ECG na base do card. Fresco pulsa a cada 8s,
// envelhecendo a cada 16s, >6h vira flatline âmbar. ──
function Lifeline({ tier, cor }: { tier: Tier; cor: string }) {
  if (tier === "stale") {
    return (
      <svg className="absolute bottom-0 left-0 w-full h-3" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden>
        <path d="M0 9 H100" fill="none" stroke={ATENCAO} strokeWidth="1.5" opacity="0.55" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const d = "M0 9 H30 L34 9 L37 3 L40 12 L43 9 H100";
  return (
    <svg className="absolute bottom-0 left-0 w-full h-3" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden>
      <path d={d} pathLength={100} fill="none" stroke={cor} strokeWidth="1.5" opacity="0.18" vectorEffect="non-scaling-stroke" />
      <path
        d={d} pathLength={100} fill="none" stroke={cor} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
        className="lifeline-pulse"
        style={{ "--lifeline-dur": tier === "fresh" ? "8s" : "16s" } as React.CSSProperties}
      />
    </svg>
  );
}

// Sparkline dos intervalos entre giros — reincidente crônica fica visualmente
// diferente de deslize pontual.
function GapSpark({ gaps }: { gaps: number[] }) {
  const ultimos = gaps.slice(-10);
  const max = Math.max(...ultimos, STALE_MIN);
  return (
    <svg width={ultimos.length * 11} height="20" aria-hidden>
      {ultimos.map((g, i) => {
        const h = Math.max(2, Math.round((g / max) * 18));
        return (
          <rect key={i} x={i * 11} y={20 - h} width="8" height={h} rx="1.5"
            fill={g > STALE_MIN ? ATENCAO : "#94a3b8"} opacity={g > STALE_MIN ? 1 : 0.55} />
        );
      })}
    </svg>
  );
}

function Ficha({ u, stats }: { u: UnitRow; stats: GiroStats | null }) {
  const a = ageMin(u.updated_at);
  return (
    <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
      style={{ background: "color-mix(in srgb, var(--atencao) 9%, white)", border: `1px solid color-mix(in srgb, var(--atencao) 35%, white)`, color: "var(--ink)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div><b>Último giro:</b> {ageLabel(a)}</div>
      {stats ? (
        <>
          <div>
            <b>Reincidência</b> (janela do histórico):{" "}
            <b style={{ color: stats.episodes > 0 ? ATENCAO : LIVRE }}>
              {stats.episodes} episódio{stats.episodes === 1 ? "" : "s"} &gt; 6h sem atualizar
            </b>
          </div>
          <div className="flex items-center gap-2 my-1">
            <GapSpark gaps={stats.gaps} />
            <span className="text-slate-500">intervalos entre giros</span>
          </div>
          <div className="text-slate-600">pior: {hLabel(stats.worst)} · média entre giros: {hLabel(stats.mean)}</div>
        </>
      ) : (
        <div className="text-slate-500">Histórico insuficiente na janela para medir reincidência.</div>
      )}
    </div>
  );
}

function UnitCard({
  u,
  filtro,
  isSel,
  restricted,
  glow,
  entrance,
  fichaAberta,
  stats,
  onSelect,
  onToggleFicha,
  onToggleRestriction,
}: {
  u: UnitRow;
  filtro: FiltroKey;
  isSel: boolean;
  restricted: UpaRestriction | null;
  glow: boolean;
  entrance: number | null;
  fichaAberta: boolean;
  stats: GiroStats | null;
  onSelect: (k: string) => void;
  onToggleFicha: (k: string) => void;
  onToggleRestriction: (u: UnitRow) => void;
}) {
  const a = ageMin(u.updated_at);
  const tier = tierOf(a);
  const v = catVac(u, filtro);
  const catLabel = CAT_LABEL[filtro];

  // Restrição da chefia manda em tudo; depois o pó do tempo; depois o semáforo
  // da categoria ativa.
  const tone = restricted ? RESTRITA
    : tier === "stale" ? ATENCAO
    : u.is_critical || v === 0 ? LOTADA
    : v != null && v > 0 ? LIVRE
    : NEUTRO;
  const bg = restricted
    ? "linear-gradient(180deg, #e8e6e2 0%, var(--restrita-fundo) 100%)"
    : tier === "stale"
      ? "color-mix(in srgb, var(--atencao) 8%, #f2f1ed)"
      : `color-mix(in srgb, ${tone} 7%, white)`;

  const esp = ([["Cirurgião", u.has_surgeon, filtro === "surgeon"], ["Psiquiatra", u.has_psychiatrist, filtro === "psych"], ["Ortopedista", u.has_orthopedist, filtro === "ortho"]] as const)
    .filter(([, on]) => on);

  return (
    <div
      id={vtName(u.unit_key)}
      onClick={() => onSelect(u.unit_key)}
      className={`flex flex-col gap-[7px] rounded-[14px] cursor-pointer transition-colors duration-500 text-left w-full relative overflow-hidden ${glow ? "card-glow" : ""} ${entrance != null ? "card-enter" : ""}`}
      style={{
        padding: "12px 14px 16px 14px",
        background: bg,
        border: restricted
          ? "1.5px solid var(--restrita-borda)"
          : isSel ? `2.5px solid ${tone}` : `1.5px solid color-mix(in srgb, ${tone} 45%, white)`,
        // Restrita afunda: sombra interna + sem relevo. Lotada é vermelha e
        // acesa; restrita é cinza e apagada — não se confundem de longe.
        boxShadow: restricted
          ? `inset 0 2px 6px rgba(16,28,44,.16), inset 0 0 0 1px rgba(255,255,255,.5)${isSel ? ", 0 0 0 4px color-mix(in srgb, var(--restrita) 14%, transparent)" : ""}`
          : isSel ? `0 0 0 4px color-mix(in srgb, ${tone} 12%, transparent)` : "none",
        viewTransitionName: vtName(u.unit_key),
        ...(entrance != null ? { animationDelay: `${entrance * 25}ms` } : null),
      } as React.CSSProperties}
    >
      <div className="flex justify-between items-start gap-2 w-full">
        <h3 className="m-0 f-display text-[15px] font-bold uppercase tracking-wide leading-tight"
          style={restricted ? { color: "#4a5462" } : { color: "var(--ink)" }}>
          {nome(u)}
        </h3>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleRestriction(u); }}
          title={restricted ? "Restrição da chefia — alterar prazo ou liberar" : "Restringir esta UPA (PIN da chefia)"}
          className="text-[11px] leading-none px-[6px] py-[3px] rounded-md border cursor-pointer flex-shrink-0"
          style={restricted
            ? { background: RESTRITA, borderColor: RESTRITA, color: "#fff" }
            : { background: "transparent", borderColor: "color-mix(in srgb, var(--restrita) 25%, white)", color: "color-mix(in srgb, var(--restrita) 55%, white)" }}
        >
          🚫
        </button>
      </div>

      {/* Leitura principal — a resposta da categoria ativa, em corpo de instrumento */}
      <div className="flex items-baseline gap-2" style={tier === "stale" && !restricted ? { opacity: 0.55 } : undefined}>
        {restricted ? (
          <>
            <span className="f-display text-[22px] font-bold leading-none"
              style={{ color: RESTRITA, letterSpacing: "0.06em", textShadow: "0 1px 0 rgba(255,255,255,.7)" }}>RESTRITA</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: RESTRITA, opacity: 0.8 }}>até {restricted.untilLabel}</span>
          </>
        ) : v != null && v > 0 ? (
          <>
            <span key={v} className="num-swap f-display text-[26px] font-bold leading-none" style={{ color: tone }}>{v}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone }}>
              vaga{v === 1 ? "" : "s"} {catLabel}
            </span>
          </>
        ) : v === 0 ? (
          <>
            <span className="f-display text-[20px] font-bold leading-none" style={{ color: tier === "stale" ? "var(--ink)" : tone }}>LOTADA</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{catLabel}</span>
          </>
        ) : (
          <>
            <span className="f-display text-[20px] font-bold leading-none text-slate-400">—</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">sem sala {catLabel}</span>
          </>
        )}
      </div>

      {/* Salas — matiz é a categoria, +n verde é vaga. Com filtro de sala
          ativo, só a categoria da pergunta aparece — o resto é ruído. */}
      <div className="flex flex-wrap gap-x-3 gap-y-[2px]"
        style={restricted
          ? { opacity: 0.42, filter: "grayscale(0.85)" }   // números continuam lá, mas não competem
          : tier === "stale" ? { opacity: 0.55 } : undefined}>
        {salas(u)
          .filter((s) => (filtro === "red" || filtro === "yellow" || filtro === "iso" ? s.cat === filtro : true))
          .map((s) => {
          const sv = vac(s.o, s.c);
          return (
            <span key={s.rot} className="text-[11px] font-semibold whitespace-nowrap" style={{ color: s.cor }} title={`${s.o} ocupados / ${s.c} capacidade`}>
              {s.rot} <span className="opacity-75">{s.o}/{s.c}</span>
              {sv != null && sv > 0 && <b style={{ color: LIVRE }}> +{sv}</b>}
            </span>
          );
        })}
      </div>

      <div className="flex justify-between items-center w-full gap-2" style={restricted ? { opacity: 0.5 } : undefined}>
        <span className="flex gap-1 flex-wrap">
          {esp.map(([l, , hot]) => (
            <span key={l}
              className="text-[10px] px-[7px] py-[2px] rounded-full border font-semibold"
              style={hot
                ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                : { borderColor: "#cbd5e1", color: "#475569", background: "rgba(255,255,255,.6)" }}
            >
              {l}
            </span>
          ))}
        </span>
        {tier !== "stale" && (
          <span className={`text-[10px] ${tier === "aging" ? "font-semibold" : "text-slate-400"}`}
            style={tier === "aging" ? { color: ATENCAO } : undefined}>
            {ageLabel(a)}
          </span>
        )}
      </div>

      {/* Cobrança: selo respirando + ficha corrida no clique */}
      {tier === "stale" && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFicha(u.unit_key); }}
          className="badge-breathe self-start text-[10px] font-bold uppercase tracking-wide px-2 py-[3px] rounded-md cursor-pointer border-none"
          style={{ background: ATENCAO, color: "#fff" }}
          title="Dado velho — clique para ver a ficha de reincidência"
        >
          ⏱ {a == null ? "sem giro registrado" : `${Math.floor(a / 60)}h sem giro`} · ficha
        </button>
      )}
      {tier === "stale" && fichaAberta && <Ficha u={u} stats={stats} />}

      <Lifeline tier={tier} cor={tone} />
    </div>
  );
}

function Linha({ rot, o, c }: { rot: string; o?: number | null; c?: number | null }) {
  const v = vac(o, c);
  return (
    <div className="flex justify-between gap-4 text-[12px] text-slate-600">
      <span>{rot}</span>
      <b style={v != null ? { color: v > 0 ? LIVRE : LOTADA } : { color: "var(--ink)" }}>
        {v == null ? "—" : `${v} vaga${v === 1 ? "" : "s"} (${o}/${c})`}
      </b>
    </div>
  );
}

export default function UpasView({ operador = "" }: { operador?: string }) {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [hist, setHist] = useState<HistEvent[]>([]);
  const [busca, setBusca] = useState("");
  const [stamp, setStamp] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroKey>("todas");
  const [fichaDe, setFichaDe] = useState<string | null>(null);
  const [glow, setGlow] = useState<Set<string>>(new Set());
  const [entrance, setEntrance] = useState(true);
  const [alerts, setAlerts] = useState<Alerta[]>([]);
  const prevVacs = useRef<Map<string, Record<CatKey, number | null>>>(new Map());

  // ── Restrições da chefia ──
  const { data: restrictions = [] } = useUpaRestrictions();
  const restrictUpa = useRestrictUpa();
  const liberateUpa = useLiberateUpa();
  const [restrTarget, setRestrTarget] = useState<{ unitKey: string; unitName: string } | null>(null);
  // Ação aguardando PIN (o modal de prazo fecha e o PinDialog assume).
  const [pinAction, setPinAction] = useState<
    | { kind: "restrict"; unitKey: string; unitName: string; until: string; detail: string }
    | { kind: "liberate"; id: number; unitName: string; detail: string }
    | null
  >(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  // Cache em memória do último PIN válido (some ao recarregar), como no painel.
  const pinCache = useRef("");

  const restrictionByUnit = useMemo(() => {
    const map = new Map<string, UpaRestriction>();
    for (const r of restrictions) map.set(r.unitKey, r);
    return map;
  }, [restrictions]);

  const abrirRestricao = useCallback((u: UnitRow) => {
    setRestrTarget({ unitKey: u.unit_key, unitName: nome(u) });
  }, []);

  const pedirPin = (action: NonNullable<typeof pinAction>) => {
    setPinError(null);
    setRestrTarget(null);
    setPinAction(action);
  };

  const submitPin = async (pin: string) => {
    if (!pinAction) return;
    setPinBusy(true);
    setPinError(null);
    try {
      if (pinAction.kind === "restrict") {
        await restrictUpa.mutateAsync({
          data: {
            unitKey: pinAction.unitKey,
            unitName: pinAction.unitName,
            until: pinAction.until,
            autor: operador,
          },
          pin,
        });
      } else {
        await liberateUpa.mutateAsync({ id: pinAction.id, removidoPor: operador, pin });
      }
      pinCache.current = pin;
      setPinAction(null);
    } catch (e) {
      pinCache.current = ""; // PIN pode estar errado — não reaproveita
      setPinError(e instanceof Error ? e.message : "Falha ao validar o PIN");
    } finally {
      setPinBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        fetch(`${API}/summary`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${API}/history?limit=500`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ events: [] })),
      ]);
      const novas: UnitRow[] = (s.units || []).filter((u: UnitRow) => u.updated_at);
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      // Transições de vaga desde o último refresh → glow no card + alerta
      const abriuGlow = new Set<string>();
      const novosAlertas: Alerta[] = [];
      const primeiraCarga = prevVacs.current.size === 0;
      for (const u of novas) {
        const cur: Record<CatKey, number | null> = {
          red: vac(u.red_occupied, u.red_capacity),
          yellow: amarelaVac(u),
          iso: isoVac(u),
        };
        const antes = prevVacs.current.get(u.unit_key);
        if (antes && !primeiraCarga) {
          if (cur.red != null && antes.red != null && cur.red > antes.red) abriuGlow.add(u.unit_key);
          for (const c of ["red", "yellow", "iso"] as CatKey[]) {
            const a = antes[c], n = cur[c];
            if (a == null || n == null) continue;
            if (a === 0 && n > 0)
              novosAlertas.push({ id: Date.now() + novosAlertas.length, unitKey: u.unit_key, unitName: nome(u), cat: c, kind: "abriu", n, hora });
            else if (a > 0 && n === 0)
              novosAlertas.push({ id: Date.now() + novosAlertas.length, unitKey: u.unit_key, unitName: nome(u), cat: c, kind: "fechou", n: a, hora });
          }
        }
        prevVacs.current.set(u.unit_key, cur);
      }
      setUnits(novas);
      setHist(h.events || []);
      setStamp(hora);
      if (abriuGlow.size > 0) {
        setGlow(abriuGlow);
        setTimeout(() => setGlow(new Set()), 1000);
      }
      // Alerta velho morre sozinho quando a realidade dele acaba (vaga que
      // abriu foi ocupada, vaga que fechou reabriu) — e o mesmo par
      // unidade+categoria nunca acumula dois cartões.
      // ponytail: cap de 8 alertas vivos; se virar flood, vira central de eventos noutra fase
      setAlerts((prev) => {
        const substituidos = new Set(novosAlertas.map((a) => `${a.unitKey}|${a.cat}`));
        const vivos = prev.filter((a) => {
          if (substituidos.has(`${a.unitKey}|${a.cat}`)) return false;
          const v = prevVacs.current.get(a.unitKey)?.[a.cat];
          if (v == null) return true;
          return a.kind === "abriu" ? v > 0 : v === 0;
        });
        if (vivos.length === prev.length && novosAlertas.length === 0) return prev;
        return [...vivos, ...novosAlertas].slice(-8);
      });
    } catch { /* mantém último estado */ }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // Alerta pendente pisca o título da aba — quem está noutra janela vê
  useEffect(() => {
    if (alerts.length === 0) return;
    const orig = document.title;
    const temAbriu = alerts.some((a) => a.kind === "abriu");
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on
        ? `${temAbriu ? "🟢" : "🔴"} ${alerts.length} alerta${alerts.length === 1 ? "" : "s"} de vaga — UPAs`
        : orig;
    }, 1200);
    return () => { clearInterval(id); document.title = orig; };
  }, [alerts]);

  // Stagger de entrada só no primeiro load
  const temDados = units.length > 0;
  useEffect(() => {
    if (!temDados) return;
    const t = setTimeout(() => setEntrance(false), 1200);
    return () => clearTimeout(t);
  }, [temDados]);

  const statsFor = useMemo(() => buildStatsFor(hist), [hist]);

  const rawFor = useCallback((u: UnitRow): string | null => {
    const own = (u.payload?.data as Record<string, unknown> | undefined)?.raw_text;
    if (typeof own === "string" && own.trim().length > 10) return own;
    for (const ev of hist) {
      const p = (ev.payload || ev) as Record<string, unknown>;
      const keys = [p.unit_key, p.unit_code, norm(String(p.canonical_name || p.unit_name || ""))];
      if (keys.includes(u.unit_key) || keys.includes(norm(u.canonical_name))) {
        for (const f of ["raw_message", "raw_text", "raw", "message", "original_text", "text"]) {
          const v = p[f];
          if (typeof v === "string" && v.trim().length > 10) return v;
        }
        return JSON.stringify(p, null, 2);
      }
    }
    return null;
  }, [hist]);

  const match = useCallback((u: UnitRow) => !busca || norm(nome(u)).includes(norm(busca)), [busca]);

  // Troca de filtro com View Transition — cards deslizam pra nova posição
  const mudarFiltro = (k: FiltroKey) => {
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (d.startViewTransition) d.startViewTransition(() => flushSync(() => setFiltro(k)));
    else setFiltro(k);
  };

  // Grid: restritas no topo (decisão da chefia muda a conduta), empoeiradas
  // (>6h) afundam pro fim (dado morto não merece posição nobre), e no meio
  // ordena pela vaga da categoria ativa.
  const ordenadas = useMemo(() => {
    let visiveis = units.filter(match);
    if (filtro === "surgeon") visiveis = visiveis.filter((u) => u.has_surgeon);
    if (filtro === "psych") visiveis = visiveis.filter((u) => u.has_psychiatrist);
    if (filtro === "ortho") visiveis = visiveis.filter((u) => u.has_orthopedist);
    const rank = (u: UnitRow) => {
      const restr = restrictionByUnit.has(u.unit_key) ? 0 : 1;
      const poeira = tierOf(ageMin(u.updated_at)) === "stale" ? 1 : 0;
      return [restr, poeira, -(catVac(u, filtro) ?? -1)] as const;
    };
    return [...visiveis].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return nome(a).localeCompare(nome(b));
    });
  }, [units, match, restrictionByUnit, filtro]);

  const contagem = useMemo(() => {
    const soma = (f: (u: UnitRow) => number | null) => units.reduce((acc, u) => acc + (f(u) ?? 0), 0);
    return {
      todas: units.length,
      red: soma((u) => vac(u.red_occupied, u.red_capacity)),
      yellow: soma(amarelaVac),
      iso: soma(isoVac),
      surgeon: units.filter((u) => u.has_surgeon).length,
      psych: units.filter((u) => u.has_psychiatrist).length,
      ortho: units.filter((u) => u.has_orthopedist).length,
    } as Record<FiltroKey, number>;
  }, [units]);

  // Clique no alerta: descarta, garante o card visível (filtro de especialista
  // pode escondê-lo), seleciona e rola até ele.
  const ackAlert = (a: Alerta) => {
    setAlerts((prev) => prev.filter((x) => x.id !== a.id));
    const u = units.find((x) => x.unit_key === a.unitKey);
    const escondido = u && (
      (filtro === "surgeon" && !u.has_surgeon) ||
      (filtro === "psych" && !u.has_psychiatrist) ||
      (filtro === "ortho" && !u.has_orthopedist)
    );
    if (escondido) setFiltro("todas");
    setSel(a.unitKey);
    requestAnimationFrame(() => {
      document.getElementById(vtName(a.unitKey))?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const selU = useMemo(() => ordenadas.find((u) => u.unit_key === sel) ?? null, [ordenadas, sel]);
  const selStats = selU ? statsFor(selU) : null;

  const VAZIO: Record<FiltroKey, string> = {
    todas: "Nenhuma UPA nessa busca.",
    red: "Nenhuma UPA nessa busca.",
    yellow: "Nenhuma UPA nessa busca.",
    iso: "Nenhuma UPA nessa busca.",
    surgeon: "Nenhuma UPA com cirurgião de plantão agora.",
    psych: "Nenhuma UPA com psiquiatra de plantão agora.",
    ortho: "Nenhuma UPA com ortopedista de plantão agora.",
  };

  return (
    <div className="upas-root">
      {/* Busca + stamp */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input
          placeholder="Buscar UPA…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="py-[6px] px-3 rounded-[10px] border border-slate-300 bg-white text-sm w-[220px] outline-none focus:border-blue-400"
        />
        <span className="text-[11px] text-slate-500 inline-flex items-center gap-[6px]">
          <span className="inline-block w-[6px] h-[6px] rounded-full" style={{ background: LIVRE }} />
          {units.length} unidade{units.length === 1 ? "" : "s"} com giro · atualizado {stamp || "…"}
        </span>
      </div>

      {/* Filtro segmentado — a pergunta ativa. O número no segmento é o total
          de vagas (ou plantonistas) da categoria na cidade. */}
      <div className="inline-flex flex-wrap rounded-[12px] border border-slate-300 bg-white overflow-hidden mb-3">
        {SEGS.map((s, i) => {
          const ativo = filtro === s.k;
          const n = contagem[s.k];
          return (
            <button
              key={s.k}
              onClick={() => mudarFiltro(s.k)}
              className={`px-3 py-[7px] text-[12px] font-semibold cursor-pointer flex items-center gap-[6px] transition-colors ${i > 0 ? "border-l border-slate-200" : ""}`}
              style={ativo
                ? { background: s.cor, color: "#fff", border: "none", borderLeft: i > 0 ? "1px solid transparent" : "none" }
                : { background: "transparent", color: "var(--ink)", border: "none", borderLeft: i > 0 ? "1px solid #e2e8f0" : "none" }}
            >
              {s.rot}
              {s.k !== "todas" && (
                <b className="f-display text-[13px]" style={{ color: ativo ? "#fff" : n > 0 ? s.cor : "#94a3b8" }}>{n}</b>
              )}
            </button>
          );
        })}
      </div>

      {/* Faixa de restrições — o que a chefia decidiu, acima de qualquer número.
          Também é a única forma de mexer numa restrição cuja UPA parou de mandar
          giro (o card some do grid, a restrição continua valendo). */}
      {restrictions.length > 0 && (
        <div className="rounded-[10px] border mb-4 px-4 py-3"
          style={{
            borderColor: "var(--restrita-borda)",
            background: "linear-gradient(180deg, #e8e6e2 0%, var(--restrita-fundo) 100%)",
            boxShadow: "inset 0 2px 6px rgba(16,28,44,.14)",
          }}>
          <div className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: RESTRITA }}>
            🚫 {restrictions.length} UPA{restrictions.length === 1 ? "" : "s"} restrita{restrictions.length === 1 ? "" : "s"} pela chefia
          </div>
          <div className="flex flex-wrap gap-2">
            {restrictions.map((r) => (
              <button
                key={r.id}
                onClick={() => setRestrTarget({ unitKey: r.unitKey, unitName: r.unitName })}
                className="text-[12px] font-bold px-3 py-[5px] rounded-full border-2 bg-white cursor-pointer"
                style={{ borderColor: RESTRITA, color: RESTRITA }}
                title={`Restrita por ${r.autor} — clique para alterar o prazo ou liberar`}
              >
                {r.unitName} · até {r.untilLabel}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid — card inteiro carrega o estado; linha de vida na base */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ordenadas.length === 0 && (
          <div className="text-[13px] text-slate-400 py-6 col-span-full">
            {units.length === 0
              ? "Nenhum giro recebido ainda — quando as UPAs postarem no WhatsApp, os cards aparecem sozinhos."
              : VAZIO[filtro]}
          </div>
        )}
        {ordenadas.map((u, i) => (
          <UnitCard
            key={u.unit_key}
            u={u}
            filtro={filtro}
            isSel={sel === u.unit_key}
            restricted={restrictionByUnit.get(u.unit_key) ?? null}
            glow={glow.has(u.unit_key)}
            entrance={entrance ? i : null}
            fichaAberta={fichaDe === u.unit_key}
            stats={statsFor(u)}
            onSelect={(k) => setSel(sel === k ? null : k)}
            onToggleFicha={(k) => setFichaDe(fichaDe === k ? null : k)}
            onToggleRestriction={abrirRestricao}
          />
        ))}
      </div>

      {/* Detail panel — full-width abaixo do grid */}
      {selU && (
        <div className="bg-white border-2 border-slate-200 rounded-[14px] p-5 mt-4 shadow-sm origin-top detail-enter">
          <div className="flex justify-between items-start gap-3 mb-3">
            <h2 className="m-0 f-display text-lg font-bold uppercase tracking-wide" style={{ color: "var(--ink)" }}>{nome(selU)}</h2>
            <span className="flex items-center gap-3">
              <button
                onClick={() => abrirRestricao(selU)}
                className="text-[12px] font-bold px-3 py-[5px] rounded-lg border-2 cursor-pointer"
                style={restrictionByUnit.has(selU.unit_key)
                  ? { borderColor: RESTRITA, background: RESTRITA, color: "#fff" }
                  : { borderColor: "color-mix(in srgb, var(--restrita) 30%, white)", background: "#fff", color: RESTRITA }}
              >
                {restrictionByUnit.has(selU.unit_key) ? "🚫 Restrita — alterar" : "🚫 Restringir"}
              </button>
              <button
                onClick={() => setSel(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold bg-transparent border-none cursor-pointer"
              >
                ✕ fechar
              </button>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 max-w-[560px] mb-3">
            <Linha rot="Vermelha" o={selU.red_occupied} c={selU.red_capacity} />
            {temSplitAmarela(selU) ? (
              <>
                <Linha rot="Amarela ♂" o={room(selU, "yellow_male")?.occupied} c={room(selU, "yellow_male")?.capacity} />
                <Linha rot="Amarela ♀" o={room(selU, "yellow_female")?.occupied} c={room(selU, "yellow_female")?.capacity} />
              </>
            ) : (
              <Linha rot="Amarela" o={selU.yellow_occupied} c={selU.yellow_capacity} />
            )}
            {selU.isolation_mode === "split" ? (
              <>
                <Linha rot="Isolamento ♂" o={selU.isolation_male_occupied} c={selU.isolation_male_capacity} />
                <Linha rot="Isolamento ♀" o={selU.isolation_female_occupied} c={selU.isolation_female_capacity} />
                {selU.isolation_pediatric_capacity != null && (
                  <Linha rot="Isolamento ped." o={selU.isolation_pediatric_occupied} c={selU.isolation_pediatric_capacity} />
                )}
              </>
            ) : (
              <Linha rot="Isolamento" o={selU.isolation_total_occupied} c={selU.isolation_total_capacity} />
            )}
          </div>
          <div className="flex gap-1 flex-wrap mb-3">
            {([["cirurgia", selU.has_surgeon], ["psiquiatria", selU.has_psychiatrist], ["ortopedia", selU.has_orthopedist]] as const).map(([l, on]) => (
              <span key={l} className={`text-[10px] px-2 py-[2px] rounded-full border ${on ? "border-blue-300 bg-blue-50 text-blue-800 font-bold" : "border-slate-200 text-slate-400"}`}>{l}</span>
            ))}
            <span className={`text-[10px] px-2 py-[2px] ${(ageMin(selU.updated_at) ?? 0) > STALE_MIN ? "font-bold" : "text-slate-400"}`}
              style={(ageMin(selU.updated_at) ?? 0) > STALE_MIN ? { color: ATENCAO } : undefined}>
              atualizado {ageLabel(ageMin(selU.updated_at))}
            </span>
          </div>
          {selStats && (
            <div className="mb-3 max-w-[420px]">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Regularidade do giro</div>
              <Ficha u={selU} stats={selStats} />
            </div>
          )}
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Giro bruto</div>
          <pre className="m-0 p-3 bg-slate-50 border border-slate-200 rounded-lg f-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-72 overflow-auto text-slate-700">
            {rawFor(selU) || "Nenhum giro bruto registrado ainda para esta unidade."}
          </pre>
        </div>
      )}

      {restrTarget && (
        <UpaRestrictionModal
          unitKey={restrTarget.unitKey}
          unitName={restrTarget.unitName}
          current={restrictionByUnit.get(restrTarget.unitKey) ?? null}
          operador={operador}
          onClose={() => setRestrTarget(null)}
          onRestrict={(until) =>
            pedirPin({
              kind: "restrict",
              unitKey: restrTarget.unitKey,
              unitName: restrTarget.unitName,
              until,
              detail: `Restringir ${restrTarget.unitName} até ${new Date(until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
            })
          }
          onLiberate={() => {
            const atual = restrictionByUnit.get(restrTarget.unitKey);
            if (!atual) return;
            pedirPin({
              kind: "liberate",
              id: atual.id,
              unitName: restrTarget.unitName,
              detail: `Liberar ${restrTarget.unitName} (restrita até ${atual.untilLabel})`,
            });
          }}
        />
      )}

      {/* Alertas de transição — fixos até o clique; abriu pulsa, fechou não */}
      {alerts.length > 0 && (
        <div className="fixed top-3 right-3 z-[200] flex flex-col gap-2 w-[300px] max-h-[80vh] overflow-y-auto">
          {alerts.map((a) => {
            const abriu = a.kind === "abriu";
            const cor = abriu ? LIVRE : LOTADA;
            return (
              <button
                key={a.id}
                onClick={() => ackAlert(a)}
                className={`text-left rounded-xl px-4 py-3 cursor-pointer border-2 ${abriu ? "alert-abriu" : "alert-in"}`}
                style={{
                  borderColor: cor,
                  background: `color-mix(in srgb, ${cor} 8%, white)`,
                  boxShadow: "0 8px 24px rgba(16,28,44,.18)",
                }}
              >
                <div className="f-display text-[17px] font-bold leading-tight" style={{ color: cor }}>
                  {abriu ? `+${a.n} VAGA${a.n === 1 ? "" : "S"} ${CAT_NOME[a.cat].toUpperCase()}` : `FECHOU ${CAT_NOME[a.cat].toUpperCase()}`}
                </div>
                <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>{a.unitName}</div>
                <div className="text-[10px] mt-[2px]" style={{ color: "color-mix(in srgb, var(--ink) 60%, white)" }}>
                  {a.hora} · clique para ver o card
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pinAction && (
        <PinDialog
          subtitle="Restringir ou liberar uma UPA exige o PIN da chefia."
          detail={pinAction.detail}
          initialPin={pinCache.current}
          error={pinError}
          busy={pinBusy}
          onConfirm={submitPin}
          onCancel={() => {
            setPinAction(null);
            setPinError(null);
          }}
        />
      )}
    </div>
  );
}
