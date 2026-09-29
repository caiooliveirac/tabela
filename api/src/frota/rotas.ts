import { Router } from "express";
import { linhaDoTempo, painelAtual } from "./coletor.js";

const router = Router();

// Só leitura, montada da memória do coletor. Atrás do login único do nginx,
// como o resto de /tabela/api — posição de viatura não sai sem sessão.
router.get("/", (_req, res) => {
    res.json(painelAtual());
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
