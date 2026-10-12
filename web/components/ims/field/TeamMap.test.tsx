/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_MAP } from "@/lib/ims/fieldmap";
import { TeamMap, type MapMarker } from "./TeamMap";

const markers: MapMarker[] = [
  { id: "1", lat: 12.9716, lng: 77.5946, label: "Asha", color: "#1FA679", detail: "Active" },
  { id: "2", lat: 12.9352, lng: 77.6245, label: "Ravi", color: "#4C6FF5", detail: "At site" },
];

describe("TeamMap (built-in)", () => {
  it("draws every person and selects one on click or Enter", () => {
    const onSelect = vi.fn();
    render(<TeamMap settings={BUILTIN_MAP} markers={markers} selectedId="1" onSelect={onSelect} title="Team locations" />);
    expect(screen.getByRole("group", { name: "Team locations" })).toBeTruthy();
    const ravi = screen.getByRole("button", { name: /Ravi — At site/ });
    fireEvent.click(ravi);
    expect(onSelect).toHaveBeenCalledWith("2");
    fireEvent.keyDown(screen.getByRole("button", { name: /Asha/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("1");
    expect(screen.getByText(/positions only/)).toBeTruthy();
  });

  it("shows an empty state without positions", () => {
    render(<TeamMap settings={BUILTIN_MAP} markers={[]} title="Team locations" />);
    expect(screen.getByText("No location yet")).toBeTruthy();
  });
});
