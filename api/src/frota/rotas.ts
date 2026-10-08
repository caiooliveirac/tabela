import { timingSafeEqual } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import {
    alertasRecentes, balancoPlantao, cobrancasPendentes, desativarViatura, diagnostico, informarMotivo, linhaDoTempo, listarDesativacoes, painelAtual, reativarViatura,
    registrarOcorrencias,
} from "./coletor.js";
import { ErroDesativacao, esquemaDesativar, esquemaMotivo, esquemaReativar } from "./desativacoes.js";
import { esquemaOcorrencias } from "./ocorrencias.js";

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

// Motivo da desativação que chegou sem ele (Relatório da chefia, Mesa operacional).
router.post("/desativacoes/:id/motivo", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "ID inválido" });
        return;
    }
    try {
        res.json(await informarMotivo(id, esquemaMotivo.parse(req.body)));
    } catch (e) {
        erroDesativacao(res, e);
    }
});

// Ocorrência de cada equipe, enviada pelo coletor do mapa de equipes
// (scripts/mapa-equipes-coletor.mjs, de dentro da rede da SMS). Fora do portão
// no nginx — o coletor não tem sessão —, por isso o token. Sem
// MAPA_EQUIPES_TOKEN no ambiente: desligado.
router.post("/ocorrencias", async (req, res) => {
    const esperado = Buffer.from(process.env.MAPA_EQUIPES_TOKEN || "");
    const veio = Buffer.from(String(req.headers["x-mapa-token"] ?? ""));
    if (!esperado.length) {
        res.status(503).json({ error: "mapa de equipes desligado" });
        return;
    }
    if (veio.length !== esperado.length || !timingSafeEqual(veio, esperado)) {
        res.status(401).json({ error: "token inválido" });
        return;
    }
    const envio = esquemaOcorrencias.safeParse(req.body);
    if (!envio.success) {
        res.status(400).json({ error: envio.error.errors.map((x) => x.message).join("; ") });
        return;
    }
    res.json(await registrarOcorrencias(envio.data));
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

// USA presa 40+ min sem registro no Acolhimentos, com médico e texto pronto.
// Quem lê é o Tom (secretário, WhatsApp) pela porta local, sem o portão.
// 503 quando o Acolhimentos não responde: sem prova, ninguém é cobrado.
router.get("/cobrancas", async (_req, res) => {
    try {
        res.json({ cobrancas: await cobrancasPendentes() });
    } catch (e) {
        console.error("[frota] cobranças:", (e as Error).message);
        res.status(503).json({ error: "cobranças indisponíveis" });
    }
});

// Balanço da virada (07h/19h): retenções 40+ min das últimas 12 h por hospital,
// texto pronto para o WhatsApp. Quem lê é o Tom, pela porta local.
router.get("/balanco", async (_req, res) => {
    try {
        res.json(await balancoPlantao());
    } catch (e) {
        console.error("[frota] balanço:", (e as Error).message);
        res.status(503).json({ error: "balanço indisponível" });
    }
});

export default router;
