import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CreateChefiaPayload, UpdateChefiaPayload } from "../lib/types";

export function useChefia() {
    return useQuery({
        queryKey: ["chefia"],
        queryFn: api.getChefia,
        refetchInterval: 60_000,
    });
}

export function useCreateChefia() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateChefiaPayload) => api.createChefia(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["chefia"] });
        },
    });
}

export function useRemoveChefia() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, removidoPor }: { id: number; removidoPor: string }) =>
            api.removeChefia(id, removidoPor),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["chefia"] });
        },
    });
}

export function useUpdateChefia() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: number; data: UpdateChefiaPayload }) =>
            api.updateChefia(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["chefia"] });
        },
    });
}
