import { useEffect, useRef, useState } from "react";

interface PinDialogProps {
  title?: string;
  /** O que exatamente exige o PIN — muda por ação (alerta, restrição de UPA). */
  subtitle?: string;
  detail?: string;
  initialPin?: string;
  error?: string | null;
  busy?: boolean;
  onConfirm: (pin: string) => void;
  onCancel: () => void;
}

export default function PinDialog({
  title = "PIN da chefia necessário",
  subtitle = "Apagar ou editar um alerta de chefia exige o PIN.",
  detail,
  initialPin = "",
  error,
  busy = false,
  onConfirm,
  onCancel,
}: PinDialogProps) {
  const [pin, setPin] = useState(initialPin);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const v = pin.trim();
    if (!v || busy) return;
    onConfirm(v);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500] p-5"
      onMouseDown={onCancel}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-[420px] w-full shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-[17px] font-black text-red-700 mb-2">🔒 {title}</h3>
        <p className="text-sm text-slate-700 font-semibold mb-[6px]">{subtitle}</p>
        {detail && (
          <p className="text-[13px] text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
            {detail}
          </p>
        )}
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Digite o PIN"
          className="w-full py-2 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200 mb-2 tracking-widest"
        />
        {error && (
          <p className="text-[13px] text-red-600 font-semibold mb-2">{error}</p>
        )}
        <div className="flex gap-[10px] mt-2">
          <button
            onClick={submit}
            disabled={!pin.trim() || busy}
            className="px-5 py-[10px] rounded-[10px] border-none bg-red-600 text-white text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Validando…" : "Confirmar"}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-5 py-[10px] rounded-[10px] border-2 border-slate-200 bg-white text-slate-500 text-sm font-bold cursor-pointer disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
