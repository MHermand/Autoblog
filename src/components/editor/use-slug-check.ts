import { useQuery } from "@tanstack/react-query";
import { checkSlug } from "@/lib/api";
import { SLUG_PATTERN } from "@/lib/post-form";
import { useDebouncedValue } from "@/lib/use-debounced-value";

export type SlugStatus =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "unchanged" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; suggestion: string }
  | { kind: "unknown" }; // the check itself failed: let the save decide

/** Debounced availability check of a slug against the other posts. */
export function useSlugCheck(slug: string, postId: string, originalSlug: string): SlugStatus {
  const debounced = useDebouncedValue(slug, 400);
  const query = useQuery({
    queryKey: ["slug-check", postId, debounced],
    queryFn: () => checkSlug(debounced, postId),
    enabled: SLUG_PATTERN.test(debounced) && debounced !== originalSlug,
    staleTime: 10_000,
    retry: false,
  });

  if (slug === "") return { kind: "empty" };
  if (!SLUG_PATTERN.test(slug)) return { kind: "invalid" };
  if (slug === originalSlug) return { kind: "unchanged" };
  if (debounced !== slug || query.isFetching) return { kind: "checking" };
  if (query.isError) return { kind: "unknown" };
  if (!query.data) return { kind: "checking" };
  return query.data.available ? { kind: "available" } : { kind: "taken", suggestion: query.data.suggestion };
}
