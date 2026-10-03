import Dashboard from "./components/Dashboard";
import FrotaApp from "./components/frota/FrotaApp";

// /tabela/frota é a Frota sozinha (card próprio no portal, o que o
// rádio-operador abre); qualquer outro endereço é o Painel de Vagas.
const soFrota = window.location.pathname.replace(/\/+$/, "") === `${import.meta.env.BASE_URL}frota`;

export default function App() {
  return soFrota ? <FrotaApp /> : <Dashboard />;
}
