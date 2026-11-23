import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { DesativarViaturaPayload, ViaturaFrota } from "../lib/types";

/**
 * Painel da frota. O servidor coleta do SAMU+ a cada 2 min; aqui basta olhar
 * a cada 30 s. Roda em todas as abas: o aviso de 40 min não pode depender de
 * alguém estar na aba Frota.
 */
export function useFrota() {
  return useQuery({
    queryKey: ["frota"],
    queryFn: api.getFrota,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

/** Desativar/reativar no painel: o painel se atualiza na hora (não espera os 30 s). */
export function useDesativarViatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: DesativarViaturaPayload) => api.desativarViatura(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["frota"] }),
  });
}

export function useInformarMotivoViatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Pick<DesativarViaturaPayload, "motivos" | "observacao" | "informadoPor">) =>
      api.informarMotivoViatura(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["frota"] }),
  });
}

export function useReativarViatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reativadaPor }: { id: number; reativadaPor: string }) => api.reativarViatura(id, reativadaPor),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["frota"] }),
  });
}

/** Detalhe de uma viatura (modal): ocorrência, parada, rastro e linha do tempo. Atualiza junto com a coleta. */
/** `horas`: o seletor do modal voltando no rastro (null = janela padrão do servidor). */
export function useDetalheViatura(chave: string | null, horas: number | null = null) {
  return useQuery({
    queryKey: ["frota", "viatura", chave, horas],
    queryFn: () => api.getDetalheViatura(chave!, horas),
    enabled: chave !== null,
    refetchInterval: 30_000,
    // Mexer no seletor mantém o rastro na tela até o novo chegar (só da mesma viatura).
    placeholderData: (anterior, consulta) => (consulta?.queryKey[2] === chave ? anterior : undefined),
  });
}

/** Paradas em hospital das últimas `horas`, para a linha do tempo. */
export function useLinhaDoTempoFrota(horas: number) {
  return useQuery({
    queryKey: ["frota", "linha-do-tempo", horas],
    queryFn: () => api.getLinhaDoTempoFrota(horas),
    refetchInterval: 60_000,
  });
}

const CHAVE_CIENTE = "tabela:frota-ciente";

function lerCientes(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CIENTE) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Uma permanência = uma viatura num hospital desde uma hora de entrada. */
export const chaveAlerta = (v: ViaturaFrota) => `${v.chave}|${v.noHospital?.entrada ?? ""}`;
/** Uma saída da cerca = a parada de onde saiu. */
export const chaveFora = (v: ViaturaFrota) => `${v.chave}|fora|${v.foraDaCerca?.paradaId ?? ""}`;

/**
 * Viaturas com 40 min ou mais num hospital, e as que saíram da cerca com o
 * status ainda de "chegada ao hospital" há `foraCercaMin` ou mais. "Ciente"
 * vale para ESTA parada, neste navegador: se a viatura sair e voltar, é outra
 * parada e avisa de novo.
 */
export function useAlertasFrota(viaturas: ViaturaFrota[] | undefined, foraCercaMin = 15) {
  const [cientes, setCientes] = useState<string[]>(lerCientes);
  const alertas = useMemo(
    () =>
      (viaturas ?? [])
        .filter((v) => v.noHospital?.alerta)
        .sort((a, b) => (b.noHospital?.minutos ?? 0) - (a.noHospital?.minutos ?? 0)),
    [viaturas],
  );
  const fora = useMemo(
    () =>
      (viaturas ?? [])
        .filter((v) => v.foraDaCerca && v.foraDaCerca.minutos >= foraCercaMin)
        .sort((a, b) => b.foraDaCerca!.minutos - a.foraDaCerca!.minutos),
    [viaturas, foraCercaMin],
  );
  const pendentes = alertas.filter((v) => !cientes.includes(chaveAlerta(v)));
  const pendentesFora = fora.filter((v) => !cientes.includes(chaveFora(v)));
  const ciente = useCallback(
    (v: ViaturaFrota, tipo: "parada" | "fora" = "parada") => {
      // Guarda só os avisos ainda vivos — a lista não cresce para sempre.
      const vivas = new Set([...alertas.map(chaveAlerta), ...fora.map(chaveFora)]);
      const novo = [...cientes.filter((c) => vivas.has(c)), tipo === "fora" ? chaveFora(v) : chaveAlerta(v)];
      setCientes(novo);
      localStorage.setItem(CHAVE_CIENTE, JSON.stringify(novo));
    },
    [alertas, fora, cientes],
  );
  return { alertas, pendentes, pendentesFora, ciente };
}
