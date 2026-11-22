import Dashboard from "./components/Dashboard";
import FrotaApp from "./components/frota/FrotaApp";
import GiroApp from "./components/GiroApp";
import RetencaoApp from "./components/frota/retencao/RetencaoApp";

// /tabela/frota é a Frota sozinha (card próprio no portal, o que o
// rádio-operador abre); /tabela/giro, o Giro das UPAs sozinho (conta de
// gestão UPA); /tabela/retencao, a análise de retenção (só chefia e admin:
// o porteiro barra os dados); qualquer outro endereço é o Painel de Vagas.
const pagina = window.location.pathname.replace(/\/+$/, "").slice(import.meta.env.BASE_URL.length);

export default function App() {
  if (pagina === "frota") return <FrotaApp />;
  if (pagina === "giro") return <GiroApp />;
  if (pagina === "retencao") return <RetencaoApp />;
  return <Dashboard />;
}
