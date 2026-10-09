# Ponte do mapa externo do SAMU+

Leva **ocorrências + disponibilidade por equipe** do painel INTERNO do SAMU+
(`172.23.130.87/dashmapa`, só na VPN da Central) para o Painel Frota no magalu.
O magalu não alcança esse IP; por isso a ponte roda numa máquina da Central.

A posição crua de viatura o magalu já pega sozinho da nuvem do SAMU+
(`apiconecta.samumais.com.br`, `samumais.ts`). O que só existe no painel interno
é a **ocorrência**: protocolo, cor de risco e `status_deslocamento`. É isso que
a ponte traz.

## Arquivos

- `coletor-frota.mjs` — o programa. Node 18+, sem dependências. A cada ~1 min:
  lê o mapa interno, **corta todo dado de paciente** (whitelist), faz POST do
  lote reduzido na API da Tabela. Não grava a resposta crua; nada em memória
  além do último lote.
- `coletor-frota.bat` — sobe o `.mjs` no Windows e o reergue se cair. Vai na
  pasta de inicialização do usuário (`shell:startup`).

## O que trafega (whitelist)

Por equipe: `equipe`, `unidade`, `tipo_unidade`, `latitude`, `longitude`,
`velocidade`, `data_gps`, `em_ocorrencia`. Quando em ocorrência, ainda:
`protocolo`, `classificacao_risco`, `horario_abertura`, `status_deslocamento`
(status + hora). Opcional: `bairro`/`cidade` (`ENVIAR_BAIRRO=1`).

**Nunca sai**: nome, sexo, idade, telefone, solicitante, médico, endereço,
referência, HMA, diagnóstico. Cortado na máquina, antes de qualquer envio.
A API (`api/src/frota/mapaExterno.ts`) só copia a whitelist — defesa dupla.

## Instalar (máquina da Central, na VPN)

1. Node 18+ (`node -v`). Único passo com admin.
2. Confirmar que o navegador da máquina abre `http://172.23.130.87/dashmapa/mapa`.
3. Token: `setx PONTE_TOKEN "<token>"` (ou editar o `.bat`). O mesmo valor fica
   no `.env` do servidor como `PONTE_MAPA_TOKEN`. **Segredo — nunca no repo.**
4. Atalho do `.bat` em `shell:startup`.

## Contrato

- Destino: `POST https://mnrs.com.br/tabela/api/frota/mapa-ingest`
  header `X-Ponte-Token: <token>`, corpo = lista de equipes (JSON).
- Leitura (painel): `GET /tabela/api/frota/mapa` (atrás do login do portal).
- nginx deixa só o POST do `mapa-ingest` passar sem o porteiro (`nginx-host.conf`).
