// Image validation and storage paths. Pure functions.

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Manual uploads through the API. Vercel caps request bodies at 4.5 MB. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Anything written to storage, generated images included. Same limit as the bucket (see the init migration). */
export const MAX_STORED_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * Detects the real format from the file's magic bytes, so a file is stored with
 * the content type it actually has (never trust the client-declared type).
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"; // "GIF8"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp"; // "RIFF....WEBP"
  }
  return null;
}

/** "My Photo (1).PNG" -> "my-photo-1"; at most 60 chars; "image" when nothing usable is left. */
export function sanitizeImageName(name: string): string {
  const base = name
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "image";
}

/** Object path inside the bucket: posts/<folder>/<name>.<ext>. */
export function imageObjectPath(folder: string, name: string, type: AllowedImageType): string {
  return `posts/${folder}/${sanitizeImageName(name)}.${EXTENSIONS[type]}`;
}
