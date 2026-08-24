import type { Appliance, LoadSummary } from "./types";

export const DEFAULT_APPLIANCES: Omit<Appliance, "id">[] = [
  { name: "Total Lights (LED)", icon: "bulb", qty: 8, watt: 10, hours: 6, on: true },
  { name: "Ceiling Fans", icon: "wind", qty: 4, watt: 75, hours: 8, on: true },
  { name: "Television", icon: "device-tv", qty: 1, watt: 120, hours: 5, on: true },
  { name: "Refrigerator", icon: "fridge", qty: 1, watt: 150, hours: 24, on: true },
  { name: "Washing Machine", icon: "wash", qty: 1, watt: 500, hours: 1, on: true },
  { name: "Geyser / Water Heater", icon: "droplet", qty: 1, watt: 2000, hours: 1, on: true },
  { name: "Oven / Microwave", icon: "toaster", qty: 1, watt: 1200, hours: 0.5, on: true },
  { name: "Air Conditioner", icon: "snowflake", qty: 0, watt: 1500, hours: 6, on: false },
  { name: "Computer / Desktop", icon: "device-desktop", qty: 0, watt: 200, hours: 4, on: false },
  { name: "Laptop", icon: "device-laptop", qty: 0, watt: 65, hours: 4, on: false },
  { name: "EV Charging", icon: "car", qty: 0, watt: 3300, hours: 3, on: false },
  { name: "Water Pump", icon: "gauge", qty: 1, watt: 750, hours: 1, on: true },
];

export function seedAppliances(uid: () => string): Appliance[] {
  return DEFAULT_APPLIANCES.map((a) => ({ ...a, id: uid() }));
}

export function computeLoadSummary(appliances: Appliance[]): LoadSummary {
  let connLoad = 0;
  let dailyUnits = 0;
  for (const a of appliances) {
    if (!a.on) continue;
    connLoad += (a.qty * a.watt) / 1000;
    dailyUnits += (a.qty * a.watt * a.hours) / 1000;
  }
  return {
    connLoad,
    dailyUnits,
    monthlyUnits: dailyUnits * 30,
  };
}

export function applianceSummaryLine(appliances: Appliance[]): string {
  return appliances
    .filter((a) => a.on && a.qty > 0)
    .map((a) => `${a.name} (${a.qty}x${a.watt}W, ${a.hours}h/day)`)
    .join("; ");
}
