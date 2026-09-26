import { describe, expect, it } from "vitest";
import {
  buildQrPayload,
  escapeWifi,
  normalizePhone,
  normalizeWebUrl,
  qrFileStem,
  QR_TYPES,
} from "@/lib/qr-generator/payloads";

function payloadOf(result: ReturnType<typeof buildQrPayload>): string {
  if (!result.ok) throw new Error(`expected ok, got error "${result.error}"`);
  return result.payload;
}

describe("buildQrPayload", () => {
  it("treats empty required fields as incomplete without an error message", () => {
    for (const t of QR_TYPES) {
      const r = buildQrPayload(t.id, { ...(t.defaults ?? {}) });
      expect(r.ok, t.id).toBe(false);
      if (!r.ok) expect(r.error, t.id).toBe("");
    }
  });

  it("adds https:// to bare website addresses and rejects junk", () => {
    expect(payloadOf(buildQrPayload("url", { url: "example.com/offer?x=1" }))).toBe("https://example.com/offer?x=1");
    expect(payloadOf(buildQrPayload("url", { url: "http://a.in" }))).toBe("http://a.in");
    const bad = buildQrPayload("url", { url: "not a url" });
    expect(bad.ok).toBe(false);
    expect(normalizeWebUrl("javascript:alert(1)")).toBeNull();
  });

  it("builds UPI links with literal @, INR currency and 2-dp amount", () => {
    const p = payloadOf(buildQrPayload("upi", { pa: "shop@okhdfcbank", pn: "Shiv Solar", am: "1500", tn: "Advance", tr: "INV-1" }));
    expect(p).toBe("upi://pay?pa=shop@okhdfcbank&pn=Shiv%20Solar&am=1500.00&cu=INR&tr=INV-1&tn=Advance");
  });

  it("validates UPI ID and amount", () => {
    expect(buildQrPayload("upi", { pa: "nope" }).ok).toBe(false);
    expect(buildQrPayload("upi", { pa: "ab@upi", am: "0" }).ok).toBe(false);
    expect(buildQrPayload("upi", { pa: "ab@upi", am: "10.555" }).ok).toBe(false);
    const noName = buildQrPayload("upi", { pa: "ab@upi" });
    expect(noName.ok && noName.warning).toBeTruthy();
  });

  it("builds Google Maps links for coordinates, search and pasted links", () => {
    expect(payloadOf(buildQrPayload("maps", { mode: "coords", lat: "19.076", lng: "72.8777" }))).toBe(
      "https://www.google.com/maps/search/?api=1&query=19.076,72.8777",
    );
    expect(payloadOf(buildQrPayload("maps", { mode: "search", query: "MG Road, Pune" }))).toBe(
      "https://www.google.com/maps/search/?api=1&query=MG%20Road%2C%20Pune",
    );
    const link = buildQrPayload("maps", { mode: "link", link: "https://maps.app.goo.gl/abc123" });
    expect(link.ok && !link.warning).toBe(true);
    expect(buildQrPayload("maps", { mode: "coords", lat: "95", lng: "0" }).ok).toBe(false);
  });

  it("builds Google review links from a Place ID or passes a link through", () => {
    expect(payloadOf(buildQrPayload("review", { place: "ChIJN1t_tDeuEmsRUsoyG83frY4" }))).toBe(
      "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    );
    expect(payloadOf(buildQrPayload("review", { place: "g.page/r/abc/review" }))).toBe("https://g.page/r/abc/review");
  });

  it("builds mailto, tel, SMSTO and wa.me payloads", () => {
    expect(payloadOf(buildQrPayload("email", { to: "a@b.com", subject: "Hi there" }))).toBe("mailto:a@b.com?subject=Hi%20there");
    expect(payloadOf(buildQrPayload("phone", { phone: "+91 98765-43210" }))).toBe("tel:+919876543210");
    expect(payloadOf(buildQrPayload("sms", { phone: "9876543210", message: "Call me" }))).toBe("SMSTO:9876543210:Call me");
    expect(payloadOf(buildQrPayload("whatsapp", { phone: "98765 43210", message: "Hi!" }))).toBe("https://wa.me/919876543210?text=Hi!");
    expect(payloadOf(buildQrPayload("whatsapp", { phone: "+1 415 555 0100" }))).toBe("https://wa.me/14155550100");
    expect(normalizePhone("12")).toBeNull();
  });

  it("builds an escaped vCard 3.0 with CRLF line endings", () => {
    const p = payloadOf(
      buildQrPayload("vcard", {
        firstName: "Asha",
        lastName: "Rao",
        org: "Rao; Sons, Pvt",
        mobile: "+91 99999 00000",
        email: "asha@rao.in",
        website: "rao.in",
        city: "Pune",
        country: "India",
      }),
    );
    const lines = p.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCARD");
    expect(lines).toContain("VERSION:3.0");
    expect(lines).toContain("N:Rao;Asha;;;");
    expect(lines).toContain("FN:Asha Rao");
    expect(lines).toContain("ORG:Rao\\; Sons\\, Pvt");
    expect(lines).toContain("TEL;TYPE=CELL:+919999900000");
    expect(lines).toContain("URL:https://rao.in");
    expect(lines).toContain("ADR;TYPE=WORK:;;;Pune;;;India");
    expect(lines.at(-1)).toBe("END:VCARD");
  });

  it("builds Wi-Fi payloads with escaping, open networks and hidden flag", () => {
    expect(payloadOf(buildQrPayload("wifi", { ssid: "Office;5G", security: "WPA", password: 'p:a"ss,word', hidden: "1" }))).toBe(
      'WIFI:T:WPA;S:Office\\;5G;P:p\\:a\\"ss\\,word;H:true;;',
    );
    expect(payloadOf(buildQrPayload("wifi", { ssid: "Guest", security: "nopass", password: "ignored" }))).toBe("WIFI:T:nopass;S:Guest;;");
    expect(buildQrPayload("wifi", { ssid: "X", security: "WPA", password: "short" }).ok).toBe(false);
    expect(escapeWifi("a\\b")).toBe("a\\\\b");
  });

  it("builds a VEVENT and defaults the end to one hour later", () => {
    const p = payloadOf(buildQrPayload("event", { title: "Demo, day 1", start: "2026-10-01T10:30", location: "HQ" }));
    expect(p.split("\r\n")).toEqual([
      "BEGIN:VEVENT",
      "SUMMARY:Demo\\, day 1",
      "DTSTART:20261001T103000",
      "DTEND:20261001T113000",
      "LOCATION:HQ",
      "END:VEVENT",
    ]);
    expect(buildQrPayload("event", { title: "X", start: "2026-10-01T10:30", end: "2026-10-01T09:00" }).ok).toBe(false);
  });

  it("builds social profile links from handles and checks pasted links", () => {
    expect(payloadOf(buildQrPayload("social", { platform: "instagram", handle: "@acme.solar" }))).toBe(
      "https://www.instagram.com/acme.solar",
    );
    expect(payloadOf(buildQrPayload("social", { platform: "linkedin-company", handle: "acme-solar" }))).toBe(
      "https://www.linkedin.com/company/acme-solar",
    );
    expect(payloadOf(buildQrPayload("social", { platform: "youtube", handle: "AcmeTV" }))).toBe("https://www.youtube.com/@AcmeTV");
    const mismatch = buildQrPayload("social", { platform: "instagram", handle: "https://facebook.com/acme" });
    expect(mismatch.ok && mismatch.warning).toBeTruthy();
    expect(buildQrPayload("social", { platform: "x", handle: "bad handle!" }).ok).toBe(false);
  });

  it("builds store links for Play package names and App Store ids", () => {
    expect(payloadOf(buildQrPayload("app", { store: "play", app: "com.acme.field_app" }))).toBe(
      "https://play.google.com/store/apps/details?id=com.acme.field_app",
    );
    expect(payloadOf(buildQrPayload("app", { store: "appstore", app: "id1234567890" }))).toBe("https://apps.apple.com/app/id1234567890");
    expect(buildQrPayload("app", { store: "play", app: "acme" }).ok).toBe(false);
  });

  it("builds meeting links from Zoom IDs, Meet codes and pasted invites", () => {
    const zoom = buildQrPayload("meeting", { platform: "zoom", link: "812 3456 7890" });
    expect(payloadOf(zoom)).toBe("https://zoom.us/j/81234567890");
    expect(zoom.ok && zoom.warning).toBeTruthy();
    expect(payloadOf(buildQrPayload("meeting", { platform: "meet", link: "ABCDEFGHIJ" }))).toBe("https://meet.google.com/abc-defg-hij");
    const teams = buildQrPayload("meeting", { platform: "teams", link: "https://teams.microsoft.com/l/meetup-join/x" });
    expect(teams.ok && !teams.warning).toBe(true);
    expect(buildQrPayload("meeting", { platform: "teams", link: "12345" }).ok).toBe(false);
  });

  it("formats bank transfer details and validates IFSC and GSTIN", () => {
    const p = payloadOf(
      buildQrPayload("bank", {
        holder: "Acme Solar Pvt Ltd",
        account: "5020 0012 3456 78",
        ifsc: "hdfc0001234",
        bankName: "HDFC Bank",
        branch: "Andheri East",
        accountType: "Current",
        gstin: "27abcde1234f1z5",
      }),
    );
    expect(p.split("\n")).toEqual([
      "Bank transfer details",
      "Account name: Acme Solar Pvt Ltd",
      "Account no.: 50200012345678",
      "IFSC: HDFC0001234",
      "Bank: HDFC Bank, Andheri East",
      "Account type: Current",
      "GSTIN: 27ABCDE1234F1Z5",
    ]);
    expect(buildQrPayload("bank", { holder: "A", account: "50200012345678", ifsc: "HDFC1234" }).ok).toBe(false);
    expect(buildQrPayload("bank", { holder: "A", account: "50200012345678", ifsc: "HDFC0001234", gstin: "123" }).ok).toBe(false);
  });

  it("builds coupons as text or a redeem link with the code filled in", () => {
    const text = payloadOf(
      buildQrPayload("coupon", { code: "DIWALI20", offer: "Flat 20% off", validTill: "2099-12-31", terms: "One per customer" }),
    );
    expect(text.split("\n")[0]).toBe("Flat 20% off");
    expect(text).toContain("Code: DIWALI20");
    expect(text).toContain("Valid till: ");
    expect(payloadOf(buildQrPayload("coupon", { code: "A&B", redeemUrl: "shop.example.com/cart?coupon={code}" }))).toBe(
      "https://shop.example.com/cart?coupon=A%26B",
    );
    const expired = buildQrPayload("coupon", { code: "OLD", validTill: "2001-01-01" });
    expect(expired.ok && expired.warning).toBeTruthy();
    expect(buildQrPayload("coupon", { code: "has space" }).ok).toBe(false);
  });

  it("builds asset tags as text or an asset-system link", () => {
    expect(
      payloadOf(buildQrPayload("asset", { assetId: "IT-LAP-0042", name: "Dell Latitude", location: "Pune HQ" })).split("\n"),
    ).toEqual(["ASSET IT-LAP-0042", "Item: Dell Latitude", "Location: Pune HQ"]);
    expect(payloadOf(buildQrPayload("asset", { assetId: "IT 42", lookupUrl: "https://assets.acme.in/a/{id}" }))).toBe(
      "https://assets.acme.in/a/IT%2042",
    );
    expect(payloadOf(buildQrPayload("asset", { assetId: "IT-42", lookupUrl: "assets.acme.in/lookup" }))).toBe(
      "https://assets.acme.in/lookup?asset=IT-42",
    );
  });
});

describe("qrFileStem", () => {
  it("slugifies the most meaningful field", () => {
    expect(qrFileStem("url", { url: "https://Example.com/Offer" })).toBe("qr-url-example-com-offer");
    expect(qrFileStem("text", { text: "hello" })).toBe("qr-text");
  });
});
