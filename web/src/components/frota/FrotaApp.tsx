// ═══════════════════════════════════════════════════════════════
// Frota sozinha — /tabela/frota (endereço público: mnrs.com.br/frota).
//
// A mesma FrotaView da aba do Painel de Vagas, sem o resto do painel: é o
// que a Central (rádio-operador, TARM, enfermeiro) abre pelo card do portal. O porteiro só deixa
// essas contas alcançarem esta página e /tabela/api/frota (mnrs-portal,
// porteiro/lib.mjs, centralPermite).
// ═══════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useFrota, useAlertasFrota } from "../../hooks/useFrota";
import FrotaView from "./FrotaView";
import AlertasFrota from "./AlertasFrota";
import type { Foco } from "./MapaFrota";

export default function FrotaApp() {
  const frota = useFrota();
  const { pendentes, ciente } = useAlertasFrota(frota.data?.viaturas);
  const [foco, setFoco] = useState<Foco | null>(null);
  // Mesmo nome do cabeçalho do Painel de Vagas: quem informa a desativação.
  const [op, setOp] = useState(() => localStorage.getItem("tabela:op") || "");
  const semNome = !op.trim();

  useEffect(() => {
    document.title = "Rastreador de Equipes — SAMU Salvador";
  }, []);
  useEffect(() => {
    localStorage.setItem("tabela:op", op);
  }, [op]);

  return (
    <div className="font-sans bg-slate-50 h-screen flex flex-col text-slate-900 overflow-hidden">
      <header
        className="px-6 py-3 flex items-center justify-between flex-wrap gap-[10px] shadow-lg"
        style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)" }}
      >
        <div>
          <div className="text-slate-400 text-[10px] font-bold tracking-[0.12em] uppercase">
            Rádio-operação SAMU · Salvador
          </div>
          <h1 className="text-white text-xl font-black m-0">Rastreador de Equipes</h1>
        </div>
        <div className="relative">
          <input
            placeholder="Seu nome"
            value={op}
            onChange={(e) => setOp(e.target.value)}
            className="py-[5px] px-[10px] rounded-md text-xs text-white w-[140px] outline-none"
            style={{
              border: semNome ? "1.5px solid #f59e0b" : "1px solid #ffffff33",
              backgroundColor: semNome ? "#78350f44" : "#ffffff15",
            }}
          />
          {semNome && (
            <div className="absolute top-full right-0 mt-1 text-[10px] text-amber-400 font-bold whitespace-nowrap">
              Obrigatório para desativar viatura
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-6 py-[18px] max-w-[1400px] mx-auto w-full">
          <FrotaView
            painel={frota.data}
            carregando={frota.isLoading}
            erro={frota.error}
            foco={foco}
            focar={(f) => setFoco({ ...f, vez: Date.now() })}
            operador={op}
          />
        </div>
      </div>

      <AlertasFrota
        pendentes={pendentes}
        alertaMin={frota.data?.limites.alertaMin ?? 40}
        onCiente={ciente}
        onVer={(v) => {
          if (v.posicao) setFoco({ lat: v.posicao.lat, lng: v.posicao.lng, zoom: 17, vez: Date.now() });
        }}
      />
    </div>
  );
}
