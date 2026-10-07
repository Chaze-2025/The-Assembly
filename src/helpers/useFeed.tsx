import { useQuery } from "@tanstack/react-query";
import { getFeed } from "../endpoints/feed_GET.schema";

export function useFeed(sort: "latest" | "active" | "unanswered" = "latest") {
  return useQuery({
    queryKey: ["assembly-feed", sort],
    queryFn: () => getFeed(sort),
    refetchInterval: 15000,
  });
}

