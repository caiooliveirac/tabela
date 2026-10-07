// ═══════════════════════════════════════════════════════════════
// Monta a resposta de GET /tabela/api/frota a partir do que o coletor tem
// em memória. Pura: mesma entrada, mesma saída.
// ═══════════════════════════════════════════════════════════════
import { COORDENADAS_BASES, numeroNoLimite, type ViaturaCatalogo } from "./catalogo.js";
import { motivoPainel, type Desativacao } from "./desativacoes.js";
import type { HospitalFrota } from "./hospitais.js";
import type { SituacaoOcorrencia } from "./ocorrencias.js";
import type { DispositivoSamu, PosicaoSamu } from "./samumais.js";
import {
    ALERTA_MIN, JANELA_CHEGADA_MIN, MAPA_MIN, RAIO_BUSCA_M, RAIO_M, RAIO_SAIDA_M, RECENTE_MIN,
    distanciaLocal, duracaoMin, ehMoto, instanteSamu, naBase, situacao, vincular,
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
    /** Quando a bateria foi lida (o SAMU+ só lê quando o app cai ou volta). */
    bateriaEm: string | null;
    /** Tendência: leitura anterior diferente (maior = descarregando). */
    bateriaAntes: number | null;
    sinal: number | null;
    /** `Dados Móveis`, `Wi-Fi`, `none` (sem internet). */
    conexao: string | null;
    /** Último ONLINE/OFFLINE do app no SAMU+. */
    evento: { tipo: string; em: string } | null;
    velocidade: number | null;
    /** Desativada no painel (rádio, chefe, enfermagem): quem, por quê, desde quando. */
    desativacao: Desativacao | null;
    /** Pelo mapa de equipes: em ocorrência (com o MR) ou livre. `null` = não sei. */
    ocorrencia: SituacaoOcorrencia | null;
    noHospital: {
        /** Id da parada (frota_permanencias) — casa com a linha do tempo. */
        id: number | null;
        hospitalId: string;
        hospitalNome: string;
        entrada: string;
        ultimaVez: string;
        minutos: number;
        alerta: boolean;
        /** Parada na própria base, que fica no hospital: sem alerta. */
        naBase: boolean;
        /** Distância da última posição ao prédio do hospital. */
        distanciaM: number | null;
    } | null;
}

export interface PainelFrota {
    ativo: boolean;
    coletadoEm: string | null;
    vinculosEm: string | null;
    erro: string | null;
    limites: { raioM: number; raioSaidaM: number; raioBuscaM: number; janelaChegadaMin: number; alertaMin: number; recenteMin: number; mapaMin: number };
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
        // Numeral acima de 74 no SAMU+: dado lixo (catalogo.ts, NUMERO_MAX).
        if (d && !numeroNoLimite(d.nome)) continue;
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
    /** Desativações informadas no painel, por código (já somadas em `desativadas`). */
    desativacoes?: ReadonlyMap<string, Desativacao>;
    ocorrenciaDe?: (chave: string) => SituacaoOcorrencia | null;
    agora: Date;
}): PainelFrota {
    const { catalogo, desativadas, hospitais, resolvidas, abertas, agora } = entrada;
    const porHospital = new Map(hospitais.map((h) => [h.id, h]));
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
        const des = base.codigo ? entrada.desativacoes?.get(base.codigo) ?? null : null;
        return {
            chave,
            ...base,
            nomeSamu: d?.nome ?? null,
            nomeDifere: r?.nomeDifere ?? false,
            situacao: s.situacao,
            motivo: des ? motivoPainel(des) : s.motivo,
            desativacao: des,
            ocorrencia: entrada.ocorrenciaDe?.(chave) ?? null,
            posicao:
                r && r.posicao.lat !== null && r.posicao.lng !== null && idadeMin !== null
                    ? { lat: r.posicao.lat, lng: r.posicao.lng, em: r.em.toISOString(), idadeMin }
                    : null,
            naBase:
                r?.posicao.lat != null && r.posicao.lng != null
                    ? naBase({ lat: r.posicao.lat, lng: r.posicao.lng, base: pontoBase })
                    : false,
            bateria: d?.bateria ?? null,
            bateriaEm: d?.bateriaEm ?? null,
            bateriaAntes: d?.bateriaAntes ?? null,
            sinal: d?.sinal ?? null,
            conexao: d?.conexao ?? null,
            evento: d?.evento ?? null,
            velocidade: d?.velocidade ?? null,
            noHospital:
                p && s.situacao === "mapa"
                    ? {
                          id: p.id ?? null,
                          hospitalId: p.hospitalId,
                          hospitalNome: porHospital.get(p.hospitalId)?.nome ?? p.hospitalId,
                          entrada: p.entrada.toISOString(),
                          ultimaVez: p.ultimaVez.toISOString(),
                          minutos,
                          alerta: !p.naBase && minutos >= ALERTA_MIN,
                          naBase: p.naBase,
                          distanciaM:
                              r && r.posicao.lat !== null && r.posicao.lng !== null && porHospital.has(p.hospitalId)
                                  ? Math.round(distanciaLocal({ lat: r.posicao.lat, lng: r.posicao.lng }, porHospital.get(p.hospitalId)!))
                                  : null,
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
        limites: { raioM: RAIO_M, raioSaidaM: RAIO_SAIDA_M, raioBuscaM: RAIO_BUSCA_M, janelaChegadaMin: JANELA_CHEGADA_MIN, alertaMin: ALERTA_MIN, recenteMin: RECENTE_MIN, mapaMin: MAPA_MIN },
        hospitais: [...hospitais],
        viaturas,
        foraDoCatalogoSemSinal,
    };
}
