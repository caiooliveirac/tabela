import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, connectWs, onWsEvent } from "../api/client";
import type { CreateUpaRestrictionPayload } from "../lib/types";

const KEY = ["upa-restrictions"];

export function useUpaRestrictions() {
  const queryClient = useQueryClient();

  // A restrição é decisão de chefia que muda o que o regulador pode fazer AGORA
  // — chega por WS e, como rede de segurança, um poll de 60s.
  useEffect(() => {
    connectWs();
    return onWsEvent((event) => {
      if (event.type === "upa-restriction:changed" || event.type === "refresh") {
        queryClient.invalidateQueries({ queryKey: KEY });
      }
    });
  }, [queryClient]);

  return useQuery({
    queryKey: KEY,
    queryFn: api.getUpaRestrictions,
    refetchInterval: 60_000,
  });
}

export function useRestrictUpa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ data, pin }: { data: CreateUpaRestrictionPayload; pin: string }) =>
      api.restrictUpa(data, pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useLiberateUpa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, removidoPor, pin }: { id: number; removidoPor: string; pin: string }) =>
      api.liberateUpa(id, removidoPor, pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}
