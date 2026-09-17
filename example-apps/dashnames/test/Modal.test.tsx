// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Modal } from "../src/components/Modal";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function RerenderingModal() {
  const [index, setIndex] = useState("0");
  return (
    <Modal open title="Test dialog" onClose={() => undefined}>
      <input
        aria-label="Identity index"
        type="number"
        min={0}
        value={index}
        onChange={(event) => setIndex(event.target.value)}
      />
    </Modal>
  );
}

describe("Modal", () => {
  it("preserves input focus when parent state changes", () => {
    render(<RerenderingModal />);
    const input = screen.getByLabelText("Identity index");
    input.focus();

    fireEvent.change(input, { target: { value: "1" } });

    expect(document.activeElement).toBe(input);
  });

  it("locks background scrolling while open and restores it on close", () => {
    document.body.style.overflow = "scroll";
    const view = render(
      <Modal open title="Test dialog" onClose={vi.fn()}>
        Content
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(
      <Modal open={false} title="Test dialog" onClose={vi.fn()}>
        Content
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("scroll");
  });
});
