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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, verifyPhoneOtp as verifyPhoneOtpApi } from "@/lib/api";
import {
  canAccessAdmin,
  canAccessPath,
  isPublicHomePreview,
  pathWithSearch,
  platformNeedsOperatorEnter,
} from "@/lib/auth-access";
import { clearSubscriptionSnapshot } from "@/lib/subscription-cache";
import { clearToolCart } from "@/lib/tool-cart";
import type { SessionUser } from "@/lib/types/auth";
import { EmptySplash, SplashMark } from "@/components/auth/SplashScreen";
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
  }) => Promise<
    | {
        pending: true;
        joinedExisting: boolean;
        email: string;
        title: string;
        message: string;
        detail: string;
      }
    | {
        pending: false;
        joinedExisting: false;
        email: string;
        user: SessionUser;
      }
  >;
  logout: () => Promise<void>;
  switchBranch: (profileId: number) => Promise<void>;
  /** Platform super: set operator Business Profile + optional act-as role. */
  setOperatorContext: (
    profileId: number,
    actAsRole: "owner" | "admin" | "staff" | "viewer" | null,
  ) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PREFIXES = ["/login", "/register", "/status", "/q", "/bom/proposal"];
/** Apps with their own sign-in screen (standalone BOS / IMS). Pinway requires JBT login + license. */
const SELF_GATED_ROOTS = ["/bos", "/ims"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    SELF_GATED_ROOTS.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  );
}

/** Paths guests may open without a session (includes marketing home at `/`). */
export function isGuestAllowedPath(pathname: string): boolean {
  return pathname === "/" || pathname === "" || isPublicPath(pathname);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { branding, loading: brandingLoading } = usePlatformBranding();

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: SessionUser }>("/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void refresh().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

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
      const data = await api<{
        pending: boolean;
        joinedExisting: boolean;
        email: string;
        title?: string;
        message?: string;
        detail?: string;
        user?: SessionUser;
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!data.pending && data.user) {
        setUser(data.user);
        return {
          pending: false as const,
          joinedExisting: false as const,
          email: data.email,
          user: data.user,
        };
      }
      return {
        pending: true as const,
        joinedExisting: Boolean(data.joinedExisting),
        email: data.email,
        title: data.title || "Awaiting approval",
        message: data.message || "Your request is awaiting approval.",
        detail: data.detail || data.message || "",
      };
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      clearSubscriptionSnapshot();
      clearToolCart();
      setUser(null);
      router.push("/login");
    }
  }, [router]);

  const applyOperatorUser = useCallback((next: SessionUser) => {
    setUser(next);
    clearSubscriptionSnapshot();
    try {
      window.dispatchEvent(new Event("jbt:auth-context-changed"));
    } catch {
      /* ignore */
    }
  }, []);

  const switchBranch = useCallback(
    async (profileId: number) => {
      const data = await api<{ user: SessionUser }>("/auth/switch-branch", {
        method: "POST",
        body: JSON.stringify({ businessProfileId: profileId }),
      });
      applyOperatorUser(data.user);
    },
    [applyOperatorUser],
  );

  const setOperatorContext = useCallback(
    async (
      profileId: number,
      actAsRole: "owner" | "admin" | "staff" | "viewer" | null,
    ) => {
      const data = await api<{ user: SessionUser }>("/auth/switch-branch", {
        method: "POST",
        body: JSON.stringify({ businessProfileId: profileId, actAsRole }),
      });
      applyOperatorUser(data.user);
    },
    [applyOperatorUser],
  );

  useEffect(() => {
    if (loading) return;
    const guestOk = isGuestAllowedPath(pathname);
    const isPublic = isPublicPath(pathname);
    if (!user && !guestOk) {
      router.replace(
        "/login?next=" + encodeURIComponent(pathWithSearch(pathname, searchParams)),
      );
    } else if (user && !canAccessAdmin(user) && pathname.startsWith("/admin")) {
      // Org users (incl. former org-admins) never use /admin — operator home.
      router.replace("/");
    } else if (
      user?.isPlatformAdmin &&
      user.actAsRole &&
      pathname.startsWith("/admin")
    ) {
      // Admin Console must not inherit Operator act-as / session org footguns.
      void setOperatorContext(user.businessProfileId, null).catch(() => undefined);
    } else if (user && platformNeedsOperatorEnter(user, pathname, searchParams)) {
      // Platform supers must pick profile + role on /enter before Operator chrome.
      router.replace(
        "/enter?next=" + encodeURIComponent(pathWithSearch(pathname || "/", searchParams)),
      );
    } else if (
      user &&
      !isPublic &&
      !isPublicHomePreview(pathname, searchParams) &&
      !canAccessPath(user, pathname)
    ) {
      // Keep operator act-as troubleshooting in the operator shell (do not bounce to /admin).
      router.replace("/");
    }
  }, [loading, user, pathname, searchParams, router, setOperatorContext]);

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
      setOperatorContext,
      refresh,
    }),
    [user, loading, login, verifyOtp, register, logout, switchBranch, setOperatorContext, refresh],
  );

  const guestOk = isGuestAllowedPath(pathname);
  const blocking = loading || (!user && !guestOk);

  return (
    <AuthContext.Provider value={value}>
      {blocking && !guestOk ? (
        brandingLoading ? <EmptySplash /> : <SplashMark branding={branding} />
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
