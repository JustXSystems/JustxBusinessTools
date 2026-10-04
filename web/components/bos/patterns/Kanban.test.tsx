/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Kanban, type BosKanbanColumn } from "@/components/bos/patterns/Kanban";

const COLUMNS: BosKanbanColumn[] = [
  { id: "todo", title: "To do", cards: [{ id: "c1", title: "Draft offer letter" }] },
  { id: "doing", title: "In progress", cards: [] },
  { id: "done", title: "Done", cards: [] },
];

describe("Kanban touch fallback", () => {
  afterEach(cleanup);

  it("moves a card through the Move to… picker", () => {
    const onMove = vi.fn();
    render(<Kanban columns={COLUMNS} onMove={onMove} />);
    const picker = screen.getByLabelText("Move Draft offer letter to") as HTMLSelectElement;
    const targets = Array.from(picker.options)
      .filter((o) => !o.disabled)
      .map((o) => o.textContent);
    expect(targets).toEqual(["In progress", "Done"]);

    fireEvent.change(picker, { target: { value: "done" } });
    expect(onMove).toHaveBeenCalledWith("c1", "todo", "done");
  });

  it("renders no picker on read-only boards", () => {
    render(<Kanban columns={COLUMNS} />);
    expect(screen.queryByLabelText(/^Move /)).toBeNull();
  });
});
