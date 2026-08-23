#!/usr/bin/env python3
"""
Regera api/src/data/locais-salvador.json — a distância materializada de cada
lugar de Salvador até cada hospital do módulo de encaminhamento.

Roda FORA do ar, no Mac, e é a única coisa neste projeto que gasta cota da API
do Google. O resultado é committado; em plantão o servidor lê do próprio banco
e nunca chama o Google.

    python3 scripts/gerar-locais.py            # usa .env.production-copy
    GOOGLE_MAPS_API_KEY=... python3 scripts/gerar-locais.py

"Lugar" é mais que bairro. Salvador tem largo, estação, terminal, rótula e
apelido — e é isso que a regulação diz no telefone, não a divisão oficial.

Três fontes, cada uma no que é boa:

  1. OpenStreetMap, categorias geográficas (CATEGORIAS abaixo). Grátis, sem
     chave, e confiável em bairro/largo/estação. NÃO usamos as categorias
     comerciais do OSM: shop=mall traz estação de rádio, amenity=marketplace
     traz mercadinho, landuse=residential traz 505 prédios. Volume sem
     curadoria não é cobertura, é ambiguidade de busca.
  2. REFERENCIAS: pontos que o OSM não dá em qualidade, geocodificados no
     Google um a um e conferidos pelo endereço devolvido.
  3. APELIDOS: como as pessoas chamam, apontando para a chave do lugar real.
     Não custa rota nenhuma — é só outro nome para o mesmo ponto.

Duas guardas contra coordenada inventada, aprendidas na primeira rodada:
  • endereço devolvido que começa com "Salvador" é o "não achei" do geocoder
    (foi assim que "Rótula do Shopping" virou o centroide da cidade);
  • referência imprecisa que cai a menos de 400 m de um lugar que já temos
    vira apelido dele, não ponto novo com coordenada própria.
"""
import json
import math
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
DESTINO = RAIZ / "api/src/data/locais-salvador.json"

# Mesma lista e mesmas coordenadas de api/src/services/encaminhamento.ts.
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

# Categoria do OSM -> tipo que o painel exibe. O que não está aqui fica fora.
CATEGORIAS = {
    "place=suburb": "bairro", "place=quarter": "bairro", "place=neighbourhood": "bairro",
    "place=locality": "localidade", "place=hamlet": "localidade", "place=village": "localidade",
    "place=farm": "localidade", "place=island": "ilha", "place=islet": "ilha",
    "place=square": "largo", "amenity=bus_station": "terminal",
    "amenity=ferry_terminal": "terminal", "public_transport=station": "estacao",
    "railway=station": "estacao", "aeroway=aerodrome": "referencia",
    "leisure=stadium": "referencia",
}

# Pontos de referência ausentes ou mal mapeados no OSM. Geocodificados no
# Google e conferidos pelo endereço devolvido.
REFERENCIAS = [
    "Shopping da Bahia", "Salvador Shopping", "Shopping Barra", "Shopping Bela Vista",
    "Estádio de Pituaçu", "Elevador Lacerda", "Mercado Modelo", "Feira de São Joaquim",
    "Parque da Cidade", "Rótula do Abacaxi", "Largo do Tanque", "Baixa dos Sapateiros",
    "Praça da Sé", "Praça Castro Alves", "Terminal Náutico", "Farol da Barra",
    "Dique do Tororó", "Vale do Canela", "Politeama", "Barra Avenida",
]

# Apelido -> chave do lugar real. Acrescentar aqui é de graça: nenhuma chamada
# de API, nenhuma linha nova de rota.
APELIDOS = {
    "iguatemi": "shopping da bahia",
    "shopping iguatemi": "shopping da bahia",
    "cab": "centro administrativo da bahia",
    "fonte nova": "arena fonte nova",
    "abacaxi": "rotula do abacaxi",
}


# Nomes que existem no OSM mas destruiriam a busca por conteúdo: "salvador"
# aparece no fim de quase todo endereço digitado e, pela regra do nome mais
# longo, venceria a Pituba; "largo" é palavra genérica, não lugar.
GENERICOS = {"salvador", "largo"}

# Nome de patrocinador muda de contrato em contrato e não é como se fala no
# rádio. O OSM registra o nome comercial; o painel mostra o nome de uso.
RENOMEAR = {"Casa de Apostas Arena Fonte Nova": "Arena Fonte Nova"}


def chave(nome: str) -> str:
    """Mesma normalização de normalizar() em services/locais.ts."""
    s = unicodedata.normalize("NFD", nome)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


def metros(a, b) -> float:
    return math.hypot((a[0] - b[0]) * 111000,
                      (a[1] - b[1]) * 111000 * math.cos(math.radians(a[0])))


def raizes() -> list:
    """Raiz deste checkout e, se for um worktree, a do repo principal — que é
    onde o .env mora. `.git` como ARQUIVO é o sinal de worktree."""
    saida = [RAIZ]
    marca = RAIZ / ".git"
    if marca.is_file():
        gitdir = marca.read_text().partition("gitdir:")[2].strip()
        if gitdir:
            # .../<repo>/.git/worktrees/<nome> -> <repo>
            saida.append(pathlib.Path(gitdir).resolve().parent.parent.parent)
    return saida


def ler_chave() -> str:
    if os.environ.get("GOOGLE_MAPS_API_KEY"):
        return os.environ["GOOGLE_MAPS_API_KEY"].strip()
    for raiz in raizes():
        for nome in (".env.production-copy", ".env"):
            f = raiz / nome
            if not f.exists():
                continue
            for linha in f.read_text().splitlines():
                if linha.startswith("GOOGLE_MAPS_API_KEY="):
                    return linha.partition("=")[2].strip().strip("\"'")
    sys.exit("GOOGLE_MAPS_API_KEY não encontrada (env, .env.production-copy ou .env)")


def do_osm() -> dict:
    consulta = """
    [out:json][timeout:180];
    area["name"="Salvador"]["admin_level"="8"]["boundary"="administrative"]->.a;
    (
      nwr["place"](area.a);
      nwr["amenity"~"^(bus_station|ferry_terminal)$"]["name"](area.a);
      nwr["public_transport"="station"]["name"](area.a);
      nwr["railway"="station"]["name"](area.a);
      nwr["aeroway"="aerodrome"]["name"](area.a);
      nwr["leisure"="stadium"]["name"](area.a);
    );
    out center tags;
    """
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": consulta}).encode(),
        headers={"User-Agent": "tabela-samu/1.0"},
    )
    # O Overpass público devolve 429/504 quando está congestionado. É de graça:
    # a contrapartida é esperar e tentar de novo, não desistir.
    for tentativa in range(5):
        try:
            dados = json.load(urllib.request.urlopen(req, timeout=240))
            break
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            codigo = getattr(e, "code", type(e).__name__)
            if tentativa == 4:
                sys.exit(f"Overpass indisponível após 5 tentativas ({codigo})")
            espera = 15 * (tentativa + 1)
            print(f"  Overpass {codigo}; nova tentativa em {espera}s", file=sys.stderr)
            time.sleep(espera)
    achados = {}
    for el in dados["elements"]:
        tg = el.get("tags", {})
        nome = tg.get("name")
        nome = RENOMEAR.get(nome, nome)
        centro = el if "lat" in el else el.get("center")
        if not nome or not centro:
            continue
        cat = next((f"{k}={tg[k]}" for k in
                    ("place", "amenity", "public_transport", "railway", "aeroway", "leisure")
                    if k in tg), None)
        tipo = CATEGORIAS.get(cat)
        k = chave(nome)
        # Chave curta demais ("Largo", "Box 1") casaria com meio endereço.
        if tipo and len(k) >= 4 and k not in GENERICOS and k not in achados:
            achados[k] = {"nome": nome, "key": k, "tipo": tipo,
                          "lat": round(centro["lat"], 6), "lng": round(centro["lon"], 6)}
    return achados


def do_google(key: str, ja_temos: dict) -> tuple:
    novos, apelidos = {}, {}
    for nome in REFERENCIAS:
        k = chave(nome)
        if k in ja_temos:
            continue
        url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(
            {"address": f"{nome}, Salvador, BA", "region": "br", "key": key})
        r = json.load(urllib.request.urlopen(url, timeout=20))
        if r.get("status") != "OK":
            print(f"  [pulado] {nome}: {r.get('status')}", file=sys.stderr)
            continue
        t = r["results"][0]
        loc, addr = t["geometry"]["location"], t["formatted_address"]
        if "Salvador" not in addr or addr.startswith("Salvador"):
            print(f"  [pulado] {nome}: geocoder devolveu resposta genérica", file=sys.stderr)
            continue
        ponto = (loc["lat"], loc["lng"])
        if t["geometry"]["location_type"] == "APPROXIMATE":
            perto = min(ja_temos.values(), key=lambda x: metros(ponto, (x["lat"], x["lng"])))
            d = metros(ponto, (perto["lat"], perto["lng"]))
            if d < 400:
                apelidos[k] = perto["key"]
                print(f"  [apelido] {nome} -> {perto['nome']} ({d:.0f} m)", file=sys.stderr)
            else:
                print(f"  [pulado] {nome}: impreciso, {d:.0f} m do vizinho", file=sys.stderr)
            continue
        novos[k] = {"nome": nome, "key": k, "tipo": "referencia",
                    "lat": round(loc["lat"], 6), "lng": round(loc["lng"], 6)}
        time.sleep(0.15)
    return novos, apelidos


def matriz(key: str, locais: list) -> tuple:
    hids = list(HOSPITAIS)
    ponto = lambda la, ln: {"waypoint": {"location": {"latLng": {"latitude": la, "longitude": ln}}}}
    rotas, sem_rota = {}, 0
    for i in range(0, len(locais), LOTE):
        parte = locais[i:i + LOTE]
        corpo = {
            "origins": [ponto(l["lat"], l["lng"]) for l in parte],
            "destinations": [ponto(*HOSPITAIS[h]) for h in hids],
            "travelMode": "DRIVE",
        }
        req = urllib.request.Request(
            "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
            data=json.dumps(corpo).encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                     "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition"},
        )
        try:
            resposta = json.load(urllib.request.urlopen(req, timeout=180))
        except urllib.error.HTTPError as e:
            sys.exit(f"Routes API HTTP {e.code}: {json.load(e).get('error', {}).get('message', '')[:300]}")
        for r in resposta:
            k = parte[r.get("originIndex", 0)]["key"]
            hid = hids[r.get("destinationIndex", 0)]
            if r.get("condition") != "ROUTE_EXISTS":
                sem_rota += 1
                continue
            rotas.setdefault(k, {})[hid] = [int(r["duration"].rstrip("s")), r["distanceMeters"]]
        print(f"  lote {i // LOTE + 1}: {len(parte)} lugares", file=sys.stderr)
        time.sleep(1)
    return rotas, sem_rota


def main() -> None:
    key = ler_chave()
    print("OpenStreetMap…", file=sys.stderr)
    locais = do_osm()
    print(f"  {len(locais)} lugares", file=sys.stderr)

    print("Google, referências curadas…", file=sys.stderr)
    novos, apelidos_auto = do_google(key, locais)
    locais.update(novos)
    print(f"  +{len(novos)} referências, +{len(apelidos_auto)} apelidos automáticos", file=sys.stderr)

    apelidos = {**apelidos_auto, **APELIDOS}
    orfaos = {a: d for a, d in apelidos.items() if d not in locais}
    if orfaos:
        sys.exit(f"Apelidos apontando para lugar inexistente: {orfaos}")
    colididos = set(apelidos) & set(locais)
    if colididos:
        sys.exit(f"Apelido com o mesmo nome de um lugar real: {colididos}")

    print("Matriz de rotas…", file=sys.stderr)
    ordenados = sorted(locais.values(), key=lambda l: l["key"])
    rotas, sem_rota = matriz(key, ordenados)

    saida = []
    for l in ordenados:
        r = rotas.get(l["key"], {})
        item = dict(l)
        if len(r) == len(HOSPITAIS):
            item["rotas"] = {h: r[h] for h in HOSPITAIS}
        else:
            item["semRotaRodoviaria"] = True
        saida.append(item)

    hoje = time.strftime("%Y-%m-%d")
    DESTINO.write_text(json.dumps({
        "_": f"Gerado por scripts/gerar-locais.py em {hoje}. Geografia do "
             "OpenStreetMap; referências e tempos do Google. Não editar à mão.",
        "geradoEm": hoje,
        "hospitais": list(HOSPITAIS),
        "formatoRota": "[segundos, metros]",
        "apelidos": dict(sorted(apelidos.items())),
        "locais": saida,
    }, ensure_ascii=False, indent=0) + "\n")

    ilhados = [l["nome"] for l in saida if l.get("semRotaRodoviaria")]
    print(f"\n{DESTINO.relative_to(RAIZ)}: {len(saida)} lugares, {len(apelidos)} apelidos", file=sys.stderr)
    print(f"sem rota rodoviária ({len(ilhados)}): {', '.join(ilhados) or 'nenhum'}", file=sys.stderr)
    if sem_rota:
        print(f"elementos sem rota: {sem_rota}", file=sys.stderr)


if __name__ == "__main__":
    main()
