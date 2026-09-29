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

export function useReativarViatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reativadaPor }: { id: number; reativadaPor: string }) => api.reativarViatura(id, reativadaPor),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["frota"] }),
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

/**
 * Viaturas com 40 min ou mais num hospital. "Ciente" vale para ESTA parada,
 * neste navegador: se a viatura sair e voltar, é outra parada e avisa de novo.
 */
export function useAlertasFrota(viaturas: ViaturaFrota[] | undefined) {
  const [cientes, setCientes] = useState<string[]>(lerCientes);
  const alertas = useMemo(
    () =>
      (viaturas ?? [])
        .filter((v) => v.noHospital?.alerta)
        .sort((a, b) => (b.noHospital?.minutos ?? 0) - (a.noHospital?.minutos ?? 0)),
    [viaturas],
  );
  const pendentes = alertas.filter((v) => !cientes.includes(chaveAlerta(v)));
  const ciente = useCallback(
    (v: ViaturaFrota) => {
      // Guarda só as paradas ainda em alerta — a lista não cresce para sempre.
      const vivas = new Set(alertas.map(chaveAlerta));
      const novo = [...cientes.filter((c) => vivas.has(c)), chaveAlerta(v)];
      setCientes(novo);
      localStorage.setItem(CHAVE_CIENTE, JSON.stringify(novo));
    },
    [alertas, cientes],
  );
  return { alertas, pendentes, ciente };
}
