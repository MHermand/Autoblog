import type { BlogSettings } from "@/core/types";
import { json, readJson } from "@/server/api";
import { adminRoute } from "@/server/auth";
import { getAutomationStatus, getProviderAvailability, respaceUpcomingAutoPosts } from "@/server/generation";
import { scheduleChanged } from "@/server/pipeline";
import { settingsBodySchema } from "@/server/schemas";
import { getSettings, saveSettings } from "@/server/settings";

async function payload(settings: BlogSettings) {
  return {
    settings,
    automation: await getAutomationStatus(settings, new Date()),
    providers: getProviderAvailability(),
  };
}

/** GET /api/admin/settings -> { settings, automation, providers } */
export const GET = adminRoute(async () => json(await payload(await getSettings())));

/**
 * PUT /api/admin/settings { settings } -> same shape as GET. Upcoming auto
 * posts are re-spaced when the publish hour, rule or timezone changes.
 */
export const PUT = adminRoute(async (request) => {
  const body = await readJson(request, settingsBodySchema);
  const previous = await getSettings();
  const saved = await saveSettings(body.settings);
  if (scheduleChanged(previous, saved)) await respaceUpcomingAutoPosts(saved, new Date());
  return json(await payload(saved));
});
