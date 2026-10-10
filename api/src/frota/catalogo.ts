// ═══════════════════════════════════════════════════════════════
// Catálogo das viaturas do SAMU Salvador / RMS — DADO, não código.
//
// Copiado de ChecagemdeBases `bot/src/data/bases.ts` (origin/main 9a0cfaf,
// "fonte oficial da Secretaria"). Ordem preservada. Turno e status são o
// texto literal da planilha. Viatura nova ou base trocada: atualizar aqui a
// partir de lá, nunca de cabeça.
// ═══════════════════════════════════════════════════════════════

export interface ViaturaCatalogo {
    codigo: string;
    tipo: "USA" | "USB";
    /** `24h`, `10h`, `SD`, `24H ÊNFASE PSIQUIATRIA`. */
    turno: string;
    /** `ATIVA`, `DESATIVADA SD`, `DESATIVADA 24H`. */
    status: string;
    base: string;
}

/**
 * Fora de operação até segunda ordem — decisão da coordenação em 29/09/2026
 * (36, 39, 48, 64, 66, 67 e 68). Vale só para este painel: não mexe na
 * checagem nem na planilha oficial. Reativar = tirar daqui.
 */
export const DESATIVADAS_ATE_SEGUNDA_ORDEM: ReadonlySet<string> = new Set([
    "PR36", "JA39", "PM48", "BR64", "BR66", "PB67", "PB68",
]);

/**
 * Numeral acima de 74 (RMS: Candeias, Lauro, Madre de Deus, Santo Amaro,
 * Saubara, São Francisco do Conde, Simões Filho, Vera Cruz) nunca teve
 * conexão com o SAMU+: dado lixo, fora de toda conta e tela (decisão de
 * 29/09/2026). Vale para o catálogo e para o nome no SAMU+ ("MT 76 (SF)").
 * LFEX ("LFEX 01 (A)" no SAMU+) não existe nem existirá (decisão de
 * 10/10/2026): mesmo lixo, e `vincular` não deixa o número 1 tomar a SM01.
 */
export const NUMERO_MAX = 74;

export function numeroNoLimite(nome: string): boolean {
    if (/^\s*LFEX/i.test(nome)) return false;
    const m = /\d+/.exec(nome);
    return m === null || Number(m[0]) <= NUMERO_MAX;
}

const PLANILHA: readonly ViaturaCatalogo[] = [
    { codigo: "CN10", tipo: "USA", turno: "24h", status: "ATIVA", base: "5º CENTRO" },
    { codigo: "CN11", tipo: "USB", turno: "24h", status: "ATIVA", base: "5º CENTRO" },
    { codigo: "CN12", tipo: "USB", turno: "10h", status: "ATIVA", base: "5º CENTRO" },
    { codigo: "CN13", tipo: "USB", turno: "24H ÊNFASE PSIQUIATRIA", status: "ATIVA", base: "5º CENTRO" },
    { codigo: "SM01", tipo: "USA", turno: "24h", status: "ATIVA", base: "SAN MARTIN" },
    { codigo: "SM17", tipo: "USB", turno: "24h", status: "ATIVA", base: "SAN MARTIN" },
    { codigo: "SM18", tipo: "USB", turno: "24h", status: "ATIVA", base: "SAN MARTIN" },
    { codigo: "SM19", tipo: "USB", turno: "10h", status: "ATIVA", base: "SAN MARTIN" },
    { codigo: "PP20", tipo: "USA", turno: "24h", status: "ATIVA", base: "PERIPERI" },
    { codigo: "PP21", tipo: "USB", turno: "24h", status: "ATIVA", base: "PERIPERI" },
    { codigo: "PP22", tipo: "USB", turno: "10h", status: "ATIVA", base: "PERIPERI" },
    { codigo: "PP23", tipo: "USB", turno: "24h", status: "ATIVA", base: "PERIPERI" },
    { codigo: "CB02", tipo: "USA", turno: "24h", status: "ATIVA", base: "UPA SANTO ANTÔNIO (CIDADE BAIXA)" },
    { codigo: "CB25", tipo: "USB", turno: "24h", status: "ATIVA", base: "UPA SANTO ANTÔNIO (CIDADE BAIXA)" },
    { codigo: "CB26", tipo: "USB", turno: "24h", status: "ATIVA", base: "UPA SANTO ANTÔNIO (CIDADE BAIXA)" },
    { codigo: "CB27", tipo: "USB", turno: "24h", status: "ATIVA", base: "UPA SANTO ANTÔNIO (CIDADE BAIXA)" },
    { codigo: "CB28", tipo: "USB", turno: "10h", status: "ATIVA", base: "UPA SANTO ANTÔNIO (CIDADE BAIXA)" },
    { codigo: "IT30", tipo: "USA", turno: "24h", status: "ATIVA", base: "ITAPUÃ" },
    { codigo: "IT31", tipo: "USB", turno: "24h", status: "ATIVA", base: "ITAPUÃ" },
    { codigo: "IT32", tipo: "USB", turno: "24h", status: "ATIVA", base: "ITAPUÃ" },
    { codigo: "PR03", tipo: "USA", turno: "24h", status: "ATIVA", base: "FTC" },
    { codigo: "PR33", tipo: "USB", turno: "24h", status: "ATIVA", base: "FTC" },
    { codigo: "PR34", tipo: "USB", turno: "24h", status: "ATIVA", base: "FTC" },
    { codigo: "PR35", tipo: "USB", turno: "10h", status: "ATIVA", base: "FTC" },
    { codigo: "PR36", tipo: "USB", turno: "SD", status: "DESATIVADA SD", base: "FTC" },
    { codigo: "JA37", tipo: "USB", turno: "24h", status: "ATIVA", base: "JORGE AMADO" },
    { codigo: "JA38", tipo: "USB", turno: "24h", status: "ATIVA", base: "JORGE AMADO" },
    { codigo: "JA39", tipo: "USB", turno: "SD", status: "DESATIVADA SD", base: "JORGE AMADO" },
    { codigo: "PM04", tipo: "USA", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM40", tipo: "USA", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM41", tipo: "USB", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM42", tipo: "USB", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM43", tipo: "USB", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM44", tipo: "USB", turno: "10h", status: "DESATIVADA 24H", base: "PAU MIÚDO" },
    { codigo: "PM45", tipo: "USB", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM46", tipo: "USB", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM47", tipo: "USB", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM48", tipo: "USB", turno: "SD", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "PM49", tipo: "USB", turno: "24h", status: "ATIVA", base: "PAU MIÚDO" },
    { codigo: "CZ50", tipo: "USA", turno: "24h", status: "ATIVA", base: "CAJAZEIRAS" },
    { codigo: "CZ51", tipo: "USB", turno: "24h", status: "DESATIVADA 24H", base: "CAJAZEIRAS" },
    { codigo: "CZ52", tipo: "USB", turno: "24h", status: "ATIVA", base: "CAJAZEIRAS" },
    { codigo: "CZ53", tipo: "USB", turno: "10h", status: "ATIVA", base: "CAJAZEIRAS" },
    { codigo: "SC54", tipo: "USB", turno: "24h", status: "ATIVA", base: "SÃO CRISTÓVÃO" },
    { codigo: "SC55", tipo: "USB", turno: "24h", status: "ATIVA", base: "SÃO CRISTÓVÃO" },
    { codigo: "VL56", tipo: "USB", turno: "24h", status: "ATIVA", base: "VALÉRIA" },
    { codigo: "VL57", tipo: "USB", turno: "24h", status: "ATIVA", base: "VALÉRIA" },
    { codigo: "BR05", tipo: "USA", turno: "24h", status: "ATIVA", base: "BOCA DO RIO ROSA GARCIA" },
    { codigo: "BR60", tipo: "USA", turno: "24h", status: "ATIVA", base: "BOCA DO RIO ROSA GARCIA" },
    { codigo: "BR61", tipo: "USB", turno: "24h", status: "ATIVA", base: "BOCA DO RIO ROSA GARCIA" },
    { codigo: "BR62", tipo: "USB", turno: "10h", status: "ATIVA", base: "BOCA DO RIO ROSA GARCIA" },
    { codigo: "BR63", tipo: "USB", turno: "24h", status: "ATIVA", base: "BOCA DO RIO ROSA GARCIA" },
    { codigo: "BR64", tipo: "USB", turno: "SD", status: "DESATIVADA SD", base: "BOCA DO RIO ROSA GARCIA" },
    { codigo: "BR65", tipo: "USB", turno: "24h", status: "ATIVA", base: "BOCA DO RIO 12º CENTRO" },
    { codigo: "BR66", tipo: "USB", turno: "SD", status: "DESATIVADA SD", base: "BOCA DO RIO 12º CENTRO" },
    { codigo: "PB67", tipo: "USB", turno: "24h", status: "ATIVA", base: "PITUBA ARENA" },
    { codigo: "PB68", tipo: "USB", turno: "24h", status: "ATIVA", base: "PITUBA ARENA" },
    { codigo: "CC70", tipo: "USA", turno: "24h", status: "ATIVA", base: "CAMPUS CABULA" },
    { codigo: "CC71", tipo: "USB", turno: "24h", status: "ATIVA", base: "CAMPUS CABULA" },
    { codigo: "CC72", tipo: "USB", turno: "24h", status: "DESATIVADA 24H", base: "CAMPUS CABULA" },
    { codigo: "CC73", tipo: "USB", turno: "10h", status: "ATIVA", base: "CAMPUS CABULA" },
    { codigo: "CC74", tipo: "USB", turno: "24h", status: "ATIVA", base: "RODRIGO ARGOLO" },
    { codigo: "CD97", tipo: "USB", turno: "24h", status: "ATIVA", base: "CANDEIAS" },
    { codigo: "CD98", tipo: "USB", turno: "24h", status: "ATIVA", base: "CANDEIAS" },
    { codigo: "CD99", tipo: "USA", turno: "24h", status: "ATIVA", base: "CANDEIAS" },
    { codigo: "LF90", tipo: "USA", turno: "24h", status: "ATIVA", base: "LAURO DE FREITAS" },
    { codigo: "LF91", tipo: "USB", turno: "24h", status: "ATIVA", base: "LAURO DE FREITAS" },
    { codigo: "LF92", tipo: "USB", turno: "24h", status: "ATIVA", base: "LAURO DE FREITAS" },
    { codigo: "MD84", tipo: "USB", turno: "24h", status: "ATIVA", base: "MADRE DE DEUS" },
    { codigo: "MD85", tipo: "USA", turno: "24h", status: "ATIVA", base: "MADRE DE DEUS" },
    { codigo: "SA86", tipo: "USB", turno: "24h", status: "ATIVA", base: "SANTO AMARO" },
    { codigo: "SA89", tipo: "USB", turno: "24h", status: "ATIVA", base: "SANTO AMARO" },
    { codigo: "SB77", tipo: "USB", turno: "24h", status: "ATIVA", base: "SAUBARA" },
    { codigo: "FC87", tipo: "USB", turno: "24h", status: "ATIVA", base: "SÃO FRANCISCO DO CONDE" },
    { codigo: "FC88", tipo: "USA", turno: "24h", status: "DESATIVADA 24H", base: "SÃO FRANCISCO DO CONDE" },
    { codigo: "SF94", tipo: "USB", turno: "24h", status: "ATIVA", base: "SIMÕES FILHO" },
    { codigo: "SF95", tipo: "USB", turno: "24h", status: "ATIVA", base: "SIMÕES FILHO" },
    { codigo: "SF96", tipo: "USA", turno: "24h", status: "ATIVA", base: "SIMÕES FILHO" },
    { codigo: "VC80", tipo: "USA", turno: "24h", status: "ATIVA", base: "VERA CRUZ" },
    { codigo: "VC81", tipo: "USB", turno: "24h", status: "ATIVA", base: "VERA CRUZ" },
    { codigo: "VC82", tipo: "USB", turno: "24h", status: "ATIVA", base: "VERA CRUZ" },
];

/**
 * Motolâncias: fora do catálogo (não entram em parada, aviso nem escala), mas
 * têm base e podem ser desativadas pelo código — é por ele que o QRF, o Quadro
 * e o Huddle as reconhecem. A base é a da USA com que cada uma roda (MT06 com a
 * PM40, MT07 com a BR60, MT08 com a PR03, MT09 com a CN10), informada pela
 * coordenação em 10/10/2026.
 */
export const MOTOS: Readonly<Record<string, string>> = {
    MT06: "PAU MIÚDO",
    MT07: "BOCA DO RIO ROSA GARCIA",
    MT08: "FTC",
    MT09: "5º CENTRO",
};
/** "MT 09" (nome no SAMU+) → "MT09", se for uma das motolâncias conhecidas. */
export const codigoDaMoto = (nome: string): string | null => {
    const codigo = nome.replace(/\s/g, "").toUpperCase();
    return codigo in MOTOS ? codigo : null;
};

export const CATALOGO: readonly ViaturaCatalogo[] = PLANILHA.filter((c) => numeroNoLimite(c.codigo));

/**
 * Ponto das bases com coordenada EXATA — cópia de ChecagemdeBases
 * `src/data/coordenadas.ts` (origin/main), geofence de check-in do
 * taximetro-digital. Viatura a 150 m da PRÓPRIA base está na base, não no
 * hospital: a do Pau Miúdo fica entre o HGESF e o Mário Leal, a de
 * Cajazeiras a 60 m do Municipal. As aproximadas (centro de bairro ou de
 * município) ficam de fora — excluiriam parada de verdade.
 */
export const COORDENADAS_BASES: Readonly<Record<string, { lat: number; lng: number }>> = {
    "5º CENTRO": { lat: -12.990816, lng: -38.511382 },
    "SAN MARTIN": { lat: -12.946836, lng: -38.481288 },
    PERIPERI: { lat: -12.868043, lng: -38.47256 },
    "UPA SANTO ANTÔNIO (CIDADE BAIXA)": { lat: -12.935104, lng: -38.506528 },
    ITAPUÃ: { lat: -12.924475, lng: -38.351147 },
    FTC: { lat: -12.93414, lng: -38.392223 },
    "PAU MIÚDO": { lat: -12.959059, lng: -38.487838 },
    CAJAZEIRAS: { lat: -12.898305, lng: -38.389943 },
    "BOCA DO RIO ROSA GARCIA": { lat: -12.983681, lng: -38.438684 },
    "CAMPUS CABULA": { lat: -12.959085, lng: -38.452476 },
    "JORGE AMADO": { lat: -12.936804, lng: -38.410645 },
    "SÃO CRISTÓVÃO": { lat: -12.907002, lng: -38.36447 },
    "RODRIGO ARGOLO": { lat: -12.94532, lng: -38.446339 },
    // Fora da ChecagemdeBases (lá são aproximadas, ~0,7 e ~1,2 km da UPA):
    // ponto da UPA de mesmo nome em upas.ts. SUPOSIÇÃO pelo nome da base
    // (29/09/2026) — sem ela a viatura parada na base alertaria aos 40 min.
    VALÉRIA: { lat: -12.8646079, lng: -38.4372461 },
    "BOCA DO RIO 12º CENTRO": { lat: -12.9735423, lng: -38.4320045 },
};
