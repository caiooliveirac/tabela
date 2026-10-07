#!/usr/bin/env node
// Ponte do mapa de equipes da regulação para a Frota da Tabela.
//
// O mapa (dashmapa) só responde dentro da rede da SMS/VPN; o servidor da
// Tabela não o alcança. Este script roda numa máquina de dentro da rede, lê o
// JSON a cada 30 s e manda a POST /tabela/api/frota/ocorrencias SÓ o que o
// painel precisa: equipe, protocolo, médico regulador, status, horários,
// endereço, bairro, queixa e HMA. Nome, idade, sexo e telefone do paciente e o
// solicitante não saem daqui.
//
// Node 18+, sem dependências:
//   MAPA_EQUIPES_TOKEN=... node scripts/mapa-equipes-coletor.mjs
// O token é o MAPA_EQUIPES_TOKEN do .env da Tabela no servidor.

const ORIGEM = process.env.MAPA_EQUIPES_URL || "http://172.23.130.87/dashmapa/mapa/refresh_maps_equipes";
const DESTINO = process.env.TABELA_OCORRENCIAS_URL || "https://mnrs.com.br/tabela/api/frota/ocorrencias";
const TOKEN = process.env.MAPA_EQUIPES_TOKEN || "";
const INTERVALO_MS = 30_000;

if (!TOKEN) {
    console.error("MAPA_EQUIPES_TOKEN não definido");
    process.exit(1);
}

async function ciclo() {
    // A VPN leva até 10 s só para conectar.
    const res = await fetch(ORIGEM, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`mapa: HTTP ${res.status}`);
    const equipes = (await res.json()).map((e) => {
        const d = e.dados;
        return {
            equipe: e.equipe,
            ocorrencia: d && {
                protocolo: d.protocolo,
                medico: d.medico,
                status: d.status_deslocamento?.status,
                statusEm: d.status_deslocamento?.data,
                abertura: d.horario_abertura,
                risco: d.classificacao_risco,
                regulacaoSecundaria: d.regulacao_secundaria === "SIM",
                endereco: [d.endereco, d.numero].filter(Boolean).join(", "),
                bairro: d.bairro,
                queixa: d.queixa,
                hma: d.hma,
            },
        };
    });
    const envio = await fetch(DESTINO, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mapa-token": TOKEN },
        body: JSON.stringify({ equipes }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!envio.ok) throw new Error(`tabela: HTTP ${envio.status}`);
    return equipes.length;
}

// Uma linha quando muda de estado (ok ↔ erro), não uma a cada 30 s.
let ultimo = "";
for (;;) {
    let estado;
    try {
        estado = `ok: ${await ciclo()} equipes`;
    } catch (e) {
        estado = `erro: ${e.message}`;
    }
    if (estado !== ultimo) console.log(new Date().toISOString(), estado);
    ultimo = estado;
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
}
