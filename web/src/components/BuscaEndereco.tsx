// ═══════════════════════════════════════════════════════════════
// Campo "Onde é a ocorrência" — texto livre + endereços do Google.
//
// O índice local de lugares continua sendo o primeiro caminho: bairro, largo e
// apelido resolvem no servidor sem custo e sem rede externa. O que o Google
// acrescenta é o que o índice decidiu não guardar: a RUA do paciente e o ponto
// de referência comercial ("mercadinho do seu Zé"). Escolher uma sugestão vira
// coordenada, e a coordenada entra no MESMO fluxo do clique no mapa — encaixe
// no lugar conhecido mais próximo, rota materializada, aviso do tamanho da
// aproximação.
//
// Sem chave (LAB sem env, Google fora do ar) o campo é o input de sempre:
// digitar continua buscando no índice do servidor.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { garantirGoogleMaps } from "../lib/googleMaps";

// Mesma caixa da RMS que o servidor aceita — sugerir endereço de fora dela é
// sugerir algo que a API vai recusar.
const CAIXA_RMS = { south: -13.2, west: -38.8, north: -12.6, east: -38.2 };

interface Sugestao {
  id: string;
  principal: string;
  detalhe: string;
  prediction: google.maps.places.PlacePrediction;
}

interface Props {
  valor: string;
  mapsKey: string | null;
  onDigitar: (texto: string) => void;
  onEscolherEndereco: (lat: number, lng: number, rotulo: string) => void;
}

export default function BuscaEndereco({ valor, mapsKey, onDigitar, onEscolherEndereco }: Props) {
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [aberto, setAberto] = useState(false);
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const ultimoPedido = useRef(0);
  // Escolher põe o rótulo no campo; sem esta marca, o effect trataria o
  // próprio rótulo como digitação nova e abriria outra sessão no Google.
  const ultimoEscolhido = useRef<string | null>(null);

  useEffect(() => {
    // O servidor já busca no índice com este mesmo texto em paralelo; aqui é
    // só a camada Google, e só quando há chave e texto que pareça endereço.
    if (!mapsKey || valor.trim().length < 4 || valor === ultimoEscolhido.current) {
      setSugestoes([]);
      return;
    }
    const pedido = ++ultimoPedido.current;
    const t = setTimeout(async () => {
      try {
        await garantirGoogleMaps(mapsKey);
        const { AutocompleteSessionToken, AutocompleteSuggestion } =
          (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
        // Token de sessão agrupa as teclas + o detalhe final numa cobrança só.
        token.current ??= new AutocompleteSessionToken();
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: valor.trim(),
          sessionToken: token.current,
          locationRestriction: CAIXA_RMS,
          includedRegionCodes: ["br"],
          language: "pt-BR",
          region: "br",
        });
        // Resposta velha depois da nova: descarta em vez de piscar errado.
        if (pedido !== ultimoPedido.current) return;
        setSugestoes(
          suggestions
            .flatMap((s) => (s.placePrediction ? [s.placePrediction] : []))
            .slice(0, 5)
            .map((p) => ({
              id: p.placeId,
              principal: p.mainText?.toString() ?? p.text.toString(),
              detalhe: p.secondaryText?.toString() ?? "",
              prediction: p,
            })),
        );
      } catch (e) {
        // Autocomplete indisponível não é erro do plantão: o índice local segue.
        console.warn("[busca] sugestões do Google indisponíveis:", e);
        if (pedido === ultimoPedido.current) setSugestoes([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [valor, mapsKey]);

  const escolher = async (s: Sugestao) => {
    setAberto(false);
    setSugestoes([]);
    ultimoPedido.current++; // descarta qualquer resposta em voo
    ultimoEscolhido.current = s.principal;
    try {
      const place = s.prediction.toPlace();
      // fetchFields fecha a sessão de cobrança do token.
      await place.fetchFields({ fields: ["location"] });
      token.current = null;
      const loc = place.location;
      if (loc) onEscolherEndereco(loc.lat(), loc.lng(), s.principal);
    } catch (e) {
      console.warn("[busca] detalhe do endereço falhou:", e);
    }
  };

  const mostrar = aberto && sugestoes.length > 0;

  return (
    <div className="relative">
      <label className="block text-[11px] font-bold text-slate-500 mb-1">
        Onde é a ocorrência
      </label>
      <input
        value={valor}
        onChange={(e) => {
          onDigitar(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        // mousedown das sugestões dispara antes do blur; o timeout cobre
        // leitores de tela e toque, onde a ordem não é garantida.
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder={
          mapsKey
            ? "Bairro, rua, referência ou apelido"
            : "Bairro, largo, estação, apelido ou endereço"
        }
        className="w-full py-2 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-blue-600"
      />
      {mostrar && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20">
          {sugestoes.map((s) => (
            <button
              key={s.id}
              // mousedown em vez de click: ganha do blur do input.
              onMouseDown={(e) => {
                e.preventDefault();
                void escolher(s);
              }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-b-0 bg-white"
            >
              <div className="text-[13px] font-bold text-slate-800">📍 {s.principal}</div>
              {s.detalhe && <div className="text-[11px] text-slate-500">{s.detalhe}</div>}
            </button>
          ))}
          <div className="px-3 py-1 text-[10px] text-slate-400 bg-slate-50 text-right">
            sugestões do Google
          </div>
        </div>
      )}
    </div>
  );
}
