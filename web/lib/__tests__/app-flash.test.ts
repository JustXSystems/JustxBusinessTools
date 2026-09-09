import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_FLASH_ERROR_MS,
  clearAppFlash,
  configureAppFlashDurations,
  dismissAppFlash,
  flashAppError,
  flashAppOk,
  subscribeAppFlash,
} from "@/lib/app-flash";

describe("app-flash", () => {
  afterEach(() => {
    clearAppFlash();
    vi.useRealTimers();
  });

  it("keeps errors visible for at least configured duration", () => {
    vi.useFakeTimers();
    configureAppFlashDurations({ errorSeconds: 60, okSeconds: 8 });
    let latest: { kind: string; message: string }[] = [];
    const unsub = subscribeAppFlash((items) => {
      latest = items.map((i) => ({ kind: i.kind, message: i.message }));
    });
    flashAppError("Download failed");
    expect(latest).toEqual([{ kind: "error", message: "Download failed" }]);
    vi.advanceTimersByTime(APP_FLASH_ERROR_MS - 1);
    expect(latest).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(latest).toHaveLength(0);
    unsub();
  });

  it("dismisses early when requested", () => {
    vi.useFakeTimers();
    let count = 0;
    const unsub = subscribeAppFlash((items) => {
      count = items.length;
    });
    const id = flashAppOk("Saved");
    expect(count).toBe(1);
    dismissAppFlash(id);
    expect(count).toBe(0);
    unsub();
  });
});
