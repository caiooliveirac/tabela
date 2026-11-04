import Dashboard from "./components/Dashboard";
import FrotaApp from "./components/frota/FrotaApp";
import GiroApp from "./components/GiroApp";

// /tabela/frota é a Frota sozinha (card próprio no portal, o que o
// rádio-operador abre); /tabela/giro, o Giro das UPAs sozinho (conta de
// gestão UPA); qualquer outro endereço é o Painel de Vagas.
const pagina = window.location.pathname.replace(/\/+$/, "").slice(import.meta.env.BASE_URL.length);

export default function App() {
  return pagina === "frota" ? <FrotaApp /> : pagina === "giro" ? <GiroApp /> : <Dashboard />;
}
