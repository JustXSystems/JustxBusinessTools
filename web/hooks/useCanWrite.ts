"use client";

import { useAuth } from "@/components/auth/AuthProvider";

/** Legacy sessions (no login) can write; viewers are read-only. */
export function useCanWrite(): boolean {
  const { user } = useAuth();
  if (!user) return true;
  return user.role !== "viewer";
}
