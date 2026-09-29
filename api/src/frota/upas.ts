// ═══════════════════════════════════════════════════════════════
// As UPAs (e pronto-atendimentos) monitoradas pela frota — DADO, não código.
// Mesma regra dos hospitais: 150 m para entrar, 200 m para sair, alerta aos
// 40 min.
//
// Ponto = pino do lugar na lista "UPAs" do Google Maps do Caio
// (https://maps.app.goo.gl/ZQ2c7ZsepaxfryaE9), lida em 29/09/2026. UPA
// nova ou pino errado: corrigir na lista e trazer para cá.
//
// Várias bases do SAMU funcionam dentro de UPA (San Martin, Periperi,
// Santo Antônio, São Cristóvão, Rodrigo Argolo, Valéria, 12º Centro): a
// viatura parada na própria base fica cinza, sem alerta (`naBase`).
// ═══════════════════════════════════════════════════════════════
import type { HospitalFrota } from "./hospitais.js";

const u = (id: string, nome: string, lat: number, lng: number): HospitalFrota => ({ id, nome, tipo: "upa", lat, lng });

export const UPAS_FROTA: readonly HospitalFrota[] = [
    u("upa_sao_caetano", "UPA São Caetano", -12.9353774, -38.4757889),
    u("ue_mae_hilda", "UE Mãe Hilda", -12.9458717, -38.4871459),
    u("cs_rodrigo_argollo", "6º Centro Rodrigo Argollo", -12.9454174, -38.4465104),
    // Centro de Saúde Hosanah D'Oliveira e Unidade de Emergência de Cajazeiras VIII.
    u("ue_cajazeiras_viii", "UE Cajazeiras VIII", -12.8999753, -38.4131225),
    u("upa_paripe", "UPA Paripe", -12.8332528, -38.4653385),
    u("upa_adroaldo_albergaria", "UPA Adroaldo Albergaria", -12.8680506, -38.4727781),
    u("upa_santo_antonio", "UPA Santo Antônio", -12.9350577, -38.5063344),
    u("upa_sao_cristovao", "UPA São Cristóvão", -12.9070827, -38.3644306),
    u("upa_valeria", "UPA Valéria", -12.8646079, -38.4372461),
    u("upa_san_martin", "UPA San Martin", -12.9469689, -38.4810893),
    u("ue_piraja", "UE Pirajá", -12.902364, -38.458973),
    // ~230 m do HGRS: os raios se cruzam, vence o ponto mais perto.
    u("upa_cabula", "UPA Cabula", -12.957341, -38.4514592),
    u("upa_piraja_santo_inacio", "UPA Pirajá/Santo Inácio", -12.9265608, -38.4609509),
    u("pa_sao_marcos", "PA São Marcos", -12.9257108, -38.435796),
    u("upa_helio_machado", "UPA Hélio Machado", -12.9489895, -38.3663472),
    u("upa_bairro_da_paz", "UPA Bairro da Paz", -12.9340589, -38.380374),
    u("cs_alfredo_bureau", "12º Centro Alfredo Bureau", -12.9735423, -38.4320045),
    u("upa_brotas", "UPA Brotas", -12.9865128, -38.4801327),
    u("upa_vale_dos_barris", "UPA Vale dos Barris", -12.9898438, -38.5117719),
    // Pau Miúdo: a 90 m do HGESF e 180 m do Mário Leal — vence o mais perto.
    u("cs_imbassahy", "16º Centro Imbassahy", -12.9590152, -38.4872509),
];
