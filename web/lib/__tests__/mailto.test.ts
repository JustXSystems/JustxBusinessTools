import { describe, expect, it } from "vitest";
import { buildMailtoHref } from "@/lib/mailto";

describe("buildMailtoHref", () => {
  it("percent-encodes spaces as %20 (not +) so Outlook does not show plus signs", () => {
    const href = buildMailtoHref({
      to: "a@example.com",
      subject: "Hello World",
      body: "Dear Customer,\n\nPlease find attached.",
    });
    expect(href).toContain("mailto:a@example.com?");
    expect(href).toContain("subject=Hello%20World");
    expect(href).toContain("body=Dear%20Customer");
    expect(href).not.toMatch(/[?&](subject|body)=[^&]*\+/);
    expect(href).toContain("%0A"); // newlines still percent-encoded
  });

  it("includes cc when provided", () => {
    const href = buildMailtoHref({
      to: "a@example.com",
      cc: "b@example.com",
      subject: "S",
      body: "B",
    });
    expect(href).toContain("cc=b%40example.com");
  });
});
