import { useState, useEffect } from "react";
import type { ChefiaAlert, CreateChefiaPayload, UpdateChefiaPayload } from "../lib/types";

function fmt(ts: string): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface ChefiaModalProps {
    operador: string;
    alerts: ChefiaAlert[];
    editingAlert?: ChefiaAlert | null;
    onSubmit: (data: CreateChefiaPayload) => void;
    onUpdate: (id: number, data: UpdateChefiaPayload) => void;
    onRemove: (id: number) => void;
    onClose: () => void;
}

export default function ChefiaModal({
    operador,
    alerts,
    editingAlert,
    onSubmit,
    onUpdate,
    onRemove,
    onClose,
}: ChefiaModalProps) {
    const [mensagem, setMensagem] = useState("");
    const [autor, setAutor] = useState("");
    const [editId, setEditId] = useState<number | null>(null);

    // Pre-fill when editingAlert is passed from outside
    useEffect(() => {
        if (editingAlert) {
            setEditId(editingAlert.id);
            setMensagem(editingAlert.mensagem);
            setAutor(editingAlert.autor);
        }
    }, [editingAlert]);

    const handleSubmit = () => {
        const msg = mensagem.trim();
        const name = autor.trim();
        if (!msg || !name) return;

        if (editId) {
            onUpdate(editId, { mensagem: msg, autor: name });
        } else {
            onSubmit({ mensagem: msg, autor: name });
        }
        setEditId(null);
        setMensagem("");
        setAutor("");
    };

    const handleEdit = (a: ChefiaAlert) => {
        setEditId(a.id);
        setMensagem(a.mensagem);
        setAutor(a.autor);
    };

    const handleCancelEdit = () => {
        setEditId(null);
        setMensagem("");
        setAutor("");
    };

    const activeAlerts = alerts.filter((a) => a.ativo);

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]"
            onMouseDown={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-[460px] max-w-[95vw] max-h-[85vh] overflow-y-auto"
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-red-200 bg-gradient-to-r from-red-600 to-red-700 rounded-t-2xl">
                    <h2 className="text-white font-black text-base m-0">
                        🚨 Alerta da Chefia
                    </h2>
                    <p className="text-red-200 text-[11px] mt-1 mb-0">
                        Mensagem visível para toda a equipe em tempo real
                    </p>
                </div>

                {/* Body */}
                <div className="px-5 py-4 space-y-4">
                    {/* Active alerts */}
                    {activeAlerts.length > 0 && (
                        <div>
                            <div className="text-[11px] font-extrabold text-red-700 uppercase mb-2">
                                Alertas ativos ({activeAlerts.length})
                            </div>
                            <div className="space-y-2">
                                {activeAlerts.map((a) => (
                                    <div
                                        key={a.id}
                                        className="flex items-start gap-2 p-3 rounded-lg border"
                                        style={editId === a.id
                                            ? { borderColor: "#3b82f6", backgroundColor: "#eff6ff" }
                                            : { borderColor: "#fecaca", backgroundColor: "#fef2f2" }
                                        }
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-bold text-red-900 leading-snug">
                                                {a.mensagem}
                                            </div>
                                            <div className="text-[10px] text-red-500 mt-1 font-semibold">
                                                {a.autor} · {fmt(a.timestamp)}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => handleEdit(a)}
                                                className="text-blue-400 hover:text-blue-700 text-xs font-bold bg-transparent border border-blue-300 rounded-md px-2 py-1 cursor-pointer"
                                                title="Editar alerta"
                                            >
                                                ✎
                                            </button>
                                            <button
                                                onClick={() => onRemove(a.id)}
                                                className="text-red-400 hover:text-red-700 text-xs font-bold bg-transparent border border-red-300 rounded-md px-2 py-1 cursor-pointer"
                                                title="Remover alerta"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Form: create or edit */}
                    <div className="space-y-3">
                        <div className="text-[11px] font-extrabold text-slate-600 uppercase">
                            {editId ? "Editar alerta" : "Novo alerta"}
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                                Nome da chefia
                            </label>
                            <input
                                value={autor}
                                onChange={(e) => setAutor(e.target.value)}
                                placeholder="Ex: Dra. Maria"
                                className="w-full py-2 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                                Mensagem
                            </label>
                            <textarea
                                value={mensagem}
                                onChange={(e) => setMensagem(e.target.value)}
                                placeholder="Digite a orientação ou alerta..."
                                rows={3}
                                className="w-full py-2 px-3 rounded-lg border border-slate-300 text-sm outline-none resize-none focus:border-red-400 focus:ring-1 focus:ring-red-200"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleSubmit}
                                disabled={!mensagem.trim() || !autor.trim()}
                                className="flex-1 py-2 rounded-lg text-sm font-bold border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: editId ? "#2563eb" : "#dc2626",
                                    color: "#fff",
                                }}
                            >
                                {editId ? "Salvar Alteração" : "Publicar Alerta"}
                            </button>
                            {editId && (
                                <button
                                    onClick={handleCancelEdit}
                                    className="py-2 px-4 rounded-lg text-sm font-bold border border-slate-300 bg-white text-slate-600 cursor-pointer"
                                >
                                    Cancelar
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
                    <button
                        onClick={onClose}
                        className="py-[6px] px-4 rounded-lg text-xs font-bold border border-slate-300 bg-white text-slate-600 cursor-pointer"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
}
