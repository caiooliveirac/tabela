import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CreateCasePayload, UpdateCasePayload } from "../lib/types";

export function useCases() {
  return useQuery({
    queryKey: ["cases"],
    queryFn: api.getCases,
    refetchInterval: 60_000,
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCasePayload) => api.createCase(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospitals"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useRemoveCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, removidoPor }: { id: number; removidoPor: string }) =>
      api.removeCase(id, removidoPor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospitals"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useUpdateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCasePayload }) =>
      api.updateCase(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospitals"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}
