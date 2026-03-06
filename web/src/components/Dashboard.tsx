import { useState, useMemo } from "react";
import type { HospitalData, CaseRow, IntelRow } from "../lib/types";
import {
  HOSPITALS,
  SM,
  TUTORIAL_STEPS,
  getIntelType,
} from "../lib/constants";
import { generateTutorialData, type TutorialDataResult } from "../lib/tutorialData";
import { useHospitals } from "../hooks/useHospitals";
import { useCreateCase, useRemoveCase, useUpdateCase } from "../hooks/useCases";
import { useIntel, useCreateIntel, useRemoveIntel } from "../hooks/useIntel";
import HospitalCard from "./HospitalCard";
import OperatorGate from "./OperatorGate";
import NewCaseModal, { type CaseFormInput } from "./NewCaseModal";
import IntelModal from "./IntelModal";
import ConfirmDialog from "./ConfirmDialog";
import Tutorial from "./Tutorial";

function fmt(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fAgo(ts: string): string {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 0) return "";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

const Badge = ({
  v,
  children,
}: {
  v: "aceito" | "zero";
  children: React.ReactNode;
}) => {
  const s =
    v === "aceito"
      ? { bg: "#dcfce7", c: "#166534", b: "#86efac" }
      : { bg: "#fee2e2", c: "#991b1b", b: "#fca5a5" };
  return (
    <span
      className="inline-flex items-center px-2 py-[2px] text-xs font-extrabold rounded-[5px] whitespace-nowrap"
      style={{
        backgroundColor: s.bg,
        color: s.c,
        border: `1.5px solid ${s.b}`,
      }}
    >
      {children}
    </span>
  );
};

export default function Dashboard() {
  // API data
  const { data: hospitalsData, isLoading, error } = useHospitals();
  const { data: allIntel = [] } = useIntel();
  const createCase = useCreateCase();
  const updateCase = useUpdateCase();
  const removeCase = useRemoveCase();
  const createIntel = useCreateIntel();
  const removeIntel = useRemoveIntel();

  // UI state
  const [selH, setSelH] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editingCase, setEditingCase] = useState<CaseRow | null>(null);
  const [showIntel, setShowIntel] = useState(false);
  const [op, setOp] = useState("");
  const [tab, setTab] = useState<"semaphore" | "timeline">("semaphore");
  const [confirm, setConfirm] = useState<{
    msg: string;
    detail?: string;
    onConfirm: () => void;
  } | null>(null);

  // Tutorial state
  const [tutActive, setTutActive] = useState(false);
  const [tutStep, setTutStep] = useState(0);
  const [tutorialData, setTutorialData] = useState<TutorialDataResult | null>(null);

  // Derived data — substitui fonte quando tutorial ativo
  const effectiveData = tutActive && tutorialData
    ? tutorialData.hospitalsResponse
    : hospitalsData;
  const displayIntel = tutActive && tutorialData
    ? tutorialData.allIntel
    : allIntel;
  const hospitals = effectiveData?.hospitals ?? [];
  const timelineCases = effectiveData?.timelineCases ?? [];

  const geral = useMemo(
    () =>
      hospitals
        .filter((h) => h.cat === "geral")
        .sort((a, b) => b.score - a.score),
    [hospitals]
  );
  const psiq = useMemo(
    () =>
      hospitals
        .filter((h) => h.cat === "psiq")
        .sort((a, b) => b.score - a.score),
    [hospitals]
  );
  const infecto = useMemo(
    () => hospitals.filter((h) => h.cat === "infecto"),
    [hospitals]
  );

  const sel = hospitals.find((h) => h.id === selH);

  const semaphoreCases = useMemo(() => {
    const rst = effectiveData?.resetTimestamp ?? 0;
    return (effectiveData?.timelineCases ?? []).filter(
      (c) => c.ativo && new Date(c.timestamp).getTime() >= rst
    );
  }, [effectiveData]);

  const totC = semaphoreCases.length;
  const totZ = semaphoreCases.filter((c) => c.situacao === "ZERO").length;
  const txG = totC > 0 ? Math.round(((totC - totZ) / totC) * 100) : 0;

  const noOp = !op.trim();

  // Tutorial handlers
  const startTutorial = () => {
    setTutorialData(generateTutorialData());
    setTutStep(0);
    setTutActive(true);
    setSelH(null);
    setTab("semaphore");
    if (!op.trim()) setOp("Tutorial");
  };
  const endTutorial = () => {
    setTutActive(false);
    setTutStep(0);
    setSelH(null);
    setTab("semaphore");
    setTutorialData(null);
  };
  const tutNavigate = (idx: number) => {
    const step = TUTORIAL_STEPS[idx];
    setTutStep(idx);
    setSelH(step.selectHospital || null);
    setTab(step.tab || "semaphore");
  };
  const tutNext = () =>
    tutNavigate(Math.min(tutStep + 1, TUTORIAL_STEPS.length - 1));
  const tutPrev = () => tutNavigate(Math.max(0, tutStep - 1));

  // Case removal with confirmation
  const handleRemoveCase = (c: CaseRow) => {
    if (tutActive) return; // não mutamos nada no tutorial
    const hosp = HOSPITALS.find((h) => h.id === c.hospitalId);
    setConfirm({
      msg: `Remover esta regulação de ${hosp?.name || c.hospitalId}?`,
      detail: `${fmt(c.timestamp)} · ${c.situacao === "ACEITO" ? "✅ Aceito" : "🚫 Vaga Zero"} · ${c.caso || "Sem caso"} · MR: ${c.mr || "—"} · OC: ${c.oc || "—"}`,
      onConfirm: () => {
        if (!op.trim()) return;
        removeCase.mutate({ id: c.id, removidoPor: op });
        setConfirm(null);
      },
    });
  };

  const handleOpenEditCase = (c: CaseRow) => {
    if (tutActive || !c.ativo) return;
    setEditingCase(c);
    setShowNew(true);
  };

  const handleSubmitCase = (data: CaseFormInput) => {
    if (!op.trim()) return;

    if (editingCase) {
      updateCase.mutate({
        id: editingCase.id,
        data: {
          ...data,
          atualizadoPor: op,
        },
      });
    } else {
      createCase.mutate({
        ...data,
        criadoPor: op,
      });
    }

    setShowNew(false);
    setEditingCase(null);
  };

  const handleCloseCaseModal = () => {
    setShowNew(false);
    setEditingCase(null);
  };

  const Grid = ({ hospitals }: { hospitals: HospitalData[] }) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3 mb-7">
      {hospitals.map((h) => (
        <HospitalCard
          key={h.id}
          h={h}
          onSelect={setSelH}
          isSel={selH === h.id}
          highlight={
            tutActive && TUTORIAL_STEPS[tutStep]?.target === `hospital-${h.id}`
          }
        />
      ))}
    </div>
  );

  const SH = ({
    icon,
    label,
    n,
  }: {
    icon: string;
    label: string;
    n: number;
  }) => (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xl">{icon}</span>
      <h2 className="m-0 text-base font-black">{label}</h2>
      <span className="text-xs text-slate-400 font-semibold">({n})</span>
    </div>
  );

  if (isLoading && !tutActive) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-lg text-slate-500 font-semibold">
          Carregando painel...
        </div>
      </div>
    );
  }

  if (error && !tutActive) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-lg text-red-600 font-semibold">
          Erro ao carregar dados. Verifique a conexão com o servidor.
        </div>
      </div>
    );
  }

  return (
    <div className="font-sans bg-slate-50 min-h-screen text-slate-900">
      {/* HEADER */}
      <header
        className="px-6 py-3 flex items-center justify-between flex-wrap gap-[10px] sticky top-0 z-[100] shadow-lg"
        style={{
          background: tutActive
            ? "linear-gradient(135deg, #5b21b6 0%, #3b0764 100%)"
            : "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)",
        }}
      >
        <div>
          <div className="text-slate-400 text-[10px] font-bold tracking-[0.12em] uppercase">
            Regulação SAMU · Salvador{" "}
            {tutActive && (
              <span className="text-purple-300">· MODO TUTORIAL</span>
            )}
          </div>
          <h1 className="text-white text-xl font-black m-0">
            Painel de Vagas
          </h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Operator input */}
          <div className="relative">
            <input
              placeholder="Seu nome"
              value={op}
              onChange={(e) => setOp(e.target.value)}
              className="py-[5px] px-[10px] rounded-md text-xs text-white w-[120px] outline-none"
              style={{
                border: noOp
                  ? "1.5px solid #f59e0b"
                  : "1px solid #ffffff33",
                backgroundColor: noOp ? "#78350f44" : "#ffffff15",
              }}
            />
            {noOp && (
              <div className="absolute top-full left-0 mt-1 text-[10px] text-amber-400 font-bold whitespace-nowrap">
                ← Obrigatório para registrar
              </div>
            )}
          </div>

          {/* Tab switcher */}
          <div data-tutorial-id="tab-switcher" className="flex gap-[2px] bg-white/[.15] rounded-lg p-[3px]">
            {(
              [
                ["semaphore", "Semáforo"],
                ["timeline", "Casos"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="py-[5px] px-[14px] rounded-md border-none text-xs font-bold cursor-pointer"
                style={{
                  backgroundColor:
                    tab === k ? "#fff" : "transparent",
                  color: tab === k ? "#0f172a" : "#94a3b8",
                }}
              >
                {l}
              </button>
            ))}
          </div>

          <OperatorGate operador={op}>
            <button
              data-tutorial-id="btn-intel"
              onClick={() => { if (!tutActive) setShowIntel(true); }}
              className="py-[7px] px-[14px] text-xs rounded-[10px] border-none bg-amber-500 text-amber-900 font-bold cursor-pointer"
            >
              ⚠ Intel
            </button>
          </OperatorGate>
          <OperatorGate operador={op}>
            <button
              data-tutorial-id="btn-new-case"
              onClick={() => {
                if (tutActive) return;
                setEditingCase(null);
                setShowNew(true);
              }}
              className="py-[7px] px-[14px] text-xs rounded-[10px] border-none bg-blue-700 text-white font-bold cursor-pointer"
            >
              + Caso
            </button>
          </OperatorGate>

          {tutActive ? (
            <button
              onClick={endTutorial}
              className="py-[7px] px-[14px] text-xs rounded-lg border-2 border-purple-300 bg-purple-600/10 text-purple-200 font-bold cursor-pointer"
            >
              Sair Tutorial
            </button>
          ) : (
            <button
              onClick={startTutorial}
              className="py-[7px] px-[14px] text-xs rounded-lg border border-white/20 bg-white/[.15] text-slate-400 font-bold cursor-pointer"
            >
              📖 Tutorial
            </button>
          )}
        </div>
      </header>

      {/* KPIs */}
      <div className="flex gap-[1px] bg-slate-200 border-b border-slate-200">
        {[
          { l: "Regulações", v: String(totC), c: "#1a56db" },
          { l: "Vagas Zero", v: String(totZ), c: "#dc2626" },
          {
            l: "Taxa aceite",
            v: `${txG}%`,
            c: txG >= 60 ? "#16a34a" : "#ca8a04",
          },
          {
            l: "Aceitando",
            v: `${geral.filter((h) => h.sem === "green").length}/${geral.length}`,
            c: "#16a34a",
          },
        ].map((k, i) => (
          <div
            key={i}
            className="flex-1 py-[10px] px-4 bg-white flex items-baseline gap-2"
          >
            <span
              className="text-2xl font-black"
              style={{ color: k.c }}
            >
              {k.v}
            </span>
            <span className="text-[11px] font-semibold text-slate-500 uppercase">
              {k.l}
            </span>
          </div>
        ))}
      </div>

      {/* MAIN */}
      <div className="px-6 py-[18px] max-w-[1400px] mx-auto">
        {tab === "semaphore" ? (
          <>
            {/* Legend */}
            <div className="flex gap-4 mb-[18px] flex-wrap items-center py-2 px-[14px] bg-white rounded-[10px] border border-slate-200">
              <span className="text-[11px] font-extrabold text-slate-600 uppercase">
                Legenda:
              </span>
              {[
                { c: "#16a34a", l: "Aceitando" },
                { c: "#d97706", l: "Atenção" },
                { c: "#dc2626", l: "Negando" },
              ].map((x) => (
                <div
                  key={x.c}
                  className="flex items-center gap-1"
                >
                  <div
                    className="w-1 h-[18px] rounded-sm"
                    style={{ backgroundColor: x.c }}
                  />
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: x.c }}
                  >
                    {x.l}
                  </span>
                </div>
              ))}
              <span className="text-[11px] text-slate-500">
                🚫 vaga zero · 🚑 envio planejado · ⚠️ alerta
              </span>
            </div>

            <div data-tutorial-id="section-geral">
              <SH
                icon="🏥"
                label="Emergência Geral — para onde regular?"
                n={geral.length}
              />
              <Grid hospitals={geral} />
            </div>

            <div data-tutorial-id="section-specialty" className="grid grid-cols-2 gap-6">
              <div>
                <SH icon="🧠" label="Psiquiatria" n={psiq.length} />
                <div className="flex flex-col gap-[10px]">
                  {psiq.map((h) => (
                    <HospitalCard
                      key={h.id}
                      h={h}
                      onSelect={setSelH}
                      isSel={selH === h.id}
                    />
                  ))}
                </div>
              </div>
              <div>
                <SH
                  icon="🦠"
                  label="Infectologia (HIV/TB)"
                  n={infecto.length}
                />
                <div className="flex flex-col gap-[10px]">
                  {infecto.map((h) => (
                    <HospitalCard
                      key={h.id}
                      h={h}
                      onSelect={setSelH}
                      isSel={selH === h.id}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* DETAIL PANEL */}
            {sel && (
              <div className="bg-white border-2 border-slate-200 rounded-[14px] p-5 mt-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-2 h-11 rounded"
                    style={{ backgroundColor: SM[sel.sem].bd }}
                  />
                  <div className="flex-1">
                    <h3 className="m-0 text-xl font-black">{sel.name}</h3>
                    <span className="text-[13px] text-slate-500">
                      Score {sel.score}/100 · {sel.total} regulações ·
                      Taxa:{" "}
                      {sel.taxa !== null
                        ? `${Math.round(sel.taxa * 100)}%`
                        : "N/A"}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelH(null)}
                    className="bg-transparent border-none cursor-pointer text-[22px] text-slate-400"
                  >
                    ✕
                  </button>
                </div>

                {/* Active intel */}
                {sel.intel.length > 0 && (
                  <div data-tutorial-id="detail-intel" className="mb-[14px]">
                    <div className="text-[11px] font-extrabold text-slate-600 mb-[6px] uppercase">
                      Intel ativa
                    </div>
                    {sel.intel.map((i) => {
                      const t = getIntelType(i.tipo);
                      return (
                        <div
                          key={i.id}
                          className="flex items-center gap-2 p-[10px] rounded-lg mb-1"
                          style={{
                            backgroundColor: t.bg,
                            border: `1px solid ${t.bd}`,
                          }}
                        >
                          <span className="text-[15px]">{t.icon}</span>
                          <div className="flex-1">
                            <div
                              className="text-[13px] font-bold"
                              style={{ color: t.color }}
                            >
                              {t.label}
                              {i.nota ? `: ${i.nota}` : ""}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {i.autor} · {fmt(i.timestamp)} (
                              {fAgo(i.timestamp)} atrás)
                            </div>
                          </div>
                          <OperatorGate operador={op}>
                            <button
                              onClick={() => {
                                if (tutActive) return;
                                op.trim() &&
                                  removeIntel.mutate({
                                    id: i.id,
                                    removidoPor: op,
                                  });
                              }}
                              className="px-[10px] py-1 text-[11px] rounded-[10px] bg-red-50 text-red-700 border border-red-300 font-bold cursor-pointer"
                            >
                              ✕ Remover
                            </button>
                          </OperatorGate>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Removed intel log */}
                {(() => {
                  const rm = displayIntel.filter(
                    (i) => !i.ativo && i.hospitalId === sel.id
                  );
                  if (!rm.length) return null;
                  return (
                    <div className="mb-[14px] p-[10px] rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-[10px] font-extrabold text-slate-400 uppercase mb-1">
                        Histórico de remoções
                      </div>
                      {rm.map((i) => {
                        const t = getIntelType(i.tipo);
                        return (
                          <div
                            key={i.id}
                            className="text-[11px] text-slate-400 mb-[2px]"
                          >
                            <span className="line-through">
                              {t.icon} {t.label}
                              {i.nota ? `: ${i.nota}` : ""} (
                              {i.autor} às {fmt(i.timestamp)})
                            </span>
                            <span className="font-bold text-slate-500">
                              {" "}
                              → removido por {i.removidoPor} às{" "}
                              {i.removidoEm
                                ? fmt(i.removidoEm)
                                : "?"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Cases table */}
                <div data-tutorial-id="detail-cases" className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b-2 border-slate-200">
                        {[
                          "Hora",
                          "Resultado",
                          "Caso",
                          "MR",
                          "Médico",
                          "OC",
                          "",
                        ].map((c) => (
                          <th
                            key={c}
                            className="text-left p-2 text-slate-500 font-bold text-[11px] uppercase"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...sel.cases]
                        .sort(
                          (a, b) =>
                            new Date(b.timestamp).getTime() -
                            new Date(a.timestamp).getTime()
                        )
                        .map((c) => (
                          <tr
                            key={c.id}
                            className="border-b border-slate-100"
                          >
                            <td className="p-2 font-bold">
                              {fmt(c.timestamp)}
                            </td>
                            <td className="p-2">
                              {c.situacao === "ACEITO" ? (
                                <Badge v="aceito">
                                  ✅ Aceito
                                </Badge>
                              ) : (
                                <Badge v="zero">
                                  🚫 Vaga Zero
                                </Badge>
                              )}
                            </td>
                            <td className="p-2 max-w-[200px]">
                              {c.caso || "—"}
                            </td>
                            <td className="p-2">{c.mr || "—"}</td>
                            <td className="p-2">
                              {c.medico || "—"}
                            </td>
                            <td className="p-2 text-slate-400">
                              {c.oc || "—"}
                            </td>
                            <td className="p-[6px]">
                              <OperatorGate operador={op}>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() =>
                                      handleOpenEditCase(c)
                                    }
                                    className="bg-transparent border border-blue-300 rounded-md text-blue-700 cursor-pointer py-[3px] px-2 text-xs font-bold"
                                  >
                                    ✎
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleRemoveCase(c)
                                    }
                                    className="bg-transparent border border-red-300 rounded-md text-red-600 cursor-pointer py-[3px] px-2 text-xs font-bold"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </OperatorGate>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* Removed cases log */}
                {(() => {
                  const rm = (effectiveData?.timelineCases ?? []).filter(
                    (c) => !c.ativo && c.hospitalId === sel.id
                  );
                  if (!rm.length) return null;
                  return (
                    <div className="mt-3 p-[10px] rounded-lg bg-red-50 border border-red-200">
                      <div className="text-[10px] font-extrabold text-red-700 uppercase mb-1">
                        Casos removidos
                      </div>
                      {rm.map((c) => (
                        <div
                          key={c.id}
                          className="text-[11px] text-slate-400 mb-[2px]"
                        >
                          <span className="line-through">
                            {fmt(c.timestamp)} · {c.situacao} ·{" "}
                            {c.caso || "—"} · MR: {c.mr || "—"}
                          </span>
                          <span className="font-bold text-red-700">
                            {" "}
                            → removido por {c.removidoPor} às{" "}
                            {c.removidoEm
                              ? fmt(c.removidoEm)
                              : "?"}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        ) : (
          /* TIMELINE TAB */
          <div className="bg-white rounded-[14px] border-2 border-slate-200 overflow-hidden">
            <div className="py-3 px-[18px] border-b-2 border-slate-200 flex justify-between">
              <h2 className="m-0 text-[15px] font-extrabold">
                Casos — últimas 24h
              </h2>
              <span className="text-xs text-slate-400">
                {timelineCases.length} regulações
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b-2 border-slate-200 bg-slate-50">
                    {[
                      "Hora",
                      "Hospital",
                      "Resultado",
                      "Caso",
                      "MR",
                      "Médico",
                      "OC",
                      "Ações",
                    ].map((c) => (
                      <th
                        key={c}
                        className="text-left py-[10px] px-3 text-slate-500 font-bold text-[11px] uppercase"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...timelineCases]
                    .sort(
                      (a, b) =>
                        new Date(b.timestamp).getTime() -
                        new Date(a.timestamp).getTime()
                    )
                    .map((c) => {
                      const hosp = HOSPITALS.find(
                        (hh) => hh.id === c.hospitalId
                      );
                      return (
                        <tr
                          key={c.id}
                          className="border-b border-slate-100"
                          style={{ opacity: c.ativo ? 1 : 0.4 }}
                        >
                          <td className="py-[10px] px-3 font-bold">
                            {fmt(c.timestamp)}
                          </td>
                          <td className="py-[10px] px-3 font-bold">
                            {hosp?.name}
                          </td>
                          <td className="py-[10px] px-3">
                            {c.situacao === "ACEITO" ? (
                              <Badge v="aceito">✅ Aceito</Badge>
                            ) : (
                              <Badge v="zero">🚫 Vaga Zero</Badge>
                            )}
                          </td>
                          <td className="py-[10px] px-3 max-w-[250px]">
                            {c.caso || "—"}
                          </td>
                          <td className="py-[10px] px-3">
                            {c.mr || "—"}
                          </td>
                          <td className="py-[10px] px-3">
                            {c.medico || "—"}
                          </td>
                          <td className="py-[10px] px-3 text-slate-400">
                            {c.oc || "—"}
                          </td>
                          <td className="py-[10px] px-3">
                            {c.ativo && (
                              <OperatorGate operador={op}>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() =>
                                      handleOpenEditCase(c)
                                    }
                                    className="bg-transparent border border-blue-300 rounded-md text-blue-700 cursor-pointer py-[3px] px-2 text-xs font-bold"
                                  >
                                    ✎
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleRemoveCase(c)
                                    }
                                    className="bg-transparent border border-red-300 rounded-md text-red-600 cursor-pointer py-[3px] px-2 text-xs font-bold"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </OperatorGate>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      {showNew && (
        <NewCaseModal
          operador={op}
          initialData={editingCase}
          title={editingCase ? "Editar Regulação" : "Registrar Regulação"}
          submitLabel={editingCase ? "Salvar" : "Registrar"}
          onSubmit={handleSubmitCase}
          onClose={handleCloseCaseModal}
        />
      )}

      {showIntel && (
        <IntelModal
          operador={op}
          allIntel={displayIntel}
          onSubmit={(data) => {
            createIntel.mutate(data);
          }}
          onRemove={(id) => {
            if (op.trim()) {
              removeIntel.mutate({ id, removidoPor: op });
            }
          }}
          onClose={() => setShowIntel(false)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          msg={confirm.msg}
          detail={confirm.detail}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {tutActive && (
        <Tutorial
          current={tutStep}
          onNext={tutNext}
          onPrev={tutPrev}
          onExit={endTutorial}
        />
      )}
    </div>
  );
}
