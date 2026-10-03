"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageOff, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { RemoteImage } from "@/components/remote-image";
import { uploadImage } from "@/lib/api";
import { useErrorMessage } from "@/lib/use-error-message";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 4 * 1024 * 1024;

interface CoverImageFieldProps {
  url: string;
  alt: string;
  onUrlChange: (url: string) => void;
  onAltChange: (alt: string) => void;
}

export function CoverImageField({ url, alt, onUrlChange, onAltChange }: CoverImageFieldProps) {
  const t = useTranslations("editor.cover");
  const errorMessage = useErrorMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploadError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) return setUploadError(t("errors.type"));
    if (file.size > MAX_BYTES) return setUploadError(t("errors.size"));

    setUploading(true);
    try {
      const { url: uploaded } = await uploadImage(file);
      onUrlChange(uploaded);
    } catch (error) {
      setUploadError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  const trimmedUrl = url.trim();

  return (
    <div className="grid gap-3">
      <Field label={t("url")} error={uploadError ?? undefined}>
        <Input
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // allow picking the same file again
            if (file) void handleFile(file);
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Upload data-icon="inline-start" aria-hidden="true" />}
          {uploading ? t("uploading") : t("upload")}
        </Button>
        {trimmedUrl ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onUrlChange("")}>
            <X data-icon="inline-start" aria-hidden="true" />
            {t("remove")}
          </Button>
        ) : null}
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{t("uploadHint")}</p>

      {trimmedUrl ? (
        <div className="overflow-hidden rounded-lg border bg-muted">
          {brokenUrl === trimmedUrl ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <ImageOff className="size-5" aria-hidden="true" />
              {t("previewError")}
            </div>
          ) : (
            <RemoteImage
              src={trimmedUrl}
              alt={alt}
              onError={() => setBrokenUrl(trimmedUrl)}
              className="aspect-video w-full object-cover"
            />
          )}
        </div>
      ) : null}

      <Field label={t("alt")} hint={t("altHint")}>
        <Input value={alt} onChange={(event) => onAltChange(event.target.value)} />
      </Field>
    </div>
  );
}
