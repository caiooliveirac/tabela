// ═══════════════════════════════════════════════════════════════
// Giro das UPAs sozinho — /tabela/giro.
//
// A mesma UpasView da aba UPAs do Painel de Vagas, sem o resto do painel: é
// o que a conta de gestão UPA (papel `gestao_upa` do plantoes) abre ao entrar
// no portal. O porteiro só deixa essa conta alcançar esta página, os dados do
// giro (/tabela/upas/api) e as restrições (/tabela/api/upas/restrictions) —
// mnrs-portal, porteiro/lib.mjs, giroPermite. `= /tabela/upas` não serve: é a
// página de prévia de link do WhatsApp, aberta, que segue para ?tab=upas.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import UpasView from "./UpasView";

export default function GiroApp() {
  // Mesmo nome do cabeçalho do Painel de Vagas: quem restringe/libera a UPA.
  const [op, setOp] = useState(() => localStorage.getItem("tabela:op") || "");

  useEffect(() => {
    document.title = "Giro das UPAs — SAMU Salvador";
  }, []);
  useEffect(() => {
    localStorage.setItem("tabela:op", op);
  }, [op]);

  return (
    <div className="font-sans bg-slate-50 min-h-screen flex flex-col text-slate-900">
      <header
        className="px-6 py-3 flex items-center justify-between flex-wrap gap-[10px] shadow-lg"
        style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)" }}
      >
        <div>
          <div className="text-slate-400 text-[10px] font-bold tracking-[0.12em] uppercase">
            Regulação SAMU · Salvador
          </div>
          <h1 className="text-white text-xl font-black m-0">Giro das UPAs</h1>
        </div>
        <div className="flex gap-2 items-center">
          <input
            placeholder="Seu nome"
            value={op}
            onChange={(e) => setOp(e.target.value)}
            title="Aparece como autor ao restringir ou liberar uma UPA"
            className="py-[5px] px-[10px] rounded-md text-xs text-white w-[140px] outline-none border border-white/20 bg-white/[.08]"
          />
          <a
            href="https://mnrs.com.br/"
            title="Voltar ao portal mnrs.com.br"
            className="py-[7px] px-[12px] text-xs rounded-lg border border-white/20 bg-white/[.12] text-slate-200 font-bold no-underline"
          >
            Portal
          </a>
        </div>
      </header>

      <main className="flex-1 min-w-0 px-6 py-[18px] max-w-[1400px] mx-auto w-full">
        <UpasView operador={op} />
      </main>
    </div>
  );
}
