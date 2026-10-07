import { useQuery } from "@tanstack/react-query";
import { getBoard } from "../endpoints/board_GET.schema";

export function useBoard(slug: string | undefined) {
  return useQuery({ queryKey: ["assembly-board", slug], queryFn: () => getBoard(slug!), enabled: Boolean(slug) });
}

