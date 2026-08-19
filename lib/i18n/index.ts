import type { LocaleId } from "@/config/i18n.config";
import { enIN } from "@/lib/i18n/messages/en-IN";
import { hiIN } from "@/lib/i18n/messages/hi-IN";

const catalogs: Record<LocaleId, Record<string, Record<string, string>>> = {
  "en-IN": enIN as Record<string, Record<string, string>>,
  "hi-IN": hiIN,
};

function getPath(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function translate(locale: LocaleId, key: string): string {
  const localized = getPath(catalogs[locale], key);
  if (localized) return localized;
  return getPath(enIN, key) ?? key;
}
