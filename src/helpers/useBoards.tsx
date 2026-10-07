import { useQuery } from "@tanstack/react-query";
import { getBoards } from "../endpoints/boards_GET.schema";

export function useBoards() {
  return useQuery({ queryKey: ["assembly-boards"], queryFn: getBoards, staleTime: 15000 });
}

