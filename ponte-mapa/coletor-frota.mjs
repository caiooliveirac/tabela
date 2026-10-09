// coletor-frota.mjs — ponte Mapa SAMU+ -> Painel Frota (magalu)
//
// Roda numa maquina da Central, dentro da VPN, ligada 24/7.
// A cada minuto: le o mapa de equipes do SAMU+, JOGA FORA todo dado de
// paciente e envia apenas os campos operacionais (whitelist) ao magalu.
//
// Nao grava a resposta crua em disco. Nao guarda paciente. So faz saidas.
// Requer Node 18+ (usa fetch nativo). Sem npm install.
//
// Config por variavel de ambiente (o .bat preenche):
//   ORIGEM   = http://172.23.130.87/dashmapa/mapa/refresh_maps_equipes
//   DESTINO  = https://mnrs.com.br/tabela/api/frota/mapa-ingest
//   TOKEN    = <segredo de envio>            (obrigatorio)
//   INTERVALO_MS = 60000                     (opcional, padrao 60s)
//   PROTOCOLO_HASH = 1                       (opcional: envia hash, nao o numero)
//   ENVIAR_BAIRRO  = 1                       (opcional: inclui bairro/cidade)

import { createHash } from 'node:crypto';

const ORIGEM = process.env.ORIGEM || 'http://172.23.130.87/dashmapa/mapa/refresh_maps_equipes';
const DESTINO = process.env.DESTINO || '';
const TOKEN = process.env.TOKEN || '';
const INTERVALO_MS = Number(process.env.INTERVALO_MS) || 60000;
const PROTOCOLO_HASH = process.env.PROTOCOLO_HASH === '1';
const ENVIAR_BAIRRO = process.env.ENVIAR_BAIRRO === '1';
const TIMEOUT_MS = 25000;

if (!DESTINO || !TOKEN) {
  console.error('[config] faltam DESTINO e/ou TOKEN. Abortando.');
  process.exit(1);
}

function log(...a) {
  console.log(new Date().toISOString(), ...a); // sem conteudo de ocorrencia
}

// Ocorrencia presente = objeto 'dados' nao vazio.
function temOcorrencia(u) {
  return !!(u && u.dados && typeof u.dados === 'object' && Object.keys(u.dados).length > 0);
}

function hashProtocolo(p) {
  return p ? createHash('sha256').update(String(p)).digest('hex').slice(0, 16) : null;
}

// WHITELIST: so estes campos saem. Qualquer campo novo que o SAMU+ passe a
// mandar (inclusive dado pessoal) e ignorado por padrao.
function reduzir(unidades) {
  return unidades
    .filter(u => u && u.equipe)
    .map(u => {
      const base = {
        equipe: u.equipe,
        unidade: u.unidade || null,
        tipo_unidade: u.tipo_unidade || null,
        latitude: u.latitude || null,
        longitude: u.longitude || null,
        velocidade: u.velocidade || null,
        data_gps: u.data_gps || null,
        em_ocorrencia: temOcorrencia(u),
      };
      if (temOcorrencia(u)) {
        const d = u.dados;
        const sd = d.status_deslocamento;
        base.ocorrencia = {
          protocolo: PROTOCOLO_HASH ? hashProtocolo(d.protocolo) : (d.protocolo || null),
          classificacao_risco: d.classificacao_risco || null,
          horario_abertura: d.horario_abertura || null,
          status_deslocamento: sd && typeof sd === 'object'
            ? { status: sd.status || null, data: sd.data || null }
            : null,
          ...(ENVIAR_BAIRRO ? { bairro: d.bairro || null, cidade: d.cidade || null } : {}),
        };
        // NAO copiado (fica na origem): vitima, sexo, idade, tel_identificado,
        // solicitante, medico, endereco, numero, referencia, hma,
        // diagnostico_sindromico, queixa, regulacao_secundaria, disparo_automatico.
      }
      return base;
    });
}

async function comTimeout(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function cicloUnico() {
  let cru;
  try {
    const r = await comTimeout(ORIGEM, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!r.ok) { log('[origem] HTTP', r.status); return; }
    cru = await r.json(); // em memoria; nunca gravado em disco
  } catch (e) {
    log('[origem] falha:', e.name === 'AbortError' ? 'timeout' : e.message);
    return;
  }

  if (!Array.isArray(cru)) { log('[origem] formato inesperado'); return; }

  const payload = reduzir(cru);
  cru = null; // descarta a resposta crua (com paciente) o quanto antes

  try {
    const r = await comTimeout(DESTINO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ponte-Token': TOKEN },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { log('[destino] HTTP', r.status); return; }
    // Heartbeat enxuto: loga o 1o ciclo, mudanca de estado, ou a cada 10 min.
    // Evita encher o log com 1 linha/minuto.
    const emOcor = payload.filter(u => u.em_ocorrencia).length;
    const assinatura = `${payload.length}/${emOcor}`;
    const agora = Date.now();
    if (assinatura !== ultimaAssinatura || agora - ultimoHeartbeat >= 600000) {
      log('[ok] equipes', payload.length, '| em ocorrencia', emOcor);
      ultimaAssinatura = assinatura;
      ultimoHeartbeat = agora;
    }
  } catch (e) {
    log('[destino] falha:', e.name === 'AbortError' ? 'timeout' : e.message);
  }
}

let ultimaAssinatura = '';
let ultimoHeartbeat = 0;
let rodando = false;
async function tick() {
  if (rodando) return; // evita sobreposicao se um ciclo atrasar
  rodando = true;
  try { await cicloUnico(); } finally { rodando = false; }
}

log('[inicio] origem', ORIGEM, '| destino', DESTINO, '| intervalo', INTERVALO_MS, 'ms',
  '| protocolo', PROTOCOLO_HASH ? 'HASH' : 'numero', '| bairro', ENVIAR_BAIRRO ? 'sim' : 'nao');
tick();
setInterval(tick, INTERVALO_MS);
