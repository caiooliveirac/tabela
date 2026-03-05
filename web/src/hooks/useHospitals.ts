import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, connectWs, onWsEvent } from "../api/client";

export function useHospitals() {
  const queryClient = useQueryClient();

  useEffect(() => {
    connectWs();
    const unsub = onWsEvent((event) => {
      if (
        event.type === "case:created" ||
        event.type === "case:removed" ||
        event.type === "intel:created" ||
        event.type === "intel:removed" ||
        event.type === "refresh"
      ) {
        queryClient.invalidateQueries({ queryKey: ["hospitals"] });
        queryClient.invalidateQueries({ queryKey: ["cases"] });
        queryClient.invalidateQueries({ queryKey: ["intel"] });
      }
    });
    return unsub;
  }, [queryClient]);

  return useQuery({
    queryKey: ["hospitals"],
    queryFn: api.getHospitals,
    refetchInterval: 60_000, // fallback poll every 60s
  });
}
