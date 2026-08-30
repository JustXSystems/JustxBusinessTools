"use client";

import { CapacitorInit } from "@/components/capacitor/CapacitorInit";
import { ClientCachePurge } from "@/components/ClientCachePurge";
import { PwaRegister } from "@/components/pwa/PwaRegister";

export function ClientInit() {
  return (
    <>
      <ClientCachePurge />
      <PwaRegister />
      <CapacitorInit />
    </>
  );
}
