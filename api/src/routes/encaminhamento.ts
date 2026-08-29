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
    COORDENADAS_HOSPITAIS,
    HOSPITAIS_NA_FEATURE,
    encaminhar,
    nomeHospital,
    PerfilDesconhecido,
} from "../services/encaminhamento.js";
import { acharLocal, localMaisProximo, normalizar, type Local } from "../services/locais.js";
import { registrarBuscaSemResultado, rotasDoLocal } from "../services/locais-store.js";

const router = Router();

/**
 * Teto do encaixe do clique. O pior caso entre lugares reais é Valéria, a
 * 2,3 km do vizinho; acima de 3 km o clique caiu na baía ou fora da malha
 * urbana, e ranquear por um ponto tão distante seria pior que não ranquear.
 */
const TETO_ENCAIXE_M = 3000;

// GET /tabela/api/encaminhamento/perfis — o que preenche o seletor
router.get("/perfis", (_req: Request, res: Response) => {
    res.json(PERFIS.map((p) => ({ id: p.id, label: p.label })));
});

// GET /tabela/api/encaminhamento/config — o que o navegador precisa para o
// mapa do Google. A chave aqui é a de NAVEGADOR (restrita por referrer no
// console do Google), nunca a GOOGLE_MAPS_API_KEY do gerar-locais.py: chave de
// servidor publicada no bundle é cota de terceiro esperando para ser gasta.
// Sem a variável, o painel cai no Leaflet e o plantão segue funcionando.
router.get("/config", (_req: Request, res: Response) => {
    res.json({
        mapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || null,
        mapId: process.env.GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
    });
});

// GET /tabela/api/encaminhamento/hospitais — pontos para o mapa desenhar
router.get("/hospitais", (_req: Request, res: Response) => {
    res.json(
        HOSPITAIS_NA_FEATURE.map((id) => ({
            id,
            nome: nomeHospital(id),
            lat: COORDENADAS_HOSPITAIS[id].lat,
            lng: COORDENADAS_HOSPITAIS[id].lng,
        })),
    );
});

// GET /tabela/api/encaminhamento?perfil=<id>&local=<texto>
// GET /tabela/api/encaminhamento?perfil=<id>&lat=<n>&lng=<n>   (clique no mapa)
router.get("/", async (req: Request, res: Response) => {
    const busca = String(req.query.local ?? "").trim();
    const perfilId = String(req.query.perfil ?? "").trim();
    const lat = req.query.lat === undefined ? null : Number(req.query.lat);
    const lng = req.query.lng === undefined ? null : Number(req.query.lng);
    const temPonto = lat !== null && lng !== null;

    if (!perfilId) return res.status(400).json({ error: "Informe o perfil do paciente" });
    if (!busca && !temPonto)
        return res.status(400).json({ error: "Informe o local, ou clique no mapa" });
    if (temPonto && (!Number.isFinite(lat) || !Number.isFinite(lng)))
        return res.status(400).json({ error: "Coordenada inválida" });
    // Caixa generosa em volta da RMS: fora dela o encaixe devolveria o lugar
    // menos distante de Salvador, que não descreve ocorrência nenhuma.
    if (temPonto && (lat! < -13.2 || lat! > -12.6 || lng! < -38.8 || lng! > -38.2))
        return res.status(400).json({ error: "O ponto está fora da região de Salvador" });

    let filtro;
    try {
        filtro = encaminhar(perfilId);
    } catch (e) {
        if (e instanceof PerfilDesconhecido) return res.status(400).json({ error: e.message });
        throw e;
    }

    // Clique no mapa: em vez de calcular a rota do ponto exato — que traria a
    // API do Google de volta para o caminho crítico do plantão — reusa a rota
    // já materializada do lugar conhecido mais próximo. A distância desse
    // encaixe volta na resposta: é aproximação, e quem regula precisa ver o
    // tamanho dela para julgar.
    if (temPonto) {
        const perto = localMaisProximo(lat!, lng!);
        if (!perto) return res.status(503).json({ error: "Índice de lugares indisponível" });

        // Clique na baía ou no mato: o lugar conhecido mais próximo chega a
        // ficar a 10 km. Aproximar 300 m é útil; aproximar 5 km é inventar. O
        // pior encaixe entre lugares reais é Valéria, a 2,3 km — acima de 3 km
        // não há ocorrência urbana plausível, então devolve a lista clínica
        // sem tempo em vez de um ranking que finge precisão.
        if (perto.metros > TETO_ENCAIXE_M) {
            return res.json({
                perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
                local: null,
                candidatos: [],
                encaixe: null,
                destinos: filtro.elegiveis.map((e) => ({
                    hospitalId: e.hospitalId,
                    nome: nomeHospital(e.hospitalId),
                    ressalva: e.ressalva ?? null,
                    segundos: null,
                    metros: null,
                })),
                excluidos: filtro.excluidos.map((x) => ({ ...x, nome: nomeHospital(x.hospitalId) })),
                aviso: `O ponto clicado está a ${(perto.metros / 1000).toFixed(1).replace(".", ",")} km do lugar conhecido mais próximo (${perto.local.nome}). Clique mais perto da área da ocorrência — a lista abaixo está por afinidade clínica, sem ordem de distância.`,
            });
        }

        return res.json(
            await montarResposta(filtro, perto.local, {
                nome: perto.local.nome,
                tipo: perto.local.tipo,
                metros: perto.metros,
                lat: perto.local.lat,
                lng: perto.local.lng,
            }),
        );
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
            encaixe: null,
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
            encaixe: null,
            candidatos: achados.map((l) => ({ nome: l.nome, key: l.key, tipo: l.tipo })),
            destinos: [],
            excluidos: [],
            aviso: `${achados.length} lugares combinam com "${busca}". Escolha um.`,
        });
    }

    return res.json(await montarResposta(filtro, achados[0], null));
});

interface Encaixe {
    nome: string;
    tipo: string;
    /** Distância em linha reta do ponto clicado até o lugar usado. */
    metros: number;
    /** Coordenada do lugar usado, para o mapa desenhar o quanto aproximou. */
    lat: number;
    lng: number;
}

/**
 * Monta a resposta para um lugar já resolvido — venha ele do texto digitado ou
 * do encaixe do clique. Compartilhar a montagem garante que os dois caminhos
 * respondam a mesma coisa; duplicar seria convidar um deles a divergir.
 */
async function montarResposta(
    filtro: ReturnType<typeof encaminhar>,
    local: Local,
    encaixe: Encaixe | null,
) {
    const base = {
        perfil: { id: filtro.perfil.id, label: filtro.perfil.label },
        // lat/lng entram para o mapa traçar as rotas a partir da origem do
        // ranking quando a busca foi por texto — clique já tem o próprio ponto.
        local: { nome: local.nome, key: local.key, tipo: local.tipo, lat: local.lat, lng: local.lng },
        candidatos: [] as unknown[],
        encaixe,
        excluidos: filtro.excluidos.map((x) => ({ ...x, nome: nomeHospital(x.hospitalId) })),
    };

    const semTempo = () =>
        filtro.elegiveis.map((e) => ({
            hospitalId: e.hospitalId,
            nome: nomeHospital(e.hospitalId),
            ressalva: e.ressalva ?? null,
            segundos: null,
            metros: null,
        }));

    // Povoado de ilha da Baía de Todos os Santos: não existe estrada. Dizer
    // isso é mais útil do que ordenar por um tempo de carro que não existe.
    if (local.semRotaRodoviaria) {
        return {
            ...base,
            destinos: semTempo(),
            aviso: `${local.nome} não tem acesso rodoviário. A lista está por afinidade clínica; o transporte é aquaviário ou aéreo.`,
        };
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

    return { ...base, destinos, aviso: null };
}

export default router;
