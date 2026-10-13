#!/usr/bin/env bash
# Move para o HGRS as paradas gravadas como upa_cabula cujo GPS ficou a até 40 m
# de uma porta do HGRS (PORTAS.hgrs em api/src/frota/hospitais.ts).
# Roda do Mac/qualquer aparelho no tailnet:
#   scripts/corrigir-cabula-hgrs.sh           # só mostra o que mudaria
#   scripts/corrigir-cabula-hgrs.sh aplicar   # faz o UPDATE (transação) e mostra o resultado
# Escrita manual no banco: só depois do deploy de 13/10/2026 (6f456b1) e com aval do Caio.
set -euo pipefail
PSQL=(ssh magalu docker exec -i tabela-db-1 psql -U tabela -d tabela -v ON_ERROR_STOP=1)

CANDIDATAS="
SELECT p.id FROM frota_permanencias p
JOIN (VALUES (-12.95609::float8, -38.45056::float8), (-12.95604, -38.45115)) AS porta(lat, lng)
  ON 6371000 * 2 * asin(sqrt(
       power(sin(radians(COALESCE(p.estavel_lat, p.lat) - porta.lat) / 2), 2) +
       cos(radians(porta.lat)) * cos(radians(COALESCE(p.estavel_lat, p.lat))) *
       power(sin(radians(COALESCE(p.estavel_lng, p.lng) - porta.lng) / 2), 2))) <= 40
WHERE p.hospital_id = 'upa_cabula' AND NOT p.na_base AND COALESCE(p.estavel_lat, p.lat) IS NOT NULL"

echo "== Candidatas (por dia): upa_cabula -> hgrs =="
"${PSQL[@]}" -c "SELECT to_char(entrada AT TIME ZONE 'America/Bahia','YYYY-MM-DD') AS dia, count(*) AS paradas,
  count(DISTINCT chave) AS viaturas, count(*) FILTER (WHERE saida IS NULL) AS abertas
  FROM frota_permanencias WHERE id IN ($CANDIDATAS) GROUP BY 1 ORDER BY 1"
echo "== Total na upa_cabula (para comparar) =="
"${PSQL[@]}" -c "SELECT count(*) AS total_upa_cabula, count(*) FILTER (WHERE id IN ($CANDIDATAS)) AS candidatas FROM frota_permanencias WHERE hospital_id='upa_cabula'"

if [ "${1:-}" = "aplicar" ]; then
  echo "== Aplicando =="
  "${PSQL[@]}" -c "BEGIN; UPDATE frota_permanencias SET hospital_id='hgrs' WHERE id IN ($CANDIDATAS); COMMIT;"
  "${PSQL[@]}" -c "SELECT hospital_id, count(*) FROM frota_permanencias WHERE hospital_id IN ('upa_cabula','hgrs') GROUP BY 1"
else
  echo "(nada foi alterado; rode com 'aplicar' depois de conferir)"
fi
