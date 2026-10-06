// Settings repository: a single row (id = 1) holding BlogSettings as JSON.

import "server-only";

import { parseSettings, settingsSchema } from "@/core/settings";
import type { BlogSettings } from "@/core/types";
import { DatabaseError } from "./errors";
import { getAdminClient } from "./supabase";

/** Stored settings merged onto the defaults. Never fails on malformed data. */
export async function getSettings(): Promise<BlogSettings> {
  const { data, error } = await getAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  if (error) throw new DatabaseError(error.message, error.code);
  return parseSettings(data?.data ?? {});
}

/** Validates strictly (throws ZodError) and stores. Returns what was stored. */
export async function saveSettings(input: unknown): Promise<BlogSettings> {
  const settings = settingsSchema.parse(input);
  const { error } = await getAdminClient().from("settings").upsert({ id: 1, data: settings });
  if (error) throw new DatabaseError(error.message, error.code);
  return settings;
}
