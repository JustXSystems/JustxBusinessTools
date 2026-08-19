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
import type { SessionUser } from "@/lib/types/auth";

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  verifyOtp: (phone: string, code: string) => Promise<SessionUser>;
  register: (input: {
    email: string;
    password: string;
    name?: string;
    organizationName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  switchBranch: (profileId: number) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PREFIXES = ["/login"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

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
    if (!user && !isPublic && pathname.startsWith("/admin")) {
      router.replace("/login?next=" + encodeURIComponent(pathname));
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
      organizationName?: string;
    }) => {
      const data = await api<{ user: SessionUser }>("/auth/register", {
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
      isAdmin: user?.role === "owner" || user?.role === "admin",
      login,
      verifyOtp,
      register,
      logout,
      switchBranch,
      refresh,
    }),
    [user, loading, login, verifyOtp, register, logout, switchBranch, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
