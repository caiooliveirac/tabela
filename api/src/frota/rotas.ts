import { Router } from "express";
import { alertasRecentes, diagnostico, linhaDoTempo, painelAtual } from "./coletor.js";

const router = Router();

// Só leitura, montada da memória do coletor. Atrás do login único do nginx,
// como o resto de /tabela/api — posição de viatura não sai sem sessão.
router.get("/", (_req, res) => {
    res.json(painelAtual());
});

// Erros recentes e estacionamentos aprendidos — para o vigia (sobrevive ao deploy).
router.get("/diagnostico", (_req, res) => {
    res.json(diagnostico());
});

// Avisos de sinal, bateria e resumo das últimas N horas (1–72, padrão 24):
// o que foi ao grupo e o que foi silenciado — para calibrar os limites.
router.get("/alertas", async (req, res) => {
    const horas = Math.min(72, Math.max(1, Number(req.query.horas) || 24));
    try {
        res.json(await alertasRecentes(horas));
    } catch (e) {
        console.error("[frota] alertas:", e);
        res.status(500).json({ error: "registro de alertas indisponível" });
    }
});

// Paradas em hospital das últimas N horas (1–72, padrão 12) — linha do tempo.
router.get("/linha-do-tempo", async (req, res) => {
    const horas = Math.min(72, Math.max(1, Number(req.query.horas) || 12));
    try {
        res.json(await linhaDoTempo(horas));
    } catch (e) {
        console.error("[frota] linha do tempo:", e);
        res.status(500).json({ error: "linha do tempo indisponível" });
    }
});

export default router;
