import type { OfflineMutation } from "./types";
import { OFFLINE_QUEUE_KEY } from "./types";

function readQueue(): OfflineMutation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: OfflineMutation[]): void {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

export function listOfflineMutations(): OfflineMutation[] {
  return readQueue();
}

export function enqueueOfflineMutation(
  mutation: Omit<OfflineMutation, "createdAt" | "retries">,
): OfflineMutation {
  const entry: OfflineMutation = {
    ...mutation,
    createdAt: Date.now(),
    retries: 0,
  };
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
  return entry;
}

export function removeOfflineMutation(id: string): void {
  writeQueue(readQueue().filter((m) => m.id !== id));
}

export function markOfflineMutationFailed(id: string, error: string): void {
  const queue = readQueue().map((m) =>
    m.id === id ? { ...m, retries: m.retries + 1, lastError: error } : m,
  );
  writeQueue(queue);
}

export function clearOfflineQueue(): void {
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export function offlineQueueCount(): number {
  return readQueue().length;
}
