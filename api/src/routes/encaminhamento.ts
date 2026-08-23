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
import { acharLocal, normalizar } from "../services/locais.js";
import { registrarBuscaSemResultado, rotasDoLocal } from "../services/locais-store.js";

const router = Router();

// GET /tabela/api/encaminhamento/perfis — o que preenche o seletor
router.get("/perfis", (_req: Request, res: Response) => {
    res.json(PERFIS.map((p) => ({ id: p.id, label: p.label })));
});

// GET /tabela/api/encaminhamento?local=<texto>&perfil=<id>
router.get("/", async (req: Request, res: Response) => {
    const busca = String(req.query.local ?? "").trim();
    const perfilId = String(req.query.perfil ?? "").trim();

    if (!busca) return res.status(400).json({ error: "Informe o local ou endereço" });
    if (!perfilId) return res.status(400).json({ error: "Informe o perfil do paciente" });

    let filtro;
    try {
        filtro = encaminhar(perfilId);
    } catch (e) {
        if (e instanceof PerfilDesconhecido) return res.status(400).json({ error: e.message });
        throw e;
    }

    const achados = acharLocal(busca);

    // Nenhum lugar reconhecido: devolve o filtro clínico mesmo assim. Saber
    // QUAIS hospitais podem receber já é metade da decisão, e é melhor do que
    // uma tela vazia porque o regulador escreveu o lugar de um jeito que o
    // índice não conhece.
    if (achados.length === 0) {
        // Não bloqueia a resposta: aprender é secundário, responder não é.
        void registrarBuscaSemResultado(normalizar(busca));
        return res.json({
            perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
            local: null,
            candidatos: [],
            destinos: filtro.elegiveis.map((e) => ({
                hospitalId: e.hospitalId,
                nome: nomeHospital(e.hospitalId),
                ressalva: e.ressalva ?? null,
                segundos: null,
                metros: null,
            })),
            excluidos: filtro.excluidos.map((x) => ({ ...x, nome: nomeHospital(x.hospitalId) })),
            aviso: `Não conhecemos "${busca}". Pergunte a quem está na cena qual é o bairro mais próximo. A lista abaixo está por afinidade clínica, sem ordem de distância — e o termo já foi registrado para entrar no índice.`,
        });
    }

    // Ambíguo: quem escolhe é quem regula, não o servidor.
    if (achados.length > 1) {
        return res.json({
            perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
            local: null,
            candidatos: achados.map((l) => ({ nome: l.nome, key: l.key, tipo: l.tipo })),
            destinos: [],
            excluidos: [],
            aviso: `${achados.length} lugares combinam com "${busca}". Escolha um.`,
        });
    }

    const local = achados[0];
    const base = {
        perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
        local: { nome: local.nome, key: local.key, tipo: local.tipo },
        candidatos: [],
        excluidos: filtro.excluidos.map((x) => ({ ...x, nome: nomeHospital(x.hospitalId) })),
    };

    // Povoado de ilha da Baía de Todos os Santos: não existe estrada. Dizer
    // isso é mais útil do que ordenar por um tempo de carro que não existe.
    if (local.semRotaRodoviaria) {
        return res.json({
            ...base,
            destinos: filtro.elegiveis.map((e) => ({
                hospitalId: e.hospitalId,
                nome: nomeHospital(e.hospitalId),
                ressalva: e.ressalva ?? null,
                segundos: null,
                metros: null,
            })),
            aviso: `${local.nome} não tem acesso rodoviário. A lista está por afinidade clínica; o transporte é aquaviário ou aéreo.`,
        });
    }

    const rotas = new Map((await rotasDoLocal(local.key)).map((r) => [r.hospitalId, r]));
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
