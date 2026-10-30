// ═══════════════════════════════════════════════════════════════
// Os hospitais do painel (menos o Mário Leal), com o ponto do PRÉDIO — é em volta dele que o
// raio de 150 m decide se a ambulância "está no hospital".
//
// Seis vêm de COORDENADAS_HOSPITAIS (Destino, geocodificadas em 23/08/2026).
// Os outros cinco foram resolvidos em 29/09/2026 para esta tela:
//   • menandro, juliano_moreira, couto_maia — Geocoding, ROOFTOP
//     com tipo `hospital` (o prédio, não a rua);
//   • eladio — Places (Text Search). O ponto do Destino é o meio da rua
//     (GEOMETRIC_CENTER, ~150 m de erro): serve para ordenar por tempo de
//     carro, mas é do tamanho do próprio raio. Aqui usa-se o prédio.
// ═══════════════════════════════════════════════════════════════
import { HOSPITALS } from "../services/score.js";
import { COORDENADAS_HOSPITAIS } from "../services/encaminhamento.js";
import { UPAS_FROTA } from "./upas.js";

export interface PontoAprendido {
    lat: number;
    lng: number;
    /** Quantas viaturas diferentes pararam ali (a evidência). */
    viaturas: number;
}

export interface HospitalFrota {
    id: string;
    nome: string;
    /** UPA não cruza com o Acolhimentos (que só registra hospital). */
    tipo: "hospital" | "upa";
    lat: number;
    lng: number;
    /**
     * Raio próprio de entrada, no lugar dos 150 m. Local colado num vizinho
     * maior (UPA Cabula × HGRS) só conta com a viatura em cima dele, e não
     * aprende estacionamento.
     */
    raio?: number;
    /** Estacionamentos aprendidos do GPS (`aprenderPontos`): contam como o pino. */
    pontos?: readonly PontoAprendido[];
    /**
     * Portas declaradas à mão (`PORTAS`): onde a ambulância de fato para.
     * Contam como o pino (raio de 150 m em volta de cada uma) e puxam para o
     * local a parada que abriu no vizinho.
     */
    portas?: readonly { lat: number; lng: number }[];
}

const PONTOS_PROPRIOS: Record<string, { lat: number; lng: number }> = {
    // Places: "Hospital Professor Eládio Lassére (HPEL)", Cajazeiras II.
    eladio: { lat: -12.8896327, lng: -38.4220795 },
    // Est. do Coco, km 4 — Jardim Aeroporto, Lauro de Freitas.
    menandro: { lat: -12.881229, lng: -38.314589 },
    // Av. Edgard Santos, s/n — Narandiba.
    juliano_moreira: { lat: -12.9525721, lng: -38.4497659 },
    // R. Cel. Azevedo — Cajazeiras (vizinho do Eládio, ~280 m).
    couto_maia: { lat: -12.8876931, lng: -38.4203797 },
};

/**
 * Porta = onde a ambulância de fato para, quando o pino do prédio não basta
 * para separar o hospital do vizinho. DADO medido no GPS (`estavel_lat/lng`
 * de frota_permanencias, 29/09 a 11/10/2026), não geocodificado.
 *
 * • hgrs — a baia da emergência fica a ~85 m do pino do prédio e a ~165 m do
 *   pino da UPA Cabula. Sem a porta, a UPA Cabula aprendeu a baia como
 *   estacionamento dela em 01/10/2026 e passou a levar toda chegada ao HGRS:
 *   72 paradas na UPA contra 4 no hospital em 12 dias, 44 delas de USA.
 *   Os dois pontos são os dois estacionamentos que a UPA tinha aprendido.
 * • hgesf — quem entra pela praça cruza primeiro o raio do 16º Centro e a
 *   parada travava lá, mesmo estacionando no pino do HGESF (21 paradas).
 */
const PORTAS: Record<string, readonly { lat: number; lng: number }[]> = {
    hgrs: [
        { lat: -12.95609, lng: -38.45056 },
        { lat: -12.95604, lng: -38.45115 },
    ],
    hgesf: [{ lat: -12.95875, lng: -38.48648 }],
};

/**
 * Fora da frota (20/10/2026): o Mário Leal fica a 120 m do pátio da base do
 * Pau Miúdo, onde viatura de toda base para sem paciente — 46 min da BR60
 * "no Mário Leal" sem ocorrência no mapa viraram aviso. O pátio agora é base
 * comum (`PATIOS_COMUNS` em catalogo.ts).
 */
const FORA_DA_FROTA = new Set(["mario_leal"]);

/**
 * Hospitais fora do painel, só para a frota ver a chegada. Não estão no
 * Acolhimentos: nunca "sem notificação" (`NO_ACOLHIMENTOS`).
 * • aristides_maltez — Av. Dom João VI, Brotas (OpenStreetMap, amenity
 *   hospital, 20/10/2026). A BR60 levou paciente para lá e não abriu parada.
 * • cardio_pulmonar — Av. Anita Garibaldi, 2199, Federação (OpenStreetMap,
 *   amenity hospital, 30/10/2026). Privado: retenção lá não aparecia em lugar
 *   nenhum, e o coletor não guarda trilha para saber depois.
 */
const HOSPITAIS_SO_FROTA: readonly HospitalFrota[] = [
    { id: "aristides_maltez", nome: "Aristides Maltez", tipo: "hospital", lat: -12.9904725, lng: -38.4860105 },
    { id: "cardio_pulmonar", nome: "Cardio Pulmonar", tipo: "hospital", lat: -13.005965, lng: -38.5003294 },
];

export const HOSPITAIS_FROTA: readonly HospitalFrota[] = [
    ...HOSPITALS.filter((h) => !FORA_DA_FROTA.has(h.id)).map((h): HospitalFrota => {
        const p = PONTOS_PROPRIOS[h.id] ?? COORDENADAS_HOSPITAIS[h.id];
        if (!p) throw new Error(`hospital sem coordenada na frota: ${h.id}`);
        return { id: h.id, nome: h.name, tipo: "hospital", lat: p.lat, lng: p.lng, ...(PORTAS[h.id] ? { portas: PORTAS[h.id] } : {}) };
    }),
    ...HOSPITAIS_SO_FROTA,
];

/** Hospitais que o Acolhimentos registra (os do painel): só neles cabe "sem notificação". */
export const NO_ACOLHIMENTOS: ReadonlySet<string> = new Set(HOSPITALS.map((h) => h.id));

/** Todo ponto com raio: os hospitais e as UPAs (`upas.ts`). */
export const LOCAIS_FROTA: readonly HospitalFrota[] = [...HOSPITAIS_FROTA, ...UPAS_FROTA];
