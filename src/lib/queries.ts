// TanStack Query hooks shared by several screens.

import { useQuery } from "@tanstack/react-query";
import { getMe, getSettings } from "@/lib/api";
import { browserTimeZone } from "@/lib/datetime";

export const queryKeys = {
  me: ["me"] as const,
  settings: ["settings"] as const,
  posts: ["posts"] as const,
  post: (id: string) => ["post", id] as const,
};

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe, staleTime: 5 * 60_000 });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: getSettings });
}

/** The blog's timezone (from settings); the browser's own until settings have loaded. */
export function useBlogTimeZone(): string {
  const settings = useSettings();
  return settings.data?.settings.timezone ?? browserTimeZone();
}
