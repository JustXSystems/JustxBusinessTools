import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_FOOTER,
  footerShowsSender,
  normalizeDocumentFooter,
} from "@/lib/document-footer";

describe("normalizeDocumentFooter", () => {
  it("falls back to the classic defaults for missing or invalid input", () => {
    expect(normalizeDocumentFooter(null)).toEqual(DEFAULT_DOCUMENT_FOOTER);
    expect(normalizeDocumentFooter("not json")).toEqual(DEFAULT_DOCUMENT_FOOTER);
    expect(normalizeDocumentFooter({ template: "fancy" }).template).toBe("classic");
  });

  it("keeps a valid template, toggles and trimmed labels", () => {
    const f = normalizeDocumentFooter(
      JSON.stringify({
        template: "contact-card",
        contactHeading: "  Your sales contact ",
        showPhone: true,
        showEmail: false,
        queriesToSender: false,
        signatoryLabel: "",
      }),
    );
    expect(f).toEqual({
      template: "contact-card",
      contactHeading: "Your sales contact",
      showPhone: true,
      showEmail: false,
      queriesToSender: false,
      signatoryLabel: DEFAULT_DOCUMENT_FOOTER.signatoryLabel,
    });
    expect(footerShowsSender(f)).toBe(true);
    expect(footerShowsSender(DEFAULT_DOCUMENT_FOOTER)).toBe(false);
  });

  it("caps labels at 60 characters", () => {
    const f = normalizeDocumentFooter({ contactHeading: "x".repeat(200) });
    expect(f.contactHeading).toHaveLength(60);
  });
});
