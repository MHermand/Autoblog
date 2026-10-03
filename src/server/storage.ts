// Image storage in the public `autoblog-images` bucket.

import "server-only";

import { randomUUID } from "node:crypto";
import { imageObjectPath, MAX_STORED_IMAGE_BYTES, type AllowedImageType } from "./images";
import { getAdminClient } from "./supabase";

export const IMAGE_BUCKET = "autoblog-images";

export interface UploadedImage {
  path: string;
  url: string;
}

/**
 * Uploads image bytes to posts/<folder>/<name>.<ext> and returns the public URL.
 * `folder` defaults to a fresh UUID. Callers validate the type (sniffed bytes).
 */
export async function uploadImage(p: {
  bytes: Uint8Array;
  type: AllowedImageType;
  name: string;
  folder?: string;
}): Promise<UploadedImage> {
  if (p.bytes.byteLength > MAX_STORED_IMAGE_BYTES) {
    throw new Error(`Image is larger than ${MAX_STORED_IMAGE_BYTES / (1024 * 1024)} MB`);
  }
  const path = imageObjectPath(p.folder ?? randomUUID(), p.name, p.type);
  const bucket = getAdminClient().storage.from(IMAGE_BUCKET);
  const { error } = await bucket.upload(path, p.bytes, {
    contentType: p.type,
    // Paths are unique (UUID folder), so the files can be cached forever.
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  return { path, url: bucket.getPublicUrl(path).data.publicUrl };
}

/** Best-effort cleanup (e.g. after a failed insert). Never throws. */
export async function removeImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await getAdminClient().storage.from(IMAGE_BUCKET).remove(paths);
    if (error) console.error(`[autoblog] Could not remove orphan images: ${error.message}`);
  } catch (err) {
    console.error("[autoblog] Could not remove orphan images:", err);
  }
}
