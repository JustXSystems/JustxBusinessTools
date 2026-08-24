"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, verifyPhoneOtp as verifyPhoneOtpApi } from "@/lib/api";
import { canAccessAdmin } from "@/lib/auth-access";
import type { SessionUser } from "@/lib/types/auth";
import { SplashMark } from "@/components/auth/SplashScreen";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  verifyOtp: (phone: string, code: string) => Promise<SessionUser>;
  register: (input: {
    email: string;
    password: string;
    name?: string;
    phone?: string;
    organizationName?: string;
    gstin?: string;
    businessName?: string;
    pan?: string;
    addressLine1?: string;
    addressLine2?: string;
    state?: string;
    stateCode?: string;
    businessPhone?: string;
    businessEmail?: string;
    logo?: string;
    homeToolIds?: string[];
  }) => Promise<void>;
  logout: () => Promise<void>;
  switchBranch: (profileId: number) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PREFIXES = ["/login", "/register"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const { branding } = usePlatformBranding();

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: SessionUser }>("/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    if (!user && !isPublic) {
      router.replace("/login?next=" + encodeURIComponent(pathname));
    } else if (user && !canAccessAdmin(user) && pathname.startsWith("/admin")) {
      router.replace("/");
    }
  }, [loading, user, pathname, router]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ user?: SessionUser } | undefined>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const user = data && typeof data === "object" && "user" in data ? data.user : undefined;
    if (!user) {
      throw new Error("Sign in succeeded but no user was returned");
    }
    setUser(user);
    return user;
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    const user = await verifyPhoneOtpApi(phone, code);
    setUser(user);
    return user;
  }, []);

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      name?: string;
      phone?: string;
      organizationName?: string;
      gstin?: string;
      businessName?: string;
      pan?: string;
      addressLine1?: string;
      addressLine2?: string;
      state?: string;
      stateCode?: string;
      businessPhone?: string;
      businessEmail?: string;
      logo?: string;
      homeToolIds?: string[];
    }) => {
      const data = await api<{ user: SessionUser; joinedExisting?: boolean }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setUser(data.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      router.push("/login");
    }
  }, [router]);

  const switchBranch = useCallback(async (profileId: number) => {
    const data = await api<{ user: SessionUser }>("/auth/switch-branch", {
      method: "POST",
      body: JSON.stringify({ businessProfileId: profileId }),
    });
    setUser(data.user);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAdmin: canAccessAdmin(user),
      isPlatformAdmin: Boolean(user?.isPlatformAdmin),
      login,
      verifyOtp,
      register,
      logout,
      switchBranch,
      refresh,
    }),
    [user, loading, login, verifyOtp, register, logout, switchBranch, refresh],
  );

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const blocking = loading || (!user && !isPublic);

  return (
    <AuthContext.Provider value={value}>
      {blocking && !isPublic ? <SplashMark branding={branding} /> : children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
