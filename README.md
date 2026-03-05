# Painel de Vagas — Regulação SAMU Salvador

Painel web para regulação médica do SAMU Salvador. Médicos reguladores registram tentativas de envio de pacientes para hospitais (aceito ou vaga zero), registram intel qualitativa (lotação, falta de recurso, envio planejado), e o painel calcula um score por hospital para ajudar na decisão rápida.

## Como Usar o Painel

### Identificação

- Preencha seu nome no campo do cabeçalho antes de interagir
- Sem nome preenchido, você pode visualizar tudo mas não pode registrar ou remover

### Semáforo de Hospitais

- **Verde (Aceitando):** Hospital com boa taxa de aceite e sem alertas negativos
- **Amarelo (Atenção):** Algum alerta ativo ou taxa de aceite moderada
- **Vermelho (Negando):** Alta taxa de vaga zero ou alertas graves
- Os hospitais são rankeados por score (0-100) dentro de cada categoria

### Registrar Caso (+ Caso)

1. Clique em **+ Caso** no cabeçalho
2. Selecione o hospital e o resultado (Aceito / Vaga Zero) — campos obrigatórios
3. Preencha caso clínico, MR, médico e OC opcionalmente
4. O caso aparece imediatamente no card e na aba Casos

### Intel Qualitativa (⚠ Intel)

Registre situações que afetam a regulação:

- 🔴 **Lotado** — emergência cheia
- 🟡 **Sem especialista** — falta de profissional específico
- 🟠 **Sem recurso** — equipamento fora do ar (tomografia, etc.)
- 🚑 **Envio planejado** — ambulância a caminho
- 🟢 **Aceitando bem** — plantonista receptivo
- 🔵 **Normalizou** — situação anterior resolvida

### Cards de Hospital

- Clique em um card para ver detalhes, casos e intel
- A barra lateral colorida indica o semáforo
- A barra horizontal mostra proporção aceitos vs vagas zero
- Vaga zero aparece com alerta por até 6h

### Aba Casos

- Mostra timeline completa das últimas 24h
- Os cards do semáforo consideram apenas casos desde as 7h

### Removendo Registros

- **Intel:** Clique no card do hospital → botão "Remover" na intel ativa
- **Caso:** Na tabela de casos → botão "✕" com confirmação obrigatória
- Todas as remoções ficam registradas com quem removeu e quando

### Tutorial

- Clique em **📖 Tutorial** para um guia interativo com dados de demonstração

---

## Setup de Desenvolvimento

### Pré-requisitos

- Docker e Docker Compose
- Node.js 20+ (para desenvolvimento local sem Docker)

### Com Docker (recomendado)

```bash
# Copiar variáveis de ambiente
cp .env.example .env

# Subir todos os serviços com hot reload
docker compose -f docker-compose.dev.yml up

# API: http://localhost:3000
# Web: http://localhost:5173
# Postgres: localhost:5432
```

### Sem Docker

```bash
# Ter um PostgreSQL rodando localmente

# Backend
cd api
npm install
cp ../.env.example .env  # ajustar DATABASE_URL
npm run db:migrate
npm run db:seed          # dados de exemplo
npm run dev              # http://localhost:3000

# Frontend (em outro terminal)
cd web
npm install
npm run dev              # http://localhost:5173
```

### Migrations

```bash
# Gerar nova migration após alterar schema
cd api
npm run db:generate

# Aplicar migrations
npm run db:migrate

# Popular com dados de exemplo
npm run db:seed
```

---

## Deploy em Produção

### Servidor (single server com Docker)

```bash
# No servidor (ARM64 / Graviton)
git clone git@github.com:caiooliveirac/tabela.git
cd tabela
cp .env.example .env     # configurar senhas reais!

# Build e start
docker compose build
docker compose up -d

# Migrations
docker compose exec api node dist/db/migrate.js
```

### Nginx do Host

Adicione o conteúdo de `nginx-host.conf` dentro do `server {}` block existente no seu Nginx:

```bash
sudo nano /etc/nginx/sites-available/default
# Colar conteúdo de nginx-host.conf
sudo nginx -t && sudo systemctl reload nginx
```

### CI/CD (GitHub Actions)

O workflow `.github/workflows/deploy.yml` faz deploy automático a cada push na `main`:

1. SSH no servidor
2. `git pull`
3. `docker compose build && up -d`
4. Healthcheck

Secrets necessários no GitHub:

- `EC2_HOST` — IP/hostname do servidor
- `EC2_USER` — usuário SSH
- `SSH_PRIVATE_KEY` — chave SSH privada

---

## Stack

| Camada   | Tecnologia                              |
| -------- | --------------------------------------- |
| Frontend | React 19 + TypeScript + Vite + Tailwind |
| Backend  | Node.js + Express + TypeScript          |
| Banco    | PostgreSQL 16 + Drizzle ORM             |
| Realtime | WebSocket (ws)                          |
| Infra    | Docker Compose + Nginx                  |
| CI/CD    | GitHub Actions                          |

## Estrutura

```
├── api/                  # Backend Express + TypeScript
│   ├── src/
│   │   ├── db/           # Schema Drizzle, migrations, seed
│   │   ├── routes/       # Cases, intel, hospitals
│   │   ├── services/     # Score engine
│   │   └── ws/           # WebSocket handler
│   └── drizzle/          # Migration files
├── web/                  # Frontend React + Vite
│   └── src/
│       ├── api/          # Fetch + WebSocket client
│       ├── components/   # Dashboard, cards, modals
│       ├── hooks/        # React Query hooks
│       └── lib/          # Types, constants
├── docker/               # Dockerfiles + nginx.conf
├── docker-compose.yml    # Produção
├── docker-compose.dev.yml # Desenvolvimento
└── nginx-host.conf       # Snippet para Nginx do host
```
