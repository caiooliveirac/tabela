import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Lista de perfis clínicos. É config versionada no servidor: só muda com
 * deploy, então não precisa refetch.
 */
export function usePerfisEncaminhamento() {
  return useQuery({
    queryKey: ["encaminhamento", "perfis"],
    queryFn: api.getPerfisEncaminhamento,
    staleTime: Infinity,
  });
}

/**
 * Ranking de destinos. O texto do local é debounced: sem isso cada tecla
 * digitada viraria uma requisição, e o regulador digita "Pituba" em 6 teclas.
 */
export function useEncaminhamento(local: string, perfil: string) {
  const [localDebounced, setLocalDebounced] = useState(local);

  useEffect(() => {
    const t = setTimeout(() => setLocalDebounced(local), 300);
    return () => clearTimeout(t);
  }, [local]);

  const pronto = localDebounced.trim().length >= 3 && perfil.length > 0;

  return useQuery({
    queryKey: ["encaminhamento", localDebounced.trim(), perfil],
    queryFn: () => api.getEncaminhamento(localDebounced.trim(), perfil),
    enabled: pronto,
    // A resposta é determinística: mesmo bairro + mesmo perfil dá o mesmo
    // resultado até alguém fazer deploy. Não há o que reconsultar.
    staleTime: 5 * 60_000,
  });
}
