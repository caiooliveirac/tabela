interface ConfirmDialogProps {
  msg: string;
  detail?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  msg,
  detail,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[400] p-5">
      <div className="bg-white rounded-2xl p-6 max-w-[420px] w-full shadow-2xl">
        <h3 className="text-[17px] font-black text-red-700 mb-2">
          ⚠️ Confirmar remoção
        </h3>
        <p className="text-sm text-slate-900 font-semibold mb-[6px]">{msg}</p>
        {detail && (
          <p className="text-[13px] text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
            {detail}
          </p>
        )}
        <div className="flex gap-[10px]">
          <button
            onClick={onConfirm}
            className="px-5 py-[10px] rounded-[10px] border-none bg-red-600 text-white text-sm font-bold cursor-pointer"
          >
            Sim, remover
          </button>
          <button
            onClick={onCancel}
            className="px-5 py-[10px] rounded-[10px] border-2 border-slate-200 bg-white text-slate-500 text-sm font-bold cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
