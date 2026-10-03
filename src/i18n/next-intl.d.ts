// Type-safe message keys and locales for next-intl.
import type { Locale } from "./config";
import type messages from "../../messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
