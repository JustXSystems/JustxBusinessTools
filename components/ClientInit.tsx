"use client";

import { CapacitorInit } from "@/components/capacitor/CapacitorInit";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { PwaRegister } from "@/components/pwa/PwaRegister";

export function ClientInit() {
  return (
    <>
      <PwaRegister />
      <CapacitorInit />
      <InstallPrompt />
    </>
  );
}
