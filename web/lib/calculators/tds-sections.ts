export type TdsSection = { code: string; rate: number };

export const TDS_SECTIONS: TdsSection[] = [
  { code: "194C - Contractor (Individual/HUF)", rate: 1 },
  { code: "194C - Contractor (Others)", rate: 2 },
  { code: "194J - Professional/Technical Fees", rate: 10 },
  { code: "194I - Rent (Plant/Machinery)", rate: 2 },
  { code: "194I - Rent (Land/Building)", rate: 10 },
  { code: "194H - Commission/Brokerage", rate: 5 },
  { code: "194Q - Purchase of Goods", rate: 0.1 },
  { code: "Custom Rate", rate: 0 },
];
