import type { PolicyCategory } from "./api";

export type PolicyTemplate = { key: string; title: string; category: PolicyCategory; mandatory: boolean; summary: string; body: string };

/**
 * Starting points for a new policy. `{company}` is replaced with the company name. They are generic: the owner
 * edits them to fit the business (and checks POSH and anything legal with an advisor) before publishing.
 */
export const POLICY_TEMPLATES: ReadonlyArray<PolicyTemplate> = [
  {
    key: "leave",
    title: "Leave Policy",
    category: "hr",
    mandatory: false,
    summary: "How much leave you get, how to apply, and how leave is approved.",
    body: `1. Purpose
This policy explains the leave available to employees of {company} and how to use it.

2. Leave types
• Casual leave and sick leave, as set in HR → Settings & Access and shown on your profile.
• Public holidays, as published in the holiday calendar.
• Loss of pay (LOP) leave when no balance is left, with your manager's approval.

3. Applying for leave
Apply in Justx BOS as early as you can — at least 3 working days ahead for planned leave. For sickness, apply on the day or as soon as you are able to.

4. Approval
Your manager or HR approves or declines each request. Leave isn't confirmed until it's approved.

5. Unapproved absence
Absence without approved leave is treated as loss of pay and may lead to further action.`,
  },
  {
    key: "wfh",
    title: "Work From Home Policy",
    category: "hr",
    mandatory: false,
    summary: "When remote work is allowed and what's expected while working from home.",
    body: `1. Eligibility
Roles that don't need you on site may work from home with your manager's approval. Site, field and customer-facing work is done on site.

2. Requesting
Agree work-from-home days with your manager in advance and mark them as WFH in attendance.

3. Expectations
• Be reachable during working hours on phone and chat.
• Join scheduled meetings with video when asked.
• Keep the same quality and deadlines as in the office.

4. Equipment and data
Use company devices where provided, a secure network, and follow the IT & Data Security Policy.

5. Changes
{company} may change or withdraw work-from-home arrangements when the business needs it.`,
  },
  {
    key: "conduct",
    title: "Code of Conduct",
    category: "compliance",
    mandatory: true,
    summary:
      "Sets expectations for professional behaviour, workplace ethics, conflicts of interest, and how to report concerns. Applies to every employee regardless of role or location.",
    body: `1. Who this applies to
Every employee, intern and contractor of {company}, at work, on customer sites and at work events.

2. Respect
Treat colleagues, customers and partners with respect. Harassment, discrimination, bullying and violence are not tolerated.

3. Integrity
• Be honest in your work, records, timesheets and expense claims.
• Don't offer or accept bribes, kickbacks or gifts that could influence a decision.
• Declare any conflict of interest — for example a family member's business that supplies us — to your manager.

4. Company property and information
Use company property and information only for work. Keep customer and company information confidential, during and after your employment.

5. Safety
Follow site safety rules and use the protective equipment provided. Report accidents and near misses straight away.

6. Raising concerns
Raise concerns with your manager or HR. Concerns raised in good faith are taken seriously, and no one is penalised for raising them.

7. Breaches
Breaking this code may lead to disciplinary action, up to termination.`,
  },
  {
    key: "posh",
    title: "POSH Policy",
    category: "compliance",
    mandatory: true,
    summary:
      "Prevention of Sexual Harassment policy, as required under the POSH Act. Covers reporting channels, the Internal Committee, and timelines for resolution. Acknowledgment is mandatory for all employees.",
    body: `1. Commitment
{company} is committed to a workplace free from sexual harassment, under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.

2. What is sexual harassment
Unwelcome physical contact or advances, a demand or request for sexual favours, sexually coloured remarks, showing pornography, or any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.

3. Where it applies
At the office, on customer and project sites, while travelling for work, at work events, and online.

4. Internal Committee
The Internal Committee (IC) receives and inquires into complaints.
Presiding officer: [name, phone, email]
Members: [names]
External member: [name]

5. Making a complaint
Write to the IC within three months of the incident (the IC can extend this by up to three more months for good reason). The IC helps if you need support putting the complaint in writing.

6. Inquiry
The IC completes its inquiry within 90 days, keeps the matter confidential, and recommends action. No one who complains or gives evidence in good faith will be victimised.

7. Consequences
Anyone found to have harassed will face action under the service rules, up to termination.`,
  },
  {
    key: "travel",
    title: "Travel & Expense Policy",
    category: "finance",
    mandatory: false,
    summary: "How to request work travel, what's covered, and how to claim expenses.",
    body: `1. Before you travel
Raise a travel request in Justx BOS (HR → Expenses & Assets) with the purpose, dates and estimated cost. Travel needs approval before you book.

2. What's covered
• Travel by the agreed mode (bus, train, flight or car).
• Reasonable stay and meals while away.
• Local conveyance for work.

3. Claiming
Claim expenses within 15 days of returning, with bills or receipts, against the trip. Claims are approved by your manager and reimbursed with payroll or by bank transfer.

4. Not covered
Personal travel, alcohol, fines and penalties, and costs not supported by a bill.`,
  },
  {
    key: "it",
    title: "IT & Data Security Policy",
    category: "it",
    mandatory: false,
    summary: "Rules for handling company data, acceptable use of devices and accounts, password requirements, and what to do if you suspect a security incident.",
    body: `1. Accounts and passwords
Use a strong, unique password and turn on two-step sign-in where offered. Never share your password or one-time codes.

2. Devices
Keep company devices locked when unattended and up to date. Report a lost or stolen device to IT and HR the same day.

3. Data
Store company and customer data only in approved company systems. Don't copy it to personal email, drives or phones.

4. Acceptable use
Company systems are for work. Don't install unlicensed software or visit unsafe sites.

5. Incidents
If you suspect a phishing email, malware or a data leak, stop and report it to IT straight away — don't try to fix it yourself.

6. Leaving
Return all company devices and data on your last day. Access is removed when you leave.`,
  },
];

export function fromTemplate(t: PolicyTemplate, company: string) {
  const fill = (s: string) => s.replaceAll("{company}", company || "the company");
  return { title: t.title, category: t.category, mandatory: t.mandatory, summary: fill(t.summary), body: fill(t.body) };
}
