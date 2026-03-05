import { useState, useEffect, useCallback, useRef } from "react";
import { TUTORIAL_STEPS } from "../lib/constants";

interface TutorialProps {
  current: number;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

const SPOT_PAD = 10;

export default function Tutorial({
  current,
  onNext,
  onPrev,
  onExit,
}: TutorialProps) {
  const total = TUTORIAL_STEPS.length;
  const step = TUTORIAL_STEPS[current];
  const [rect, setRect] = useState<TargetRect | null>(null);
  const rafRef = useRef(0);

  /* ── Encontrar elemento-alvo e rastrear posição ─────────── */
  const measure = useCallback(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(
      `[data-tutorial-id="${step.target}"]`,
    );
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
      bottom: r.bottom,
      right: r.right,
    });
  }, [step.target]);

  useEffect(() => {
    // Espera renderização do DOM (ex: detail panel abrindo)
    const t = setTimeout(() => {
      measure();

      // Scroll into view se fora da tela
      if (step.target) {
        const el = document.querySelector(
          `[data-tutorial-id="${step.target}"]`,
        );
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.top < 60 || r.bottom > window.innerHeight - 20) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            // Re-medir após scroll
            setTimeout(measure, 400);
          }
        }
      }
    }, 150);

    // Re-medir durante scroll/resize
    const onUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onUpdate, true);
    window.addEventListener("resize", onUpdate);

    return () => {
      clearTimeout(t);
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", onUpdate, true);
      window.removeEventListener("resize", onUpdate);
    };
  }, [step.target, current, measure]);

  /* ── Posicionar tooltip relativo ao target ──────────────── */
  const tooltipStyle = useCallback((): React.CSSProperties => {
    if (!rect || !step.target) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const TW = 420;
    const TH = 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PAD = 18;

    switch (step.pos) {
      case "right": {
        let left = rect.right + PAD;
        let top = rect.top + rect.height / 2;

        // Se sai à direita, tenta à esquerda
        if (left + TW > vw - 20) {
          left = rect.left - PAD - TW;
        }
        // Se sai à esquerda também, centraliza
        if (left < 20) {
          left = Math.max(20, (vw - TW) / 2);
        }
        // Clamp vertical
        top = Math.max(20, Math.min(top, vh - TH - 20));

        return { top, left };
      }
      case "bottom": {
        const top = rect.bottom + PAD;
        const left = rect.left + rect.width / 2;
        return { top, left, transform: "translateX(-50%)" };
      }
      case "top": {
        const top = rect.top - PAD;
        const left = rect.left + rect.width / 2;
        return { top, left, transform: "translate(-50%, -100%)" };
      }
      default:
        return {
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        };
    }
  }, [rect, step.pos, step.target]);

  return (
    <div className="fixed inset-0" style={{ zIndex: 9990 }}>
      {/* Click overlay (sair clicando fora) */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: "auto" }}
        onClick={onExit}
      />

      {/* Spotlight com box-shadow OU overlay escuro */}
      {rect ? (
        <div
          style={{
            position: "fixed",
            top: rect.top - SPOT_PAD,
            left: rect.left - SPOT_PAD,
            width: rect.width + SPOT_PAD * 2,
            height: rect.height + SPOT_PAD * 2,
            borderRadius: 14,
            boxShadow:
              "0 0 0 9999px rgba(0,0,0,0.55), 0 0 30px 4px rgba(124,58,237,0.4)",
            pointerEvents: "none",
            transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: "rgba(0,0,0,0.55)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="bg-white rounded-2xl px-6 py-5 shadow-2xl border-2 border-purple-600"
        style={{
          position: "fixed",
          maxWidth: 440,
          width: "90%",
          pointerEvents: "auto",
          transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          ...tooltipStyle(),
        }}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-[11px] font-extrabold text-purple-600 uppercase tracking-wider">
            Tutorial · {current + 1}/{total}
          </span>
          <button
            onClick={onExit}
            className="bg-transparent border-none text-lg text-slate-400 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <h3 className="text-[17px] font-black text-slate-900 mb-2">
          {step.title}
        </h3>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          {step.body}
        </p>

        {/* Actions */}
        <div className="flex gap-2 justify-between">
          <button
            onClick={onExit}
            className="py-[7px] px-[14px] rounded-lg border border-slate-200 bg-white text-slate-500 text-xs font-bold cursor-pointer"
          >
            Sair do Tutorial
          </button>
          <div className="flex gap-[6px]">
            {current > 0 && (
              <button
                onClick={onPrev}
                className="py-[7px] px-[14px] rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-bold cursor-pointer"
              >
                ← Anterior
              </button>
            )}
            {current < total - 1 ? (
              <button
                onClick={onNext}
                className="py-[7px] px-[14px] rounded-lg border-none bg-purple-600 text-white text-xs font-bold cursor-pointer"
              >
                Próximo →
              </button>
            ) : (
              <button
                onClick={onExit}
                className="py-[7px] px-[14px] rounded-lg border-none bg-green-600 text-white text-xs font-bold cursor-pointer"
              >
                Concluir ✓
              </button>
            )}
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1 justify-center mt-3">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className="h-[6px] rounded-[3px] transition-all duration-200"
              style={{
                width: i === current ? 16 : 6,
                backgroundColor:
                  i === current
                    ? "#7c3aed"
                    : i < current
                      ? "#c4b5fd"
                      : "#e2e8f0",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
