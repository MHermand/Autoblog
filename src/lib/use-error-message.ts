"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { isApiError } from "@/lib/api";

/**
 * Turns any thrown value into a short, translated, user-facing sentence.
 * Known server codes get a translated message; unknown ones fall back to the
 * server's own (English) explanation, then to the HTTP status.
 */
export function useErrorMessage() {
  const t = useTranslations("errors");

  return useCallback(
    (error: unknown): string => {
      if (!isApiError(error)) return t("generic", { status: "?" });

      switch (error.code) {
        case "network_error":
          return t("network");
        case "slug_taken":
          return t("slugTaken");
        case "server_misconfigured":
          return t("misconfigured");
        case "file_too_large":
        case "payload_too_large":
          return t("tooLarge");
        case "unsupported_file_type":
          return t("unsupportedType");
        case "missing_api_key":
          return t("missingApiKey", { provider: error.details.provider ?? "?" });
        case "llm_error":
          return t("llmError", { message: error.details.message ?? "?" });
        case "invalid_request": {
          const issues = (error.details.issues ?? []).slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
          return t("rejected", { message: issues.join(" · ") || error.code });
        }
      }

      // A code that comes from the server (not synthesized from the status) with an explanation.
      if (!error.code.startsWith("http_") && error.details.message) return error.details.message;

      switch (error.status) {
        case 401:
          return t("unauthorized");
        case 403:
          return t("forbidden");
        case 404:
          return t("notFound");
        case 413:
          return t("tooLarge");
        case 502:
        case 503:
        case 504:
          return t("unreachable");
        default:
          return t("generic", { status: error.status });
      }
    },
    [t],
  );
}
