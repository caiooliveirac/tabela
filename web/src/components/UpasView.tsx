import { useState, useEffect, useMemo, useCallback } from "react";

// Aba UPAs — visão da cidade do Giro de Leitos, consumindo a API pública do
// giro-de-leitos montada em /tabela/upas/api (nginx). Mesma linguagem visual do
// Painel de Vagas: KPI strip horizontal, grid único de cards compactos com
// barra lateral semáforo e detail panel full-width abaixo do grid.

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
interface KpiName { nome: string; n?: number }

const API = "/tabela/upas/api";
const GRN = "hsl(140,75%,32%)";
const RED = "hsl(0,85%,38%)";

const norm = (s: string | null | undefined) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// tom claro derivado de uma cor hsl(H,S%,L%) — pra fundo de chip mantendo o matiz
const tint = (c: string, l = 95) => {
  const m = c.match(/hsl\((\d+),\s*(\d+)%/);
  return m ? `hsl(${m[1]},${Math.min(+m[2], 65)}%,${l}%)` : "hsl(210,20%,96%)";
};
const room = (u: UnitRow, k: string): Room | null => u.payload?.data?.rooms?.[k] ?? null;
const vac = (o?: number | null, c?: number | null) =>
  c == null || o == null ? null : Math.max(c - o, 0);
const rvac = (r: Room | null) => vac(r?.occupied, r?.capacity);
const nome = (u: UnitRow) => u.displayed_name || u.canonical_name;
const ageMin = (iso?: string | null) =>
  iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;
const ageLabel = (a: number | null) =>
  a == null ? "sem atualização" : a >= 60 ? `há ${Math.floor(a / 60)}h${String(a % 60).padStart(2, "0")}` : `há ${a} min`;

const temSplitAmarela = (u: UnitRow) => Boolean(room(u, "yellow_male") || room(u, "yellow_female"));

// Salas de uma unidade, na ordem de exibição — só as que existem no giro
function salas(u: UnitRow): { rot: string; o?: number | null; c?: number | null }[] {
  const out: { rot: string; o?: number | null; c?: number | null }[] = [
    { rot: "🔴", o: u.red_occupied, c: u.red_capacity },
  ];
  if (temSplitAmarela(u)) {
    out.push({ rot: "🟡♂", o: room(u, "yellow_male")?.occupied, c: room(u, "yellow_male")?.capacity });
    out.push({ rot: "🟡♀", o: room(u, "yellow_female")?.occupied, c: room(u, "yellow_female")?.capacity });
  } else {
    out.push({ rot: "🟡", o: u.yellow_occupied, c: u.yellow_capacity });
  }
  if (u.isolation_mode === "split") {
    out.push({ rot: "🦠♂", o: u.isolation_male_occupied, c: u.isolation_male_capacity });
    out.push({ rot: "🦠♀", o: u.isolation_female_occupied, c: u.isolation_female_capacity });
    if (u.isolation_pediatric_capacity != null)
      out.push({ rot: "🦠🧒", o: u.isolation_pediatric_occupied, c: u.isolation_pediatric_capacity });
  } else {
    out.push({ rot: "🦠", o: u.isolation_total_occupied, c: u.isolation_total_capacity });
  }
  return out.filter((s) => s.c != null);
}

function Chip({ rot, o, c }: { rot: string; o?: number | null; c?: number | null }) {
  const v = vac(o, c);
  if (v == null) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px] font-extrabold px-[7px] py-[2px] rounded-md border"
      style={v > 0
        ? { borderColor: "hsl(140,50%,72%)", background: "hsl(140,60%,95%)", color: GRN }
        : { borderColor: "hsl(0,60%,84%)", background: "hsl(0,70%,96%)", color: RED }}
      title={`${o} ocupados / ${c} capacidade`}
    >
      <span className="text-[13px] leading-none">{rot}</span>
      <span>{v > 0 ? `${v} livre${v === 1 ? "" : "s"}` : "lotada"}</span>
      <span className="opacity-60 font-bold">{o}/{c}</span>
    </span>
  );
}

function UnitCard({ u, isSel, onSelect }: { u: UnitRow; isSel: boolean; onSelect: (k: string) => void }) {
  const rv = vac(u.red_occupied, u.red_capacity);
  const a = ageMin(u.updated_at);
  const cor = u.is_critical || rv === 0 ? RED : rv != null && rv > 0 ? GRN : "#94a3b8";
  const esp = ([["🔪", "Cirurgião", u.has_surgeon], ["🧠", "Psiquiatra", u.has_psychiatrist], ["🦴", "Ortopedista", u.has_orthopedist]] as const)
    .filter(([, , on]) => on);
  return (
    <button
      onClick={() => onSelect(u.unit_key)}
      className="flex flex-col gap-[6px] rounded-[14px] cursor-pointer transition-all text-left outline-none w-full relative overflow-hidden bg-white"
      style={{
        padding: "12px 14px 10px 16px",
        border: isSel ? `3px solid ${cor}` : `2px solid ${cor}66`,
        boxShadow: isSel ? `0 0 0 4px ${cor}15, 0 0 10px ${cor}33` : `0 0 8px ${cor}22`,
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[5px]" style={{ backgroundColor: cor }} />
      <div className="flex justify-between items-start gap-2 w-full">
        <h3 className="m-0 text-[13px] font-black text-slate-900 leading-tight">{nome(u)}</h3>
        {rv != null && (
          <span
            className="text-[10px] font-black px-2 py-[2px] rounded-full whitespace-nowrap flex-shrink-0"
            style={rv > 0 ? { background: "hsl(140,60%,94%)", color: GRN } : { background: "hsl(0,70%,96%)", color: RED }}
          >
            {rv > 0 ? `${rv} vaga${rv === 1 ? "" : "s"} 🔴` : "lotada"}
          </span>
        )}
      </div>
      <div className="flex gap-1 flex-wrap">
        {salas(u).map((s) => <Chip key={s.rot} {...s} />)}
      </div>
      <div className="flex justify-between items-center w-full">
        <span className="flex gap-1 flex-wrap">
          {esp.map(([e, l]) => (
            <span key={e} className="inline-flex items-center gap-[3px] text-[11px] font-bold px-[6px] py-[2px] rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700">
              <span className="text-[13px] leading-none">{e}</span>{l}
            </span>
          ))}
        </span>
        <span className={`text-[10px] ${a != null && a > 360 ? "text-amber-600 font-bold" : "text-slate-400"}`}>
          {ageLabel(a)}
        </span>
      </div>
    </button>
  );
}

function Linha({ rot, o, c }: { rot: string; o?: number | null; c?: number | null }) {
  const v = vac(o, c);
  return (
    <div className="flex justify-between gap-4 text-[12px] text-slate-600">
      <span>{rot}</span>
      <b style={v != null ? { color: v > 0 ? GRN : RED } : { color: "#0f172a" }}>
        {v == null ? "—" : `${v} vaga${v === 1 ? "" : "s"} (${o}/${c})`}
      </b>
    </div>
  );
}

export default function UpasView() {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [hist, setHist] = useState<HistEvent[]>([]);
  const [busca, setBusca] = useState("");
  const [stamp, setStamp] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        fetch(`${API}/summary`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`${API}/history?limit=100`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ events: [] })),
      ]);
      setUnits((s.units || []).filter((u: UnitRow) => u.updated_at));
      setHist(h.events || []);
      setStamp(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch { /* mantém último estado */ }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [load]);

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

  // Grid único: com vaga de vermelha primeiro (mais vagas → topo), depois o resto por nome
  const ordenadas = useMemo(() => {
    const visiveis = units.filter(match);
    const comVaga = visiveis.filter((u) => (vac(u.red_occupied, u.red_capacity) ?? 0) > 0)
      .sort((a, b) => (vac(b.red_occupied, b.red_capacity) ?? 0) - (vac(a.red_occupied, a.red_capacity) ?? 0));
    const resto = visiveis.filter((u) => !((vac(u.red_occupied, u.red_capacity) ?? 0) > 0))
      .sort((a, b) => nome(a).localeCompare(nome(b)));
    return [...comVaga, ...resto];
  }, [units, match]);

  const kpis = useMemo(() => {
    const soma = (get: (u: UnitRow) => number | null) =>
      units.reduce((acc, u) => acc + (get(u) ?? 0), 0);
    const amarela = (u: UnitRow) => temSplitAmarela(u)
      ? (rvac(room(u, "yellow_male")) ?? 0) + (rvac(room(u, "yellow_female")) ?? 0)
      : vac(u.yellow_occupied, u.yellow_capacity);
    const iso = (u: UnitRow) => u.isolation_mode === "split"
      ? (vac(u.isolation_male_occupied, u.isolation_male_capacity) ?? 0)
        + (vac(u.isolation_female_occupied, u.isolation_female_capacity) ?? 0)
        + (vac(u.isolation_pediatric_occupied, u.isolation_pediatric_capacity) ?? 0)
      : vac(u.isolation_total_occupied, u.isolation_total_capacity);
    // lista de UPAs com vaga na categoria, ordenada por quem tem mais vaga, com o nº de vagas
    const listaCom = (f: (u: UnitRow) => number | null): KpiName[] =>
      units.filter((u) => (f(u) ?? 0) > 0)
        .sort((a, b) => (f(b) ?? 0) - (f(a) ?? 0))
        .map((u) => ({ nome: nome(u), n: f(u) ?? undefined }));
    // lista de UPAs que têm o especialista de plantão
    const listaFlag = (f: keyof UnitRow): KpiName[] =>
      units.filter((u) => u[f]).map((u) => ({ nome: nome(u) }));
    const comVagaRed = units.filter((u) => (vac(u.red_occupied, u.red_capacity) ?? 0) > 0);
    return [
      { l: "Vagas vermelha", v: soma((u) => vac(u.red_occupied, u.red_capacity)), c: RED, names: listaCom((u) => vac(u.red_occupied, u.red_capacity)) },
      { l: "UPAs c/ vaga 🔴", v: `${comVagaRed.length}/${units.length}`, c: comVagaRed.length > 0 ? GRN : RED, names: comVagaRed.map((u) => ({ nome: nome(u), n: vac(u.red_occupied, u.red_capacity) ?? undefined })) },
      { l: "Vagas amarela", v: soma(amarela), c: "hsl(45,80%,35%)", names: listaCom(amarela) },
      { l: "Vagas isolamento", v: soma(iso), c: "hsl(200,80%,35%)", names: listaCom(iso) },
      { l: "🔪 Cirurgião", v: units.filter((u) => u.has_surgeon).length, c: "hsl(220,70%,40%)", names: listaFlag("has_surgeon") },
      { l: "🧠 Psiquiatra", v: units.filter((u) => u.has_psychiatrist).length, c: "hsl(270,60%,45%)", names: listaFlag("has_psychiatrist") },
      { l: "🦴 Ortopedista", v: units.filter((u) => u.has_orthopedist).length, c: "hsl(30,75%,40%)", names: listaFlag("has_orthopedist") },
    ];
  }, [units]);

  const selU = useMemo(() => ordenadas.find((u) => u.unit_key === sel) ?? null, [ordenadas, sel]);

  return (
    <div>
      {/* Busca + stamp */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input
          placeholder="Buscar UPA…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="py-[6px] px-3 rounded-[10px] border border-slate-300 bg-white text-sm w-[220px] outline-none focus:border-blue-400"
        />
        <span className="text-[11px] text-slate-500">
          {units.length} unidade{units.length === 1 ? "" : "s"} com giro · atualizado {stamp || "…"}
        </span>
      </div>

      {/* KPI strip — número + rótulo e, embaixo, os nomes das UPAs de cada categoria */}
      <div className="flex flex-wrap gap-[1px] bg-slate-200 border border-slate-200 rounded-[10px] overflow-hidden mb-4">
        {kpis.map((k) => (
          <div
            key={k.l}
            className="flex-1 min-w-[190px] py-2 px-3 bg-white flex flex-col gap-[6px]"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black" style={{ color: k.c }}>{k.v}</span>
              <span className="text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{k.l}</span>
            </div>
            {k.names.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {k.names.map((nm) => (
                  <span
                    key={nm.nome}
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-[6px] py-[1px] rounded-md border"
                    style={{ color: k.c, borderColor: tint(k.c, 82), background: tint(k.c, 96) }}
                  >
                    {nm.nome}
                    {nm.n != null && <span className="opacity-70 font-black">{nm.n}</span>}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[10px] text-slate-300 italic">nenhuma</span>
            )}
          </div>
        ))}
      </div>

      {/* Grid único — semáforo pela borda: verde tem vaga 🔴, vermelho lotada/crítica */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ordenadas.length === 0 && (
          <div className="text-[13px] text-slate-400 py-6 col-span-full">
            {units.length === 0
              ? "Nenhum giro recebido ainda — quando as UPAs postarem no WhatsApp, os cards aparecem sozinhos."
              : "Nenhuma UPA nessa busca."}
          </div>
        )}
        {ordenadas.map((u) => (
          <UnitCard key={u.unit_key} u={u} isSel={sel === u.unit_key} onSelect={(k) => setSel(sel === k ? null : k)} />
        ))}
      </div>

      {/* Detail panel — full-width abaixo do grid, como no semáforo */}
      {selU && (
        <div className="bg-white border-2 border-slate-200 rounded-[14px] p-5 mt-4 shadow-sm origin-top detail-enter">
          <div className="flex justify-between items-start gap-3 mb-3">
            <h2 className="m-0 text-base font-black text-slate-900">{nome(selU)}</h2>
            <button
              onClick={() => setSel(null)}
              className="text-slate-400 hover:text-slate-600 text-sm font-bold bg-transparent border-none cursor-pointer"
            >
              ✕ fechar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 max-w-[560px] mb-3">
            <Linha rot="🔴 Vermelha" o={selU.red_occupied} c={selU.red_capacity} />
            {temSplitAmarela(selU) ? (
              <>
                <Linha rot="🟡 Amarela ♂" o={room(selU, "yellow_male")?.occupied} c={room(selU, "yellow_male")?.capacity} />
                <Linha rot="🟡 Amarela ♀" o={room(selU, "yellow_female")?.occupied} c={room(selU, "yellow_female")?.capacity} />
              </>
            ) : (
              <Linha rot="🟡 Amarela" o={selU.yellow_occupied} c={selU.yellow_capacity} />
            )}
            {selU.isolation_mode === "split" ? (
              <>
                <Linha rot="🦠 Isolamento ♂" o={selU.isolation_male_occupied} c={selU.isolation_male_capacity} />
                <Linha rot="🦠 Isolamento ♀" o={selU.isolation_female_occupied} c={selU.isolation_female_capacity} />
                {selU.isolation_pediatric_capacity != null && (
                  <Linha rot="🦠 Isolamento ped." o={selU.isolation_pediatric_occupied} c={selU.isolation_pediatric_capacity} />
                )}
              </>
            ) : (
              <Linha rot="🦠 Isolamento" o={selU.isolation_total_occupied} c={selU.isolation_total_capacity} />
            )}
          </div>
          <div className="flex gap-1 flex-wrap mb-3">
            {([["🔪 cirurgia", selU.has_surgeon], ["🧠 psiquiatria", selU.has_psychiatrist], ["🦴 ortopedia", selU.has_orthopedist]] as const).map(([l, on]) => (
              <span key={l} className={`text-[10px] px-2 py-[2px] rounded-full border ${on ? "border-blue-300 bg-blue-50 text-blue-800 font-bold" : "border-slate-200 text-slate-400"}`}>{l}</span>
            ))}
            <span className={`text-[10px] px-2 py-[2px] ${(ageMin(selU.updated_at) ?? 0) > 360 ? "text-amber-600 font-bold" : "text-slate-400"}`}>
              atualizado {ageLabel(ageMin(selU.updated_at))}
            </span>
          </div>
          <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide mb-1">Giro bruto</div>
          <pre className="m-0 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap max-h-72 overflow-auto text-slate-700">
            {rawFor(selU) || "Nenhum giro bruto registrado ainda para esta unidade."}
          </pre>
        </div>
      )}
    </div>
  );
}
