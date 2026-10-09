#!/usr/bin/env node
// Ponte do mapa de equipes da regulação para a Frota da Tabela.
//
// O mapa (dashmapa) só responde dentro da rede da SMS/VPN; o servidor da
// Tabela não o alcança. Este script roda numa máquina de dentro da rede, lê o
// JSON a cada 30 s e manda a POST /tabela/api/frota/ocorrencias SÓ o que o
// painel precisa: equipe, status, horários, risco, endereço, bairro e queixa.
// NÃO saem daqui: nome, idade, sexo, telefone e solicitante (paciente); HMA
// (história clínica); e a identificação do caso — protocolo e médico regulador.
//
// O corpo vai comprimido (gzip, Content-Encoding): o express descomprime
// sozinho. Campos repetidos (status, risco, datas) encolhem ~5x no fio.
//
// Node 18+, sem dependências:
//   MAPA_EQUIPES_TOKEN=... node scripts/mapa-equipes-coletor.mjs
// O token é o MAPA_EQUIPES_TOKEN do .env da Tabela no servidor.
//
// Só no macOS, por VPN: MAPA_EQUIPES_VPN="nome do serviço de VPN" faz o script
// derrubar e subir a VPN quando o mapa fica 3 min sem responder (a VPN às
// vezes aparece conectada e não passa tráfego). A senha tem de estar salva.
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const ORIGEM = process.env.MAPA_EQUIPES_URL || "http://172.23.130.87/dashmapa/mapa/refresh_maps_equipes";
const DESTINO = process.env.TABELA_OCORRENCIAS_URL || "https://mnrs.com.br/tabela/api/frota/ocorrencias";
const TOKEN = process.env.MAPA_EQUIPES_TOKEN || "";
const INTERVALO_MS = 30_000;
const VPN = process.platform === "darwin" ? process.env.MAPA_EQUIPES_VPN || "" : "";
const VPN_FALHA_MS = 3 * 60_000;
const VPN_ESPERA_MS = 5 * 60_000;

if (!TOKEN) {
    console.error("MAPA_EQUIPES_TOKEN não definido");
    process.exit(1);
}

async function ciclo() {
    // A VPN leva até 10 s só para conectar.
    const res = await fetch(ORIGEM, { signal: AbortSignal.timeout(25_000) }).catch((e) => {
        throw new Error(`mapa: ${e.message}`);
    });
    if (!res.ok) throw new Error(`mapa: HTTP ${res.status}`);
    const equipes = (await res.json()).map((e) => {
        const d = e.dados;
        return {
            equipe: e.equipe,
            ocorrencia: d && {
                status: d.status_deslocamento?.status,
                statusEm: d.status_deslocamento?.data,
                abertura: d.horario_abertura,
                risco: d.classificacao_risco,
                regulacaoSecundaria: d.regulacao_secundaria === "SIM",
                endereco: [d.endereco, d.numero].filter(Boolean).join(", "),
                bairro: d.bairro,
                queixa: d.queixa,
            },
        };
    });
    const envio = await fetch(DESTINO, {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip", "x-mapa-token": TOKEN },
        body: gzipSync(Buffer.from(JSON.stringify({ equipes }))),
        signal: AbortSignal.timeout(15_000),
    });
    if (!envio.ok) throw new Error(`tabela: HTTP ${envio.status}`);
    return equipes.length;
}

// Uma linha quando muda de estado (ok ↔ erro), não uma a cada 30 s.
let ultimo = "";
let mapaFalhaDesde = 0;
let vpnTentadaEm = 0;
for (;;) {
    let estado;
    try {
        estado = `ok: ${await ciclo()} equipes`;
        mapaFalhaDesde = 0;
    } catch (e) {
        estado = `erro: ${e.message}`;
        // Só falha do mapa mexe na VPN; servidor fora do ar não é culpa dela.
        if (e.message.startsWith("mapa:")) mapaFalhaDesde ||= Date.now();
        if (VPN && mapaFalhaDesde && Date.now() - mapaFalhaDesde >= VPN_FALHA_MS && Date.now() - vpnTentadaEm >= VPN_ESPERA_MS) {
            vpnTentadaEm = Date.now();
            console.log(new Date().toISOString(), `reconectando a VPN "${VPN}"`);
            try {
                execFileSync("scutil", ["--nc", "stop", VPN], { timeout: 15_000 });
                await new Promise((r) => setTimeout(r, 3_000));
                execFileSync("scutil", ["--nc", "start", VPN], { timeout: 15_000 });
            } catch (erro) {
                console.log(new Date().toISOString(), `VPN: ${erro.message}`);
            }
        }
    }
    if (estado !== ultimo) console.log(new Date().toISOString(), estado);
    ultimo = estado;
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
}
