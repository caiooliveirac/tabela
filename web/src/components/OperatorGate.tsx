import { useState } from "react";

interface OperatorGateProps {
  operador: string;
  children: React.ReactNode;
}

export default function OperatorGate({ operador, children }: OperatorGateProps) {
  const [show, setShow] = useState(false);

  if (operador.trim()) return <>{children}</>;

  return (
    <>
      <div onClick={() => setShow(true)}>{children}</div>
      {show && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-[300] p-5"
          onClick={() => setShow(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-[380px] w-full shadow-2xl text-center"
          >
            <div className="text-[40px] mb-2">👤</div>
            <h3 className="text-lg font-black mb-2">Identifique-se primeiro</h3>
            <p className="text-sm text-slate-500 mb-4">
              Preencha seu nome no campo do cabeçalho antes de registrar ou
              remover informações.
            </p>
            <button
              onClick={() => setShow(false)}
              className="px-5 py-2 rounded-lg bg-blue-700 text-white font-bold text-sm cursor-pointer"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
