import { timingSafeEqual } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import {
    adesaoDenuncias, alertasRecentes, balancoPlantao, cobrancasPendentes, ativarViatura, desativarViatura, detalheViatura, diagnostico, encerrarAtivacao, listarAtivacoes, historicoFrota, informarMotivo, linhaDoTempo, listarDesativacoes, painelAtual, reativarViatura, retencaoFrota,
    registrarOcorrencias,
} from "./coletor.js";
import { ErroDesativacao, esquemaDesativar, esquemaMotivo, esquemaReativar } from "./desativacoes.js";
import { ErroAtivacao, esquemaAtivar, esquemaEncerrar } from "./ativacoes.js";
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

// Ativação (ativacoes.ts): viatura até segunda ordem posta de volta em operação
// — hoje pelo Quadro Informativo, servidor↔servidor. Vale até alguém desativar
// (ou POST /ativacoes/:id/encerrar). GET: abertas e as das últimas N horas (1–72, padrão 24).
router.get("/ativacoes", async (req, res) => {
    const horas = Math.min(72, Math.max(1, Number(req.query.horas) || 24));
    try {
        res.json(await listarAtivacoes(horas));
    } catch (e) {
        console.error("[frota] ativações:", e);
        res.status(500).json({ error: "ativações indisponíveis" });
    }
});

function erroAtivacao(res: Response, e: unknown): void {
    if (e instanceof z.ZodError) res.status(400).json({ error: e.errors.map((x) => x.message).join("; ") });
    else if (e instanceof ErroAtivacao) res.status(e.status).json({ error: e.message });
    else {
        console.error("[frota] ativação:", e);
        res.status(500).json({ error: "não foi possível registrar agora" });
    }
}

router.post("/ativacoes", async (req, res) => {
    try {
        res.status(201).json(await ativarViatura(esquemaAtivar.parse(req.body)));
    } catch (e) {
        erroAtivacao(res, e);
    }
});

router.post("/ativacoes/:id/encerrar", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "ID inválido" });
        return;
    }
    try {
        res.json(await encerrarAtivacao(id, esquemaEncerrar.parse(req.body).encerradaPor));
    } catch (e) {
        erroAtivacao(res, e);
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

// Detalhe de uma viatura (modal da aba Frota): ocorrência, parada, rastro do
// GPS desde a abertura e a linha do tempo status × cerca (detalhe.ts).
router.get("/viaturas/:chave", async (req, res) => {
    const chave = req.params.chave;
    if (!/^[\w:.-]{1,60}$/.test(chave)) {
        res.status(400).json({ error: "chave inválida" });
        return;
    }
    try {
        const d = await detalheViatura(chave);
        if (!d) {
            res.status(404).json({ error: "viatura fora do painel" });
            return;
        }
        res.json(d);
    } catch (e) {
        console.error("[frota] detalhe:", e);
        res.status(500).json({ error: "detalhe indisponível" });
    }
});

// Agregados dos últimos N dias (1–60, padrão 14): retenção por local e dia,
// uso por viatura, fora de operação. Quem lê é o dash da gestão, pela porta
// local. Só contagem e minuto: nada de paciente, protocolo ou médico.
router.get("/historico", async (req, res) => {
    const dias = Math.min(60, Math.max(1, Number(req.query.dias) || 14));
    try {
        res.json(await historicoFrota(dias));
    } catch (e) {
        console.error("[frota] histórico:", e);
        res.status(500).json({ error: "histórico indisponível" });
    }
});

// Análise de retenção (tela /tabela/retencao). Só chefia e admin: o porteiro
// (mnrs-portal, `retencaoDaChefia`) barra /retencao* com 403 para os demais.
// `/acesso` é a sonda da tela da Frota para mostrar o atalho.
router.get("/retencao/acesso", (_req, res) => {
    res.json({ ok: true });
});

// ?de=AAAA-MM-DD&ate=AAAA-MM-DD (dias de Salvador, `ate` incluído; até 184
// dias — a tela pede o período e o anterior, para comparar). Padrão: 30 dias.
router.get("/retencao", async (req, res) => {
    const DIA = 86_400_000;
    const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T03:00:00Z`) : NaN);
    const agora = Date.now();
    const ate = Number.isFinite(dia(req.query.ate)) ? Math.min(dia(req.query.ate) + DIA, agora) : agora;
    const de = Number.isFinite(dia(req.query.de)) ? dia(req.query.de) : ate - 30 * DIA;
    if (!(de < ate) || ate - de > 184 * DIA) return res.status(400).json({ error: "período inválido (até 184 dias)" });
    try {
        res.json(await retencaoFrota(new Date(de), new Date(ate)));
    } catch (e) {
        console.error("[frota] retenção:", e);
        res.status(500).json({ error: "retenção indisponível" });
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

// Adesão à denúncia (1–31 dias, padrão 14): USA retida 40+ min, registrada ou
// não no Acolhimentos, com o médico. Quem lê é o painel do Acolhimentos (gestão),
// pela porta local. 503 quando o Acolhimentos não responde.
router.get("/adesao", async (req, res) => {
    const dias = Math.min(31, Math.max(1, Number(req.query.dias) || 14));
    try {
        res.json(await adesaoDenuncias(dias));
    } catch (e) {
        console.error("[frota] adesão:", (e as Error).message);
        res.status(503).json({ error: "adesão indisponível" });
    }
});

export default router;
