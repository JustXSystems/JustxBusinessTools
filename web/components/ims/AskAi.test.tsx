/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RichText } from "@/components/ims/AskAi";

describe("RichText", () => {
  it("renders paragraphs, bullet lists and bold text", () => {
    const { container } = render(<RichText text={"**3 items** are low.\n- Bolt — 0 left\n- Nut — 3 left\nDone."} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("3 items");
  });

  it("never renders HTML from an answer", () => {
    const { container } = render(<RichText text={'<img src=x onerror="alert(1)"> **<b>hi</b>**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });
});
