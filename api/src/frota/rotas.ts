import { Router, type Response } from "express";
import { z } from "zod";
import {
    alertasRecentes, desativarViatura, diagnostico, linhaDoTempo, listarDesativacoes, painelAtual, reativarViatura,
} from "./coletor.js";
import { ErroDesativacao, esquemaDesativar, esquemaReativar } from "./desativacoes.js";

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

// Desativação informada no painel (rádio, chefe, enfermagem): a viatura sai
// dos avisos até alguém reativar. GET também é o que o Huddle do SAMU lê pela
// rede Docker (sem o portão) — ativas e as das últimas N horas (1–72, padrão 24).
router.get("/desativacoes", async (req, res) => {
    const horas = Math.min(72, Math.max(1, Number(req.query.horas) || 24));
    try {
        res.json(await listarDesativacoes(horas));
    } catch (e) {
        console.error("[frota] desativações:", e);
        res.status(500).json({ error: "desativações indisponíveis" });
    }
});

function erroDesativacao(res: Response, e: unknown): void {
    if (e instanceof z.ZodError) res.status(400).json({ error: e.errors.map((x) => x.message).join("; ") });
    else if (e instanceof ErroDesativacao) res.status(e.status).json({ error: e.message });
    else {
        console.error("[frota] desativação:", e);
        res.status(500).json({ error: "não foi possível registrar agora" });
    }
}

router.post("/desativacoes", async (req, res) => {
    try {
        res.status(201).json(await desativarViatura(esquemaDesativar.parse(req.body)));
    } catch (e) {
        erroDesativacao(res, e);
    }
});

router.post("/desativacoes/:id/reativar", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "ID inválido" });
        return;
    }
    try {
        res.json(await reativarViatura(id, esquemaReativar.parse(req.body).reativadaPor));
    } catch (e) {
        erroDesativacao(res, e);
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
