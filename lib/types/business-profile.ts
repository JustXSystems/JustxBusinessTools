export type BusinessProfile = {
  id: number;
  logo: string | null;
  businessName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankUpi: string | null;
  terms: string | null;
};

export const EMPTY_PROFILE: BusinessProfile = {
  id: 1,
  logo: null,
  businessName: "",
  addressLine1: null,
  addressLine2: null,
  gstin: null,
  pan: null,
  state: null,
  stateCode: null,
  phone: null,
  email: null,
  bankName: null,
  bankBranch: null,
  bankAccount: null,
  bankIfsc: null,
  bankUpi: null,
  terms: null,
};

export const INDIAN_STATES: Array<[string, string]> = [
  ["Jammu and Kashmir", "01"], ["Himachal Pradesh", "02"], ["Punjab", "03"], ["Chandigarh", "04"],
  ["Uttarakhand", "05"], ["Haryana", "06"], ["Delhi", "07"], ["Rajasthan", "08"], ["Uttar Pradesh", "09"],
  ["Bihar", "10"], ["Sikkim", "11"], ["Arunachal Pradesh", "12"], ["Nagaland", "13"], ["Manipur", "14"],
  ["Mizoram", "15"], ["Tripura", "16"], ["Meghalaya", "17"], ["Assam", "18"], ["West Bengal", "19"],
  ["Jharkhand", "20"], ["Odisha", "21"], ["Chhattisgarh", "22"], ["Madhya Pradesh", "23"], ["Gujarat", "24"],
  ["Daman and Diu", "25"], ["Dadra and Nagar Haveli", "26"], ["Maharashtra", "27"], ["Andhra Pradesh", "28"],
  ["Karnataka", "29"], ["Goa", "30"], ["Lakshadweep", "31"], ["Kerala", "32"], ["Tamil Nadu", "33"],
  ["Puducherry", "34"], ["Andaman and Nicobar Islands", "35"], ["Telangana", "36"], ["Andhra Pradesh (New)", "37"],
  ["Ladakh", "38"],
];
