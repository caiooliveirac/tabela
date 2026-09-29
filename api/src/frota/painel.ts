// ═══════════════════════════════════════════════════════════════
// Monta a resposta de GET /tabela/api/frota a partir do que o coletor tem
// em memória. Pura: mesma entrada, mesma saída.
// ═══════════════════════════════════════════════════════════════
import { COORDENADAS_BASES, type ViaturaCatalogo } from "./catalogo.js";
import type { HospitalFrota } from "./hospitais.js";
import type { DispositivoSamu, PosicaoSamu } from "./samumais.js";
import {
    ALERTA_MIN, MAPA_MIN, RAIO_M, RAIO_SAIDA_M, RECENTE_MIN,
    duracaoMin, ehMoto, instanteSamu, naBase, situacao, vincular,
    type Leitura, type Permanencia, type Situacao,
} from "./regras.js";

export interface ViaturaFrota {
    chave: string;
    codigo: string | null;
    /** Código do catálogo; fora dele, o nome que o SAMU+ usa. */
    nome: string;
    nomeSamu: string | null;
    nomeDifere: boolean;
    tipo: "USA" | "USB" | "MOTO" | null;
    base: string | null;
    turno: string | null;
    situacao: Situacao;
    motivo: string | null;
    foraDoCatalogo: boolean;
    posicao: { lat: number; lng: number; em: string; idadeMin: number } | null;
    /** Parada a 150 m da própria base (só bases com ponto exato). */
    naBase: boolean;
    bateria: number | null;
    sinal: number | null;
    velocidade: number | null;
    noHospital: {
        hospitalId: string;
        hospitalNome: string;
        entrada: string;
        ultimaVez: string;
        minutos: number;
        alerta: boolean;
    } | null;
}

export interface PainelFrota {
    ativo: boolean;
    coletadoEm: string | null;
    vinculosEm: string | null;
    erro: string | null;
    limites: { raioM: number; raioSaidaM: number; alertaMin: number; recenteMin: number; mapaMin: number };
    hospitais: HospitalFrota[];
    viaturas: ViaturaFrota[];
    /** Unidades fora do catálogo (evento, reserva) sem posição recente — só contadas. */
    foraDoCatalogoSemSinal: number;
}

interface Resolvida {
    chave: string;
    posicao: PosicaoSamu;
    em: Date;
    dispositivo: DispositivoSamu | null;
    codigo: string | null;
    nomeDifere: boolean;
}

/** Posição da API → viatura: equipe → unidade do SAMU+ → código do catálogo. */
export function resolverPosicoes(
    posicoes: readonly PosicaoSamu[],
    dispositivos: readonly DispositivoSamu[],
    catalogo: readonly ViaturaCatalogo[],
): Map<string, Resolvida> {
    const vinculo = vincular(dispositivos, catalogo);
    const porEquipe = new Map<number, DispositivoSamu>();
    for (const d of dispositivos) if (d.equipe !== null) porEquipe.set(d.equipe, d);

    const porChave = new Map<string, Resolvida>();
    for (const p of posicoes) {
        const em = instanteSamu(p.dataEvento);
        if (!em) continue;
        const d = porEquipe.get(p.idEquipe) ?? null;
        const v = d ? vinculo.get(d.unidadeSamu) : undefined;
        const chave = v?.codigo ?? (d ? `samu:${d.unidadeSamu}` : `equipe:${p.idEquipe}`);
        const atual = porChave.get(chave);
        // Equipe trocada no meio do dia: fica a posição mais nova da viatura.
        if (atual && atual.em >= em) continue;
        porChave.set(chave, {
            chave, posicao: p, em, dispositivo: d,
            codigo: v?.codigo ?? null, nomeDifere: v?.nomeDifere ?? false,
        });
    }
    return porChave;
}

/** O que entra na conta de permanência: nem moto, nem desativada. */
export function leiturasParaPermanencia(
    resolvidas: ReadonlyMap<string, Resolvida>,
    desativadas: ReadonlySet<string>,
    catalogo: readonly ViaturaCatalogo[],
): Leitura[] {
    const basePorCodigo = new Map(catalogo.map((c) => [c.codigo, COORDENADAS_BASES[c.base] ?? null]));
    const saida: Leitura[] = [];
    for (const r of resolvidas.values()) {
        if (r.posicao.lat === null || r.posicao.lng === null) continue;
        if (r.codigo && desativadas.has(r.codigo)) continue;
        if (!r.codigo && r.dispositivo && ehMoto(r.dispositivo.nome)) continue;
        saida.push({
            chave: r.chave, em: r.em, lat: r.posicao.lat, lng: r.posicao.lng,
            base: r.codigo ? basePorCodigo.get(r.codigo) ?? null : null,
        });
    }
    return saida;
}

export function montarPainel(entrada: {
    ativo: boolean;
    coletadoEm: Date | null;
    vinculosEm: Date | null;
    erro: string | null;
    catalogo: readonly ViaturaCatalogo[];
    desativadas: ReadonlySet<string>;
    hospitais: readonly HospitalFrota[];
    resolvidas: ReadonlyMap<string, Resolvida>;
    dispositivos: readonly DispositivoSamu[];
    abertas: ReadonlyMap<string, Permanencia>;
    agora: Date;
}): PainelFrota {
    const { catalogo, desativadas, hospitais, resolvidas, abertas, agora } = entrada;
    const nomeHospital = new Map(hospitais.map((h) => [h.id, h.nome]));
    // Bateria/sinal de quem não transmitiu vêm da página de status (último valor).
    const vinculo = vincular(entrada.dispositivos, catalogo);
    const dispPorCodigo = new Map<string, DispositivoSamu>();
    for (const d of entrada.dispositivos) {
        const v = vinculo.get(d.unidadeSamu);
        if (v) dispPorCodigo.set(v.codigo, d);
    }

    const montar = (
        chave: string,
        base: Pick<ViaturaFrota, "codigo" | "nome" | "tipo" | "base" | "turno" | "foraDoCatalogo">,
        status: string | null,
    ): ViaturaFrota => {
        const r = resolvidas.get(chave);
        const pontoBase = base.base ? COORDENADAS_BASES[base.base] ?? null : null;
        const d = r?.dispositivo ?? (base.codigo ? dispPorCodigo.get(base.codigo) : undefined) ?? null;
        const idadeMin = r ? Math.max(0, Math.floor((agora.getTime() - r.em.getTime()) / 60_000)) : null;
        const s = situacao({ codigo: base.codigo, turno: base.turno, status }, idadeMin, desativadas, agora);
        const p = abertas.get(chave);
        const minutos = p ? duracaoMin(p, agora) : 0;
        return {
            chave,
            ...base,
            nomeSamu: d?.nome ?? null,
            nomeDifere: r?.nomeDifere ?? false,
            situacao: s.situacao,
            motivo: s.motivo,
            posicao:
                r && r.posicao.lat !== null && r.posicao.lng !== null && idadeMin !== null
                    ? { lat: r.posicao.lat, lng: r.posicao.lng, em: r.em.toISOString(), idadeMin }
                    : null,
            naBase:
                r?.posicao.lat != null && r.posicao.lng != null
                    ? naBase({ lat: r.posicao.lat, lng: r.posicao.lng, base: pontoBase })
                    : false,
            bateria: d?.bateria ?? null,
            sinal: d?.sinal ?? null,
            velocidade: d?.velocidade ?? null,
            noHospital:
                p && s.situacao === "mapa"
                    ? {
                          hospitalId: p.hospitalId,
                          hospitalNome: nomeHospital.get(p.hospitalId) ?? p.hospitalId,
                          entrada: p.entrada.toISOString(),
                          ultimaVez: p.ultimaVez.toISOString(),
                          minutos,
                          alerta: minutos >= ALERTA_MIN,
                      }
                    : null,
        };
    };

    const viaturas: ViaturaFrota[] = catalogo.map((c) =>
        montar(c.codigo, { codigo: c.codigo, nome: c.codigo, tipo: c.tipo, base: c.base, turno: c.turno, foraDoCatalogo: false }, c.status),
    );

    let foraDoCatalogoSemSinal = 0;
    for (const r of resolvidas.values()) {
        if (r.codigo) continue;
        const idade = (agora.getTime() - r.em.getTime()) / 60_000;
        if (idade > MAPA_MIN || r.posicao.lat === null) {
            foraDoCatalogoSemSinal++;
            continue;
        }
        const nome = r.dispositivo?.nome ?? `Equipe ${r.posicao.idEquipe}`;
        viaturas.push(
            montar(r.chave, {
                codigo: null, nome, tipo: ehMoto(nome) ? "MOTO" : null,
                base: null, turno: null, foraDoCatalogo: true,
            }, null),
        );
    }

    return {
        ativo: entrada.ativo,
        coletadoEm: entrada.coletadoEm?.toISOString() ?? null,
        vinculosEm: entrada.vinculosEm?.toISOString() ?? null,
        erro: entrada.erro,
        limites: { raioM: RAIO_M, raioSaidaM: RAIO_SAIDA_M, alertaMin: ALERTA_MIN, recenteMin: RECENTE_MIN, mapaMin: MAPA_MIN },
        hospitais: [...hospitais],
        viaturas,
        foraDoCatalogoSemSinal,
    };
}
