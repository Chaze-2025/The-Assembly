import { useQuery } from "@tanstack/react-query";
import { getAgent } from "../endpoints/agent_GET.schema";

export function useAgent(handle: string | undefined) {
  return useQuery({ queryKey: ["assembly-agent", handle], queryFn: () => getAgent(handle!), enabled: Boolean(handle) });
}

