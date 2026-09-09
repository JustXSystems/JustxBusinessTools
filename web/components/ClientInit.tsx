"use client";

import { CapacitorInit } from "@/components/capacitor/CapacitorInit";
import { ClientCachePurge } from "@/components/ClientCachePurge";
import { AppFlashHost } from "@/components/AppFlashHost";
import { PwaRegister } from "@/components/pwa/PwaRegister";

export function ClientInit() {
  return (
    <>
      <ClientCachePurge />
      <PwaRegister />
      <CapacitorInit />
      <AppFlashHost />
    </>
  );
}
