import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLASH_ERROR_SECONDS,
  DEFAULT_FLASH_OK_SECONDS,
  normalizeFlashDisplaySettings,
} from "@/lib/flash-display";

describe("flash-display", () => {
  it("defaults and clamps", () => {
    expect(normalizeFlashDisplaySettings(null)).toEqual({
      errorSeconds: DEFAULT_FLASH_ERROR_SECONDS,
      okSeconds: DEFAULT_FLASH_OK_SECONDS,
    });
    expect(normalizeFlashDisplaySettings({ errorSeconds: 1, okSeconds: 999 })).toEqual({
      errorSeconds: 5,
      okSeconds: 120,
    });
    expect(normalizeFlashDisplaySettings({ errorSeconds: 90, okSeconds: 12 })).toEqual({
      errorSeconds: 90,
      okSeconds: 12,
    });
  });
});
