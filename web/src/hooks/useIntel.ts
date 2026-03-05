import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CreateIntelPayload } from "../lib/types";

export function useIntel() {
  return useQuery({
    queryKey: ["intel"],
    queryFn: api.getIntel,
    refetchInterval: 60_000,
  });
}

export function useCreateIntel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIntelPayload) => api.createIntel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospitals"] });
      queryClient.invalidateQueries({ queryKey: ["intel"] });
    },
  });
}

export function useRemoveIntel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, removidoPor }: { id: number; removidoPor: string }) =>
      api.removeIntel(id, removidoPor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospitals"] });
      queryClient.invalidateQueries({ queryKey: ["intel"] });
    },
  });
}
