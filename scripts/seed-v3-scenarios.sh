#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Seed v3 Score Engine — Cenários de Teste
#
# Insere cases+intel com timestamps relativos para demonstrar
# o comportamento do decay exponencial em tempo real.
#
# Uso: bash scripts/seed-v3-scenarios.sh
# ═══════════════════════════════════════════════════════════════

API="http://localhost:3001/tabela/api"

echo "🧹 Limpando dados existentes..."

# Buscar e remover todos os cases ativos
CASE_IDS=$(curl -s "$API/cases" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for c in data:
    if c.get('ativo', True):
        print(c['id'])
" 2>/dev/null)

for cid in $CASE_IDS; do
  curl -s -X DELETE "$API/cases/$cid" \
    -H "Content-Type: application/json" \
    -d '{"removidoPor":"seed-v3"}' > /dev/null 2>&1
done

# Buscar e remover todos os intels ativos
INTEL_IDS=$(curl -s "$API/intel" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i in data:
    if i.get('ativo', True):
        print(i['id'])
" 2>/dev/null)

for iid in $INTEL_IDS; do
  curl -s -X DELETE "$API/intel/$iid" \
    -H "Content-Type: application/json" \
    -d '{"removidoPor":"seed-v3"}' > /dev/null 2>&1
done

echo "✅ Dados limpos"

# ── Helper: timestamp N minutos atrás (UTC, formato ISO) ──
ts() {
  python3 -c "
from datetime import datetime, timedelta, timezone
t = datetime.now(timezone.utc) - timedelta(minutes=$1)
print(t.strftime('%Y-%m-%dT%H:%M:%S.000Z'))
"
}

echo ""
echo "📊 Inserindo cenários de teste v3..."
echo ""

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 1: HGE — 1 ZERO 5min atrás → score ≈24
# base 80, zero(-60*0.5^(5/45)=-60*0.926=-56), load(+10, 0 aceitos) = ~34
# Mas com lotado: 80 -56 +10 -30 = 4. Sem lotado: 34
# Vamos inserir SEM intel para isolar o decay
# ═══════════════════════════════════════════════════════════════
echo "  HGE: 1 ZERO 5min atrás (esperado ≈34)"
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"hge\",\"situacao\":\"ZERO\",\"caso\":\"TCE grave Glasgow 6\",\"mr\":\"Karen\",\"medico\":\"Dr. Silva\",\"oc\":\"8001\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 5)\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 2: HGESF — 1 ZERO 30min atrás → score ≈48
# base 80, zero(-60*0.5^(30/45)=-60*0.63=-38), load(+10) = ~52
# ═══════════════════════════════════════════════════════════════
echo "  HGESF: 1 ZERO 30min atrás (esperado ≈52)"
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"hgesf\",\"situacao\":\"ZERO\",\"caso\":\"Politrauma motociclístico\",\"mr\":\"Mariana\",\"medico\":\"Dr. Santos\",\"oc\":\"8002\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 30)\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 3: HGRS — 1 ZERO 45min atrás → score ≈60
# base 80, zero(-60*0.5^(45/45)=-60*0.5=-30), load(+10) = ~60
# ═══════════════════════════════════════════════════════════════
echo "  HGRS: 1 ZERO 45min atrás (esperado ≈60)"
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"hgrs\",\"situacao\":\"ZERO\",\"caso\":\"Fratura exposta fêmur\",\"mr\":\"Rafaela\",\"medico\":\"Dr. Almeida\",\"oc\":\"8003\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 45)\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 4: Metropolitano — 1 ZERO 90min atrás → score ≈75
# base 80, zero(-60*0.5^(90/45)=-60*0.25=-15), load(+10) = ~75
# ═══════════════════════════════════════════════════════════════
echo "  Metropolitano: 1 ZERO 90min atrás (esperado ≈75)"
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"metropolitano\",\"situacao\":\"ZERO\",\"caso\":\"IAM com supra ST\",\"mr\":\"Karen\",\"medico\":\"Dr. Costa\",\"oc\":\"8004\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 90)\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 5: Subúrbio — 3 ZEROs (5min, 30min, 60min) → score ≈0
# base 80, z1(-60*0.926=-56), z2(-35*0.63=-22), z3(-20*0.40=-8), load(+10) = ~4
# ═══════════════════════════════════════════════════════════════
echo "  Subúrbio: 3 ZEROs (5, 30, 60min) (esperado ≈4)"
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"suburbio\",\"situacao\":\"ZERO\",\"caso\":\"Cetoacidose diabética\",\"mr\":\"Kemylla\",\"medico\":\"Dr. Nunes\",\"oc\":\"8005\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 5)\"}" > /dev/null
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"suburbio\",\"situacao\":\"ZERO\",\"caso\":\"AVC hemorrágico\",\"mr\":\"Karen\",\"medico\":\"Dr. Reis\",\"oc\":\"8006\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 30)\"}" > /dev/null
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"suburbio\",\"situacao\":\"ZERO\",\"caso\":\"Pneumotórax hipertensivo\",\"mr\":\"Mariana\",\"medico\":\"Dr. Lima\",\"oc\":\"8007\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 60)\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 6: Menandro — 1 ACEITO 5min atrás → score com cooldown
# base 80, cooldown(-20*(1-5/40)=-17.5), load(+5, 1 aceito) = ~68
# ═══════════════════════════════════════════════════════════════
echo "  Menandro: 1 ACEITO 5min atrás (esperado ≈68)"
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"menandro\",\"situacao\":\"ACEITO\",\"caso\":\"Pneumotórax espontâneo\",\"mr\":\"Mariana\",\"medico\":\"Dr. Barros\",\"oc\":\"8008\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 5)\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 7: Eládio — 1 ACEITO 60min atrás → sem cooldown
# base 80, cooldown(60>40=0), load(+5) = 85
# ═══════════════════════════════════════════════════════════════
echo "  Eládio: 1 ACEITO 60min atrás (esperado ≈85)"
curl -s -X POST "$API/cases" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"eladio\",\"situacao\":\"ACEITO\",\"caso\":\"Apendicite aguda\",\"mr\":\"Rafaela\",\"medico\":\"Dra. Souza\",\"oc\":\"8009\",\"criadoPor\":\"seed-v3\",\"timestamp\":\"$(ts 60)\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 8: Municipal — intel lotado, 0 ZEROs → score ~60
# base 80, load(+10, 0 aceitos), lotado(-30) = 60
# ═══════════════════════════════════════════════════════════════
echo "  Municipal: intel lotado, 0 ZEROs (esperado ≈60)"
curl -s -X POST "$API/intel" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"municipal\",\"tipo\":\"lotado\",\"nota\":\"Sala vermelha cheia, corredor lotado\",\"autor\":\"seed-v3\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 9: Juliano Moreira — intel aceitando_bem, 0 aceitos → score 100+
# base 80, load(+10), aceitando_bem(+15) = 100 (clamped)
# Mas ele é psiq, fica separado
# ═══════════════════════════════════════════════════════════════
echo "  Juliano Moreira: aceitando_bem + 0 aceitos (esperado 100, clamped)"
curl -s -X POST "$API/intel" \
  -H "Content-Type: application/json" \
  -d "{\"hospitalId\":\"juliano_moreira\",\"tipo\":\"aceitando_bem\",\"nota\":\"Psiquiatra de plantão aceitando tudo\",\"autor\":\"seed-v3\"}" > /dev/null

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 10: Couto Maia — sem dados → score 50
# Nenhum case ou intel para esse hospital
# ═══════════════════════════════════════════════════════════════
echo "  Couto Maia: sem dados (esperado 50)"
# nada a inserir

# ═══════════════════════════════════════════════════════════════
# CENÁRIO 11: Mário Leal — 0 aceitos, nenhuma interação → score 50
# Sem dados → 50
# ═══════════════════════════════════════════════════════════════
echo "  Mário Leal: sem dados (esperado 50)"

echo ""
echo "✅ Seed completo! Cenários inseridos:"
echo ""
echo "  Hospital        │ Cenário                          │ Score v3.1"
echo "  ────────────────┼──────────────────────────────────┼───────────"
echo "  Eládio          │ 1 ACEITO 60min atrás             │ ≈85"
echo "  Menandro        │ 1 ACEITO 5min (cooldown ativo)   │ ≈68"
echo "  Metropolitano   │ 1 ZERO 90min (= 1 half-life)    │ ≈60"
echo "  Municipal       │ Intel lotado recente             │ ≈60"
echo "  HGRS            │ 1 ZERO 45min                     │ ≈48"
echo "  HGESF           │ 1 ZERO 30min                     │ ≈42"
echo "  HGE             │ 1 ZERO 5min (quase sem decay)    │ ≈32"
echo "  Subúrbio        │ 3 ZEROs (5, 30, 60min)           │ ≈0"
echo "  ────────────────┼──────────────────────────────────┼───────────"
echo "  Juliano Moreira │ aceitando_bem (psiq)             │ 100"
echo "  Mário Leal      │ sem dados                        │ 50"
echo "  Couto Maia      │ sem dados                        │ 50"
echo ""
echo "🔄 Acesse http://localhost:5173/tabela/ para ver o resultado"
