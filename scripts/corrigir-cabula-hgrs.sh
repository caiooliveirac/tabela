#!/usr/bin/env bash
# Move para o HGRS as paradas gravadas como upa_cabula cujo GPS ficou mais
# perto do HGRS (pino ou porta, até 150 m) que do pino da UPA Cabula — a mesma
# regra da parada ao vivo (distanciaLocal em api/src/frota/regras.ts).
# Roda do Mac/qualquer aparelho no tailnet:
#   scripts/corrigir-cabula-hgrs.sh           # só mostra o que mudaria
#   scripts/corrigir-cabula-hgrs.sh aplicar   # faz o UPDATE (transação) e mostra o resultado
# Escrita manual no banco: só com aval do Caio.
set -euo pipefail
# O SQL vai pela entrada padrão: o ssh remonta os argumentos e quebraria as aspas.
PSQL=(ssh magalu docker exec -i tabela-db-1 psql -U tabela -d tabela -v ON_ERROR_STOP=1)

DIST="6371000 * 2 * asin(sqrt(power(sin(radians(q.la - l.lat) / 2), 2) +
  cos(radians(l.lat)) * cos(radians(q.la)) * power(sin(radians(q.ln - l.lng) / 2), 2)))"
CANDIDATAS="
SELECT q.id FROM (SELECT id, COALESCE(estavel_lat, lat) AS la, COALESCE(estavel_lng, lng) AS ln
                  FROM frota_permanencias WHERE hospital_id = 'upa_cabula' AND NOT na_base) q
JOIN (VALUES ('hgrs', -12.955444::float8, -38.450595::float8), ('hgrs', -12.95609, -38.45056),
             ('hgrs', -12.95604, -38.45115), ('upa', -12.957341, -38.4514592)) AS l(dono, lat, lng) ON q.la IS NOT NULL
GROUP BY q.id
HAVING min($DIST) FILTER (WHERE l.dono = 'hgrs') <= 150
   AND min($DIST) FILTER (WHERE l.dono = 'hgrs') < min($DIST) FILTER (WHERE l.dono = 'upa')"

echo "== Candidatas (por dia): upa_cabula -> hgrs =="
"${PSQL[@]}" <<<"SELECT to_char(entrada AT TIME ZONE 'America/Bahia','YYYY-MM-DD') AS dia, count(*) AS paradas,
  count(DISTINCT chave) AS viaturas, count(*) FILTER (WHERE saida IS NULL) AS abertas
  FROM frota_permanencias WHERE id IN ($CANDIDATAS) GROUP BY 1 ORDER BY 1"
echo "== Total na upa_cabula (para comparar) =="
"${PSQL[@]}" <<<"SELECT count(*) AS total_upa_cabula, count(*) FILTER (WHERE id IN ($CANDIDATAS)) AS candidatas FROM frota_permanencias WHERE hospital_id='upa_cabula'"

if [ "${1:-}" = "aplicar" ]; then
  echo "== Aplicando =="
  "${PSQL[@]}" <<<"BEGIN; UPDATE frota_permanencias SET hospital_id='hgrs' WHERE id IN ($CANDIDATAS); COMMIT;"
  "${PSQL[@]}" <<<"SELECT hospital_id, count(*) FROM frota_permanencias WHERE hospital_id IN ('upa_cabula','hgrs') GROUP BY 1"
else
  echo "(nada foi alterado; rode com 'aplicar' depois de conferir)"
fi
