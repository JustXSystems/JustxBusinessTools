import { describe, expect, it } from "vitest";
import { resolveEffectiveDestination, type ProfileDeliveryConfig } from "../artifact-dispatch.js";

function cfg(partial: Partial<ProfileDeliveryConfig>): ProfileDeliveryConfig {
  return {
    artifactDestination: "auto",
    downloadFolder: null,
    driveFolderId: "",
    driveFolderLabel: "",
    driveConnected: false,
    driveEmail: null,
    webhookUrl: null,
    webhookSecret: null,
    webhookSecretConfigured: false,
    ...partial,
  };
}

describe("resolveEffectiveDestination", () => {
  it("honors explicit google_drive", () => {
    expect(resolveEffectiveDestination(cfg({ artifactDestination: "google_drive" }))).toBe(
      "google_drive",
    );
  });

  it("auto picks drive when connected with folder", () => {
    expect(
      resolveEffectiveDestination(
        cfg({
          artifactDestination: "auto",
          driveConnected: true,
          driveFolderId: "abc123",
        }),
      ),
    ).toBe("google_drive");
  });

  it("auto falls back to none without destinations", () => {
    expect(resolveEffectiveDestination(cfg({ artifactDestination: "auto" }))).toBe("none");
  });
});
