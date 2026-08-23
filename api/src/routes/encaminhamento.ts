// ═══════════════════════════════════════════════════════════════
// Encaminhamento — API.
//
// Aberta como o resto do painel: é consulta, não escreve nada.
//
// Devolve só o que o servidor sabe melhor que o navegador — quais hospitais o
// perfil clínico permite e a que distância cada um está. Score, semáforo e
// alertas o painel já tem em memória por /hospitals; recalcular aqui seria
// manter duas verdades sobre a mesma coisa.
// ═══════════════════════════════════════════════════════════════
import { Router, type Request, type Response } from "express";
import {
    PERFIS,
    encaminhar,
    nomeHospital,
    PerfilDesconhecido,
} from "../services/encaminhamento.js";
import { acharBairro } from "../services/bairros.js";
import { rotasDoBairro } from "../services/bairros-store.js";

const router = Router();

// GET /tabela/api/encaminhamento/perfis — o que preenche o seletor
router.get("/perfis", (_req: Request, res: Response) => {
    res.json(PERFIS.map((p) => ({ id: p.id, label: p.label })));
});

// GET /tabela/api/encaminhamento?local=<texto>&perfil=<id>
router.get("/", async (req: Request, res: Response) => {
    const local = String(req.query.local ?? "").trim();
    const perfilId = String(req.query.perfil ?? "").trim();

    if (!local) return res.status(400).json({ error: "Informe o bairro ou endereço" });
    if (!perfilId) return res.status(400).json({ error: "Informe o perfil do paciente" });

    let filtro;
    try {
        filtro = encaminhar(perfilId);
    } catch (e) {
        if (e instanceof PerfilDesconhecido) return res.status(400).json({ error: e.message });
        throw e;
    }

    const achados = acharBairro(local);

    // Nenhum bairro reconhecido: devolve o filtro clínico mesmo assim. Saber
    // QUAIS hospitais podem receber já é metade da decisão, e é melhor do que
    // uma tela vazia porque o regulador escreveu o bairro de um jeito que o
    // índice não conhece.
    if (achados.length === 0) {
        return res.json({
            perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
            bairro: null,
            candidatos: [],
            destinos: filtro.elegiveis.map((e) => ({
                hospitalId: e.hospitalId,
                nome: nomeHospital(e.hospitalId),
                ressalva: e.ressalva ?? null,
                segundos: null,
                metros: null,
            })),
            excluidos: filtro.excluidos.map((x) => ({ ...x, nome: nomeHospital(x.hospitalId) })),
            aviso: "Bairro não reconhecido — a lista está por afinidade clínica, sem ordem de distância.",
        });
    }

    // Ambíguo: quem escolhe é quem regula, não o servidor.
    if (achados.length > 1) {
        return res.json({
            perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
            bairro: null,
            candidatos: achados.map((b) => ({ nome: b.nome, key: b.key })),
            destinos: [],
            excluidos: [],
            aviso: `${achados.length} bairros combinam com "${local}". Escolha um.`,
        });
    }

    const bairro = achados[0];
    const base = {
        perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
        bairro: { nome: bairro.nome, key: bairro.key },
        candidatos: [],
        excluidos: filtro.excluidos.map((x) => ({ ...x, nome: nomeHospital(x.hospitalId) })),
    };

    // Ilha da Baía de Todos os Santos: não existe estrada. Dizer isso é mais
    // útil do que ordenar por um tempo de carro que não existe.
    if (bairro.semRotaRodoviaria) {
        return res.json({
            ...base,
            destinos: filtro.elegiveis.map((e) => ({
                hospitalId: e.hospitalId,
                nome: nomeHospital(e.hospitalId),
                ressalva: e.ressalva ?? null,
                segundos: null,
                metros: null,
            })),
            aviso: `${bairro.nome} não tem acesso rodoviário. A lista está por afinidade clínica; o transporte é aquaviário ou aéreo.`,
        });
    }

    const rotas = new Map((await rotasDoBairro(bairro.key)).map((r) => [r.hospitalId, r]));
    const destinos = filtro.elegiveis
        .map((e) => ({
            hospitalId: e.hospitalId,
            nome: nomeHospital(e.hospitalId),
            ressalva: e.ressalva ?? null,
            segundos: rotas.get(e.hospitalId)?.segundos ?? null,
            metros: rotas.get(e.hospitalId)?.metros ?? null,
        }))
        // Sem tempo vai para o fim: é lacuna de dado, não proximidade.
        .sort((a, b) => (a.segundos ?? Infinity) - (b.segundos ?? Infinity));

    res.json({ ...base, destinos, aviso: null });
});

export default router;
