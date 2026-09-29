// ═══════════════════════════════════════════════════════════════
// Os 11 hospitais do painel, com o ponto do PRÉDIO — é em volta dele que o
// raio de 150 m decide se a ambulância "está no hospital".
//
// Seis vêm de COORDENADAS_HOSPITAIS (Destino, geocodificadas em 23/08/2026).
// Os outros cinco foram resolvidos em 29/09/2026 para esta tela:
//   • menandro, juliano_moreira, mario_leal, couto_maia — Geocoding, ROOFTOP
//     com tipo `hospital` (o prédio, não a rua);
//   • eladio — Places (Text Search). O ponto do Destino é o meio da rua
//     (GEOMETRIC_CENTER, ~150 m de erro): serve para ordenar por tempo de
//     carro, mas é do tamanho do próprio raio. Aqui usa-se o prédio.
// ═══════════════════════════════════════════════════════════════
import { HOSPITALS } from "../services/score.js";
import { COORDENADAS_HOSPITAIS } from "../services/encaminhamento.js";

export interface HospitalFrota {
    id: string;
    nome: string;
    lat: number;
    lng: number;
}

const PONTOS_PROPRIOS: Record<string, { lat: number; lng: number }> = {
    // Places: "Hospital Professor Eládio Lassére (HPEL)", Cajazeiras II.
    eladio: { lat: -12.8896327, lng: -38.4220795 },
    // Est. do Coco, km 4 — Jardim Aeroporto, Lauro de Freitas.
    menandro: { lat: -12.881229, lng: -38.314589 },
    // Av. Edgard Santos, s/n — Narandiba.
    juliano_moreira: { lat: -12.9525721, lng: -38.4497659 },
    // R. Conde de Porto Alegre, 11 — IAPI.
    mario_leal: { lat: -12.9577518, lng: -38.4883325 },
    // R. Cel. Azevedo — Cajazeiras (vizinho do Eládio, ~280 m).
    couto_maia: { lat: -12.8876931, lng: -38.4203797 },
};

export const HOSPITAIS_FROTA: readonly HospitalFrota[] = HOSPITALS.map((h) => {
    const p = PONTOS_PROPRIOS[h.id] ?? COORDENADAS_HOSPITAIS[h.id];
    if (!p) throw new Error(`hospital sem coordenada na frota: ${h.id}`);
    return { id: h.id, nome: h.name, lat: p.lat, lng: p.lng };
});
