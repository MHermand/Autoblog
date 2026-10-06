// Validated access to environment variables (see .env.example).
// Each getter validates only what it returns, so a missing LLM key or cron
// secret never breaks the public API. Errors name the variable, never its value.

import "server-only";

import { llmKeysFromEnv, type LlmKeys } from "@/core/llm";
import { parseEmailList } from "./allowlist";
import { parseAllowedOrigins, type AllowedOrigins } from "./cors";
import { ConfigError } from "./errors";

const MIN_CRON_SECRET_LENGTH = 16;

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new ConfigError(`Missing required environment variable ${name}`);
  return trimmed;
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new ConfigError("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new ConfigError("NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL");
  }
  return {
    url,
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}

export function getServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Lowercased allowlist. Throws when unset or empty: nobody could sign in. */
export function getAdminEmails(): string[] {
  const emails = parseEmailList(required("ADMIN_EMAILS", process.env.ADMIN_EMAILS));
  if (emails.length === 0) throw new ConfigError("ADMIN_EMAILS contains no email address");
  return emails;
}

export function getCronSecret(): string {
  const secret = required("CRON_SECRET", process.env.CRON_SECRET);
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    throw new ConfigError(`CRON_SECRET must be at least ${MIN_CRON_SECRET_LENGTH} characters long`);
  }
  return secret;
}

/** Defaults to "*" (any origin) when unset. */
export function getAllowedOrigins(): AllowedOrigins {
  return parseAllowedOrigins(process.env.PUBLIC_API_ALLOWED_ORIGINS);
}

export function getLlmKeys(): LlmKeys {
  return llmKeysFromEnv(process.env);
}
