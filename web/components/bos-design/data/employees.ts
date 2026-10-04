import type { BosBadgeTone } from "@/components/bos";

/** Sample employee records (Meridian Solar EPC demo tenant). Read-only fixtures. */
export type EmployeeRecord = {
  key: string;
  name: string;
  role: string;
  dept: string;
  empId: string;
  email: string;
  mobile: string;
  manager: string;
  doj: string;
  type: string;
  initials: string;
  tone: string;
  status: string;
  statusTone: BosBadgeTone;
  cl: number;
  sl: number;
  el: number;
  lop: number;
  present: number;
  absent: number;
  late: number;
  punchout: number;
  bloodGroup: string;
  gross: string;
  net: string;
  documents: string[];
  certificates: string[];
  bank: { name: string; holder: string; acct: string; ifsc: string; branch: string; pin: string };
  fatherName: string;
  address: string;
  emergencyName: string;
  emergencyRelation: string;
  personalEmail: string;
};

export const EMPLOYEES: EmployeeRecord[] = [
  {
    key: "jw", name: "James Workman", role: "Operations Manager", dept: "Field Operations", empId: "JX-2291",
    email: "james.workman@meridiansolar.com", mobile: "+91 98450 12233", manager: "CEO Office", doj: "12 Mar 2023",
    type: "Full-time", initials: "JW", tone: "var(--bos-blue)", status: "ACTIVE", statusTone: "emerald",
    cl: 6, sl: 5, el: 12, lop: 0, present: 22, absent: 1, late: 2, punchout: 1, bloodGroup: "B+",
    gross: "₹1,45,000", net: "₹1,26,400", documents: ["Offer Letter", "PAN Card", "Aadhaar Card"],
    certificates: ["Experience Certificate"],
    bank: { name: "HDFC Bank", holder: "James Workman", acct: "50100234567821", ifsc: "HDFC0001234", branch: "MG Road, Bengaluru", pin: "560001" },
    fatherName: "Thomas Workman", address: "14, Palm Meadows, Whitefield, Bengaluru 560066",
    emergencyName: "Ravi Workman", emergencyRelation: "Spouse", personalEmail: "james.workman@gmail.com",
  },
  {
    key: "ps", name: "Priya Sharma", role: "Sales Executive", dept: "Sales", empId: "JX-2318",
    email: "priya.sharma@meridiansolar.com", mobile: "+91 90210 44110", manager: "CEO Office", doj: "2 Jun 2024",
    type: "Full-time", initials: "PS", tone: "var(--bos-coral)", status: "ACTIVE", statusTone: "emerald",
    cl: 8, sl: 6, el: 9, lop: 0, present: 21, absent: 0, late: 3, punchout: 0, bloodGroup: "O+",
    gross: "₹68,000", net: "₹59,200", documents: ["Offer Letter", "PAN Card", "Aadhaar Card"], certificates: [],
    bank: { name: "ICICI Bank", holder: "Priya Sharma", acct: "60911123456782", ifsc: "ICIC0002345", branch: "Andheri West, Mumbai", pin: "400058" },
    fatherName: "Suresh Sharma", address: "22B, Sunrise Apartments, Andheri West, Mumbai 400058",
    emergencyName: "Rohan Sharma", emergencyRelation: "Brother", personalEmail: "priya.sharma91@gmail.com",
  },
  {
    key: "rk", name: "Rahul Khanna", role: "Field Technician", dept: "Field Operations", empId: "JX-1874",
    email: "rahul.khanna@meridiansolar.com", mobile: "+91 88992 03321", manager: "James Workman", doj: "15 Jul 2021",
    type: "Full-time", initials: "RK", tone: "var(--bos-amber)", status: "ON LEAVE", statusTone: "amber",
    cl: 2, sl: 3, el: 14, lop: 1, present: 19, absent: 2, late: 1, punchout: 3, bloodGroup: "A+",
    gross: "₹52,000", net: "₹46,800", documents: ["Offer Letter", "PAN Card", "Aadhaar Card"],
    certificates: ["Safety Certification"],
    bank: { name: "State Bank of India", holder: "Rahul Khanna", acct: "30456781234567", ifsc: "SBIN0003456", branch: "Whitefield, Bengaluru", pin: "560066" },
    fatherName: "Devendra Khanna", address: "7, Sector 12, Rohini, New Delhi 110085",
    emergencyName: "Sunita Khanna", emergencyRelation: "Mother", personalEmail: "rahul.khanna21@gmail.com",
  },
  {
    key: "an", name: "Ananya Nair", role: "Backend Engineer", dept: "Engineering", empId: "JX-2054",
    email: "ananya.nair@meridiansolar.com", mobile: "+91 99887 65120", manager: "Vivek Rao", doj: "9 Sep 2022",
    type: "Full-time", initials: "AN", tone: "var(--bos-emerald)", status: "ACTIVE", statusTone: "emerald",
    cl: 7, sl: 8, el: 16, lop: 0, present: 23, absent: 0, late: 0, punchout: 0, bloodGroup: "AB+",
    gross: "₹1,18,000", net: "₹1,02,900", documents: ["Offer Letter", "PAN Card", "Aadhaar Card"],
    certificates: ["Degree Certificate"],
    bank: { name: "Axis Bank", holder: "Ananya Nair", acct: "91800234567890", ifsc: "UTIB0004567", branch: "Koramangala, Bengaluru", pin: "560034" },
    fatherName: "Ramesh Nair", address: "4th Cross, Koramangala, Bengaluru 560034",
    emergencyName: "Ramesh Nair", emergencyRelation: "Father", personalEmail: "ananya.nair.dev@gmail.com",
  },
  {
    key: "ad", name: "Anita Desai", role: "HR Business Partner", dept: "Human Resources", empId: "JX-0512",
    email: "anita.desai@meridiansolar.com", mobile: "+91 97025 11890", manager: "CEO Office", doj: "3 Jan 2020",
    type: "Full-time", initials: "AD", tone: "var(--bos-pastel-lavender-ink)", status: "ACTIVE", statusTone: "emerald",
    cl: 9, sl: 7, el: 20, lop: 0, present: 22, absent: 1, late: 0, punchout: 0, bloodGroup: "O-",
    gross: "₹95,000", net: "₹83,100", documents: ["Offer Letter", "PAN Card", "Aadhaar Card"], certificates: [],
    bank: { name: "Kotak Mahindra Bank", holder: "Anita Desai", acct: "70234561239876", ifsc: "KKBK0005678", branch: "Indiranagar, Bengaluru", pin: "560038" },
    fatherName: "Prakash Desai", address: "100 Feet Road, Indiranagar, Bengaluru 560038",
    emergencyName: "Rajesh Desai", emergencyRelation: "Spouse", personalEmail: "anita.desai08@gmail.com",
  },
  {
    key: "vs", name: "Vikram Singh", role: "Site Engineer", dept: "Field Operations", empId: "JX-2411",
    email: "vikram.singh@meridiansolar.com", mobile: "+91 91234 56780", manager: "James Workman", doj: "4 May 2026",
    type: "Probation", initials: "VS", tone: "var(--bos-pastel-blue-ink)", status: "PROBATION", statusTone: "blue",
    cl: 1, sl: 1, el: 0, lop: 2, present: 18, absent: 0, late: 2, punchout: 5, bloodGroup: "B-",
    gross: "₹58,000", net: "₹52,400", documents: ["Offer Letter", "PAN Card"], certificates: [],
    bank: { name: "Punjab National Bank", holder: "Vikram Singh", acct: "40567891234123", ifsc: "PUNB0006789", branch: "Electronic City, Bengaluru", pin: "560100" },
    fatherName: "Harpal Singh", address: "Phase 2, Electronic City, Bengaluru 560100",
    emergencyName: "Harpal Singh", emergencyRelation: "Father", personalEmail: "vikram.singh99@gmail.com",
  },
];

export const EMPLOYEE_BY_KEY: Record<string, EmployeeRecord> = Object.fromEntries(EMPLOYEES.map((e) => [e.key, e]));

/** Department filter: label → the department name used on records. */
export const EMPLOYEE_DEPT_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "Accounts", label: "Accounts" },
  { value: "Human Resources", label: "HR Ops" },
  { value: "Admin", label: "Admin" },
  { value: "Marketing", label: "Marketing" },
  { value: "Sales", label: "Sales" },
  { value: "Service", label: "Service" },
  { value: "Projects", label: "Projects" },
  { value: "Engineering", label: "Engineering" },
  { value: "Inventory", label: "Inventory" },
  { value: "Products", label: "Products" },
];

/** Recent attendance rows shown on the employee detail Attendance tab. */
export const EMPLOYEE_ATTENDANCE = [
  { date: "27 Jul 2026", in: "09:02", out: "—", status: "PRESENT", tone: "emerald" as const },
  { date: "26 Jul 2026", in: "09:14", out: "18:22", status: "LATE", tone: "amber" as const },
  { date: "25 Jul 2026", in: "08:55", out: "18:05", status: "PRESENT", tone: "emerald" as const },
  { date: "24 Jul 2026", in: "—", out: "—", status: "ABSENT", tone: "coral" as const },
];

export const PAYROLL_MONTHS = ["July 2026", "June 2026", "May 2026"];
