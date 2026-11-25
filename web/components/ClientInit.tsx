"use client";

import { CapacitorInit } from "@/components/capacitor/CapacitorInit";
import { ClientCachePurge } from "@/components/ClientCachePurge";
import { AppFlashHost } from "@/components/AppFlashHost";
import { PhoneViewportLock } from "@/components/PhoneViewportLock";
import { PwaRegister } from "@/components/pwa/PwaRegister";

export function ClientInit() {
  return (
    <>
      <PhoneViewportLock />
      <ClientCachePurge />
      <PwaRegister />
      <CapacitorInit />
      <AppFlashHost />
    </>
  );
}
