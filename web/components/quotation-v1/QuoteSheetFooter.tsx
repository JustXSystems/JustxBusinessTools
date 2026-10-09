"use client";

import type { CompanyProfileV1 } from "@/lib/quotation-v1";
import { fmtDateSlash } from "@/lib/quotation-v1";
import { footerShowsSender, normalizeDocumentFooter } from "@/lib/document-footer";

export type QuoteSender = {
  name?: string;
  phone?: string;
  email?: string;
};

type Props = {
  company: CompanyProfileV1;
  date: string;
  sender: QuoteSender;
};

/** "For any queries" line and the sign-off block, laid out by the Business Profile footer template. */
export function QuoteSheetFooter({ company: c, date, sender }: Props) {
  const f = normalizeDocumentFooter(c.documentFooter);
  const name = (sender.name ?? "").trim();
  const useSender = footerShowsSender(f) && Boolean(name);
  const phone = useSender && f.showPhone ? (sender.phone ?? "").trim() : "";
  const email = useSender && f.showEmail ? (sender.email ?? "").trim() : "";
  const queriesFromSender = useSender && f.queriesToSender && Boolean(phone || email);
  const template = useSender ? f.template : "classic";

  const datePlace = (
    <div>
      <b>Date :</b> {fmtDateSlash(date)}
      <br />
      <b>Place :</b> {c.place || "Bengaluru"}
    </div>
  );

  const companySignatory = (
    <div style={{ textAlign: "right" }}>
      <b>For {c.name}</b>
      <div className="qgv1-qs-sign">{f.signatoryLabel}</div>
    </div>
  );

  return (
    <>
      <div className="qgv1-qs-callback">
        <b>Thank you for your business with {c.name}!</b>
        <br />
        {queriesFromSender ? (
          <>
            For any queries, please contact <b>{name}</b>
            {phone ? (
              <>
                <br />
                Mobile: {phone}
              </>
            ) : null}
            {email ? (
              <>
                <br />
                Email: {email}
              </>
            ) : null}
          </>
        ) : (
          <>
            For any queries, please contact
            <br />
            Phone: {c.phone}
            <br />
            Email: {c.email}
          </>
        )}
      </div>

      {template === "contact-card" ? (
        <div className="qgv1-qs-bank" data-footer="contact-card">
          {datePlace}
          <div className="qgv1-qs-contact">
            <div className="qgv1-qs-contact-h">{f.contactHeading}</div>
            <div className="qgv1-qs-contact-nm">{name}</div>
            {phone ? <div>Mobile: {phone}</div> : null}
            {email ? <div>Email: {email}</div> : null}
          </div>
          {companySignatory}
        </div>
      ) : template === "sender-signs" ? (
        <div className="qgv1-qs-bank" data-footer="sender-signs">
          {datePlace}
          <div className="qgv1-qs-signer">
            <b>For {c.name}</b>
            <div className="qgv1-qs-sign-space" />
            <div className="qgv1-qs-signer-nm">{name}</div>
            <div>{f.signatoryLabel}</div>
            {phone || email ? (
              <div className="qgv1-qs-signer-meta">
                {[phone ? `Mobile: ${phone}` : "", email ? `Email: ${email}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
      ) : template === "contact-strip" ? (
        <div className="qgv1-qs-bank" data-footer="contact-strip">
          <div className="qgv1-qs-contact-strip">
            <span className="lbl">{f.contactHeading}</span>
            <span className="nm">{name}</span>
            {phone ? <span>Mobile: {phone}</span> : null}
            {email ? <span>Email: {email}</span> : null}
          </div>
          {datePlace}
          {companySignatory}
        </div>
      ) : (
        <div className="qgv1-qs-bank">
          {datePlace}
          {companySignatory}
        </div>
      )}
    </>
  );
}
