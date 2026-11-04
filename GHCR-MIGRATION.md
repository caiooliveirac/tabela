# Migração para GHCR (build fora da produção)

**Problema que isto resolve:** hoje o `deploy.yml` faz `docker compose build --no-cache`
no servidor de produção a cada push — o build compete com os apps por CPU/RAM e
acumula dezenas de GB de cache no disco de produção.

**Depois:** o build roda no runner do GitHub, publica as imagens no GHCR, e o
servidor só faz `docker compose pull`. Rollback vira `docker pull <sha-anterior>`.

## Fluxo

```
push main → build-push.yml (build api+web no runner → push GHCR)
          → deploy.yml (workflow_run, só se o build passou → SSH → pull → up -d)
```

## O que muda

- `.github/workflows/build-push.yml` (novo): constrói `tabela-api` e `tabela-web`
  e publica em `ghcr.io/caiooliveirac/tabela-{api,web}` com tags `:latest` e `:sha-xxxx`.
  Usa `GITHUB_TOKEN` (não precisa de PAT para PUSH).
- `deploy.yml`: `build --no-cache` → `docker compose pull`. Encadeado via `workflow_run`.
- `docker-compose.yml`: cada serviço ganhou `image: ghcr.io/...` (o `build:` fica
  para dev local).

## Passos para ativar (depois de revisar o PR)

1. **Validar** que o build-push já rodou neste branch e as imagens estão no GHCR
   (aba *Packages* do perfil / repositório).
2. **Visibilidade dos pacotes:**
   - Repositório **público** (caso do `tabela`): torne os pacotes `tabela-api` e
     `tabela-web` públicos (Package settings → Change visibility) — aí o servidor
     puxa **sem login**.
   - Repositório **privado** (demais apps): o servidor precisa de login uma vez:
     ```bash
     # PAT classic com escopo SOMENTE read:packages
     echo "<PAT>" | docker login ghcr.io -u caiooliveirac --password-stdin
     ```
     (fica salvo em `~/.docker/config.json`; o deploy só faz `docker compose pull`).
3. **Merge do PR.** O primeiro deploy pós-merge já roda pull-based.

## Replicar para os outros apps

Mesmo padrão. Para apps de imagem única (ex.: `taximetro-digital`), o `build-push.yml`
fica sem a matriz. Quando todos migrarem, o runner self-hosted
(`actions-runner-simulador`) pode ser desativado ou isolado — hoje ele é um vetor
de ataque (qualquer workflow comprometido executa na produção).
