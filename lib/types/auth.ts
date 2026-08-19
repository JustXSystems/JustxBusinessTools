export type SessionUser = {
  id: number;
  email: string;
  name: string | null;
  phone?: string | null;
  role: "owner" | "admin" | "staff" | "viewer";
  organizationId: number;
  organizationName: string;
  businessProfileId: number;
  branches: Array<{
    id: number;
    businessName: string;
    gstin: string | null;
    isDefault: boolean;
  }>;
};
