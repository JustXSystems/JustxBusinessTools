export type SessionUser = {
  id: number;
  email: string;
  name: string | null;
  phone?: string | null;
  role: "owner" | "admin" | "staff" | "viewer";
  organizationId: number;
  organizationName: string;
  businessProfileId: number;
  isPlatformAdmin?: boolean;
  /** Platform super only — operator act-as role for troubleshooting. */
  actAsRole?: "owner" | "admin" | "staff" | "viewer" | null;
  branches: Array<{
    id: number;
    businessName: string;
    gstin: string | null;
    isDefault: boolean;
    organizationId?: number;
    organizationName?: string | null;
    /** From business_profile_meta — used by /enter to hide pending/archived by default. */
    approvalStatus?: string;
    archivedAt?: string | null;
  }>;
};
