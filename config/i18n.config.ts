export type LocaleId = "en-IN" | "hi-IN";

export const DEFAULT_LOCALE: LocaleId = "en-IN";
export const LOCALE_STORAGE_KEY = "jbt-locale";

export const localeOptions: Array<{ id: LocaleId; label: string; ready: boolean }> = [
  { id: "en-IN", label: "English (India)", ready: true },
  { id: "hi-IN", label: "Hindi (preview)", ready: false },
];
