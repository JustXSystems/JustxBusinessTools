/**
 * Shared Send Via template placeholders — any tool may supply values for the keys it uses.
 * Unused keys expand to empty string in templates.
 */

export type SendTemplatePlaceholderGroup = {
  title: string;
  items: Array<{ key: string; description: string }>;
};

export const SEND_TEMPLATE_PLACEHOLDER_GROUPS: SendTemplatePlaceholderGroup[] = [
  {
    title: "Customer & sender",
    items: [
      { key: "customerName", description: "Customer / site contact name" },
      { key: "LoggedinUserName", description: "Staff member sending the document" },
      { key: "LogginUserPhonenumber", description: "Sender phone (logged-in user)" },
    ],
  },
  {
    title: "Company (from Business Profile)",
    items: [
      { key: "companyName", description: "Business name" },
      { key: "companyPhone", description: "Company phone" },
      { key: "companyEmail", description: "Company email" },
      { key: "companyAddress", description: "Address lines + state" },
      { key: "companyGstin", description: "GSTIN" },
    ],
  },
  {
    title: "Document (tool-specific — each tool fills what applies)",
    items: [
      { key: "quoteNo", description: "Quotation number (Quotation tool)" },
      { key: "reportNo", description: "Report / survey ID (Site Survey tool)" },
      { key: "typeLabel", description: "Product / installation / engagement type" },
      { key: "date", description: "Document date" },
      { key: "validTill", description: "Validity date (quotations)" },
      { key: "grandTotal", description: "Total amount (quotations)" },
      { key: "grandTotalWords", description: "Amount in words (quotations)" },
      { key: "genLabel", description: "Generation / capacity label (site survey)" },
      { key: "totalCost", description: "Estimated cost (site survey)" },
      { key: "quoteLink", description: "Public link to online document (when available)" },
    ],
  },
  {
    title: "Corporate HTML blocks (optional in message template)",
    items: [
      { key: "quoteSummaryBlock", description: "Styled summary table (labels follow document type)" },
      { key: "lineItemsBlock", description: "Line-item table when the tool provides items" },
      { key: "quoteLinkBlock", description: "View button or PDF attachment note" },
    ],
  },
];

export const SEND_TEMPLATE_PLACEHOLDER_KEYS = SEND_TEMPLATE_PLACEHOLDER_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);
