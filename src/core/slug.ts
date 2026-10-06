// URL slugs. Pure functions.

const MAX_SLUG_LENGTH = 80;

// Latin letters that Unicode decomposition (NFD) does not reduce to ASCII.
const LATIN_FOLDS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
};

/**
 * Lowercase slug: Latin diacritics stripped, every run of other characters
 * collapsed into a single dash, at most ~80 characters (cut on a word
 * boundary). Letters of non-Latin scripts (Cyrillic, Greek, CJK, Arabic…)
 * are kept as is, so articles in any language get a meaningful slug.
 * Text with no letters or digits yields "post".
 */
export function slugify(text: string): string {
  const folded = (text ?? "")
    .toLowerCase()
    .replace(/[ßæœøđðþł]/g, (c) => LATIN_FOLDS[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Recompose what NFD split apart in other scripts (Hangul, kana…).
    .normalize("NFC");

  const slug = folded
    // Same alphabet as the slug pattern the API accepts: letters that are
    // still uppercase after toLowerCase() (e.g. "ϒ") are dropped.
    .replace(/[^\p{Ll}\p{Lo}\p{Lm}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  if (slug === "") return "post";
  if (slug.length <= MAX_SLUG_LENGTH) return slug;

  const cut = slug.slice(0, MAX_SLUG_LENGTH + 1);
  // `cut` has one extra character: if it is a dash, the slice already ends on a word boundary.
  const boundary = cut.lastIndexOf("-");
  const trimmed = boundary > MAX_SLUG_LENGTH / 2 ? cut.slice(0, boundary) : slug.slice(0, MAX_SLUG_LENGTH);
  return trimmed.replace(/-+$/g, "");
}

/** `base`, then `base-2`, `base-3`… the first one not present in `taken`. */
export function nextAvailableSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
