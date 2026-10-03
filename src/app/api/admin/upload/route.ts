import { json } from "@/server/api";
import { adminRoute } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { isAllowedImageType, MAX_IMAGE_BYTES, sniffImageType } from "@/server/images";
import { uploadImage } from "@/server/storage";

/** Room for the multipart boundaries and headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** POST /api/admin/upload multipart `file` (jpeg/png/webp/gif, <= 4 MB: Vercel caps request bodies at 4.5 MB) -> { url } */
export const POST = adminRoute(async (request) => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES) throw new HttpError(413, "file_too_large");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "invalid_form_data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "missing_file");
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "file_too_large");
  if (file.type !== "" && !isAllowedImageType(file.type)) throw new HttpError(415, "unsupported_file_type");

  // The stored content type comes from the bytes, not from the client.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new HttpError(415, "unsupported_file_type");

  const { url } = await uploadImage({ bytes, type, name: file.name || "image" });
  return json({ url });
});
