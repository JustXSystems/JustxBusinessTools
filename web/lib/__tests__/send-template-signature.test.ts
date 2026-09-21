import { describe, expect, it } from "vitest";
import { upgradeSendTemplateSignature } from "@/lib/types/business-profile";

describe("upgradeSendTemplateSignature", () => {
  it("upgrades legacy Regards block and keeps extras", () => {
    const input = `Hi {{customerName}},

Regards,
{{companyName}}
{{companyPhone}}
Website: https://example.com
CC: sales@example.com`;
    const out = upgradeSendTemplateSignature(input);
    expect(out).toContain(`Regards,
{{LoggedinUserName}}
{{companyName}}
{{LogginUserPhonenumber}}
Website: https://example.com
CC: sales@example.com`);
    expect(out).not.toContain("{{companyPhone}}");
  });

  it("is a no-op when already upgraded", () => {
    const input = `Regards,
{{LoggedinUserName}}
{{companyName}}
{{LogginUserPhonenumber}}
Extra line`;
    expect(upgradeSendTemplateSignature(input)).toBe(input);
  });

  it("fixes corrupt phone line merge", () => {
    const input = `Regards,
{{LoggedinUserName}}
{{companyName}}
{{LogginUserPhonenumber}}, {{companyPhone}}
Extra`;
    expect(upgradeSendTemplateSignature(input)).toBe(`Regards,
{{LoggedinUserName}}
{{companyName}}
{{LogginUserPhonenumber}}
Extra`);
  });
});
