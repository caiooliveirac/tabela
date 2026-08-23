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

/** Pontos dos hospitais para o mapa. Config do servidor: não muda sem deploy. */
export function useHospitaisMapa() {
  return useQuery({
    queryKey: ["encaminhamento", "hospitais"],
    queryFn: api.getHospitaisMapa,
    staleTime: Infinity,
  });
}

/**
 * Ranking de destinos, por texto digitado ou por ponto clicado no mapa.
 *
 * O clique ganha do texto quando os dois existem: quem acabou de apontar no
 * mapa está dizendo onde é, e o texto no campo é o da consulta anterior.
 *
 * O texto é debounced; o ponto não. Sem debounce cada tecla viraria uma
 * requisição — mas um clique é uma intenção só, e esperar 300 ms depois dele
 * seria latência inventada.
 */
export function useEncaminhamento(
  local: string,
  perfil: string,
  ponto: { lat: number; lng: number } | null,
) {
  const [localDebounced, setLocalDebounced] = useState(local);

  useEffect(() => {
    const t = setTimeout(() => setLocalDebounced(local), 300);
    return () => clearTimeout(t);
  }, [local]);

  const texto = localDebounced.trim();
  const temPerfil = perfil.length > 0;

  return useQuery({
    queryKey: ponto
      ? ["encaminhamento", "ponto", ponto.lat, ponto.lng, perfil]
      : ["encaminhamento", "texto", texto, perfil],
    queryFn: () =>
      ponto
        ? api.getEncaminhamentoPorPonto(ponto.lat, ponto.lng, perfil)
        : api.getEncaminhamento(texto, perfil),
    enabled: temPerfil && (ponto !== null || texto.length >= 3),
    // A resposta é determinística: mesma origem + mesmo perfil dá o mesmo
    // resultado até alguém fazer deploy. Não há o que reconsultar.
    staleTime: 5 * 60_000,
  });
}
