#!/usr/bin/env python3
"""
Regera api/src/data/bairros-salvador.json — a distância materializada de cada
bairro de Salvador até cada hospital do módulo de encaminhamento.

Roda FORA do ar, no Mac, e é a única coisa neste projeto que gasta cota da API
do Google. O resultado é committado; em plantão o servidor lê do próprio banco
e nunca chama o Google.

    python3 scripts/gerar-bairros.py            # usa .env.production-copy
    GOOGLE_MAPS_API_KEY=... python3 scripts/gerar-bairros.py

Duas fontes, de propósito:
  • nomes e centroides dos bairros → OpenStreetMap (grátis, sem chave)
  • tempo de carro → Routes API do Google

Custo: 183 bairros x 7 hospitais = 1281 elementos de matriz, em 3 requisições.

As ilhas da Baía de Todos os Santos (Maré, Frades, Bom Jesus dos Passos) saem
sem rota: não existe estrada. Ficam no arquivo marcadas com
semRotaRodoviaria, para o módulo poder explicar em vez de devolver vazio.
"""
import json
import os
import pathlib
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "api/src/data/bairros-salvador.json"

# Mesma lista e mesmas coordenadas de api/src/services/encaminhamento.ts.
# Mudou hospital lá? Muda aqui e regera — senão o seed fica com um destino a
# menos e o teste de integridade acusa.
HOSPITAIS = {
    "hge": (-12.995065, -38.488655),
    "hgrs": (-12.955444, -38.450595),
    "hgesf": (-12.958674, -38.486511),
    "metropolitano": (-12.853579, -38.349695),
    "suburbio": (-12.864858, -38.456783),
    "eladio": (-12.888254, -38.422068),
    "municipal": (-12.897967, -38.390374),
}
LOTE = 85  # 85 origens x 7 destinos = 595 elementos, sob o teto de 625


def chave(nome: str) -> str:
    """Mesma normalização de normalizar() em services/bairros.ts."""
    s = unicodedata.normalize("NFD", nome)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


def ler_chave() -> str:
    if os.environ.get("GOOGLE_MAPS_API_KEY"):
        return os.environ["GOOGLE_MAPS_API_KEY"].strip()
    for nome in (".env.production-copy", ".env"):
        f = RAIZ.parent / nome
        if not f.exists():
            continue
        for linha in f.read_text().splitlines():
            if linha.startswith("GOOGLE_MAPS_API_KEY="):
                return linha.partition("=")[2].strip().strip("\"'")
    sys.exit("GOOGLE_MAPS_API_KEY não encontrada (env ou .env.production-copy)")


def bairros_do_osm() -> dict:
    consulta = """
    [out:json][timeout:120];
    area["name"="Salvador"]["admin_level"="8"]["boundary"="administrative"]->.a;
    (
      node["place"~"^(suburb|neighbourhood|quarter)$"](area.a);
      way["place"~"^(suburb|neighbourhood|quarter)$"](area.a);
      relation["place"~"^(suburb|neighbourhood|quarter)$"](area.a);
    );
    out center tags;
    """
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": consulta}).encode(),
        headers={"User-Agent": "tabela-samu/1.0"},
    )
    dados = json.load(urllib.request.urlopen(req, timeout=180))
    achados = {}
    for el in dados["elements"]:
        nome = el.get("tags", {}).get("name")
        centro = el if "lat" in el else el.get("center")
        if nome and centro:
            achados.setdefault(nome, (centro["lat"], centro["lon"]))
    return achados


def matriz(key: str, nomes: list, coords: dict) -> tuple:
    hids = list(HOSPITAIS)
    ponto = lambda la, ln: {"waypoint": {"location": {"latLng": {"latitude": la, "longitude": ln}}}}
    rotas, sem_rota = {}, []
    for i in range(0, len(nomes), LOTE):
        parte = nomes[i : i + LOTE]
        corpo = {
            "origins": [ponto(*coords[n]) for n in parte],
            "destinations": [ponto(*HOSPITAIS[h]) for h in hids],
            "travelMode": "DRIVE",
        }
        req = urllib.request.Request(
            "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
            data=json.dumps(corpo).encode(),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
            },
        )
        try:
            resposta = json.load(urllib.request.urlopen(req, timeout=120))
        except urllib.error.HTTPError as e:
            sys.exit(f"Routes API HTTP {e.code}: {json.load(e).get('error', {}).get('message', '')[:300]}")
        for r in resposta:
            nome, hid = parte[r.get("originIndex", 0)], hids[r.get("destinationIndex", 0)]
            if r.get("condition") != "ROUTE_EXISTS":
                sem_rota.append((nome, hid))
                continue
            rotas.setdefault(nome, {})[hid] = [int(r["duration"].rstrip("s")), r["distanceMeters"]]
        print(f"  lote {i // LOTE + 1}: {len(parte)} bairros", file=sys.stderr)
        time.sleep(1)
    return rotas, sem_rota


def main() -> None:
    key = ler_chave()
    print("Buscando bairros no OpenStreetMap…", file=sys.stderr)
    coords = bairros_do_osm()
    nomes = sorted(coords)
    print(f"  {len(nomes)} bairros", file=sys.stderr)

    duplicadas = {}
    for n in nomes:
        duplicadas.setdefault(chave(n), []).append(n)
    if any(len(v) > 1 for v in duplicadas.values()):
        sys.exit(f"Chaves colidindo: {[v for v in duplicadas.values() if len(v) > 1]}")

    print("Calculando a matriz de rotas…", file=sys.stderr)
    rotas, sem_rota = matriz(key, nomes, coords)

    bairros = []
    for n in nomes:
        b = {"nome": n, "key": chave(n), "lat": round(coords[n][0], 6), "lng": round(coords[n][1], 6)}
        if len(rotas.get(n, {})) == len(HOSPITAIS):
            b["rotas"] = {h: rotas[n][h] for h in HOSPITAIS}
        else:
            b["semRotaRodoviaria"] = True
        bairros.append(b)

    hoje = time.strftime("%Y-%m-%d")
    DESTINO.write_text(
        json.dumps(
            {
                "_": f"Gerado por scripts/gerar-bairros.py em {hoje}. Bairros do "
                     "OpenStreetMap; tempos da Routes API do Google. Não editar à mão.",
                "geradoEm": hoje,
                "hospitais": list(HOSPITAIS),
                "formatoRota": "[segundos, metros]",
                "bairros": bairros,
            },
            ensure_ascii=False,
            indent=0,
        )
        + "\n"
    )
    ilhas = [b["nome"] for b in bairros if b.get("semRotaRodoviaria")]
    print(f"\n{DESTINO.relative_to(RAIZ)}: {len(bairros)} bairros", file=sys.stderr)
    print(f"sem rota rodoviária ({len(ilhas)}): {', '.join(ilhas) or 'nenhum'}", file=sys.stderr)
    if sem_rota:
        print(f"elementos sem rota: {len(sem_rota)}", file=sys.stderr)


if __name__ == "__main__":
    main()
