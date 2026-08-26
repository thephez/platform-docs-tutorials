// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { NameCell } from "../src/components/NameCell";

afterEach(cleanup);

/**
 * History records carry only a `documentId`, never the label. Rendering that raw
 * ID under a column headed "Name" is misleading — it is neither a name nor an
 * identity — so the label is resolved separately and the ID is only a fallback.
 */
describe("NameCell", () => {
  it("renders the resolved name with its suffix", () => {
    render(
      <NameCell
        documentId="77XBBQME5ffYcyu5mbHfCVatFgB6Du6kQquzbj6QXG9Y"
        name={{ label: "alice", parentDomainName: "dash" }}
      />,
    );
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText(".dash")).toBeTruthy();
    // The raw document ID must not leak into the cell once resolved.
    expect(screen.queryByText(/77XB/)).toBeNull();
  });

  it("opens the document when rendered as a link", () => {
    const onClick = vi.fn();
    render(
      <NameCell
        documentId="77XBBQME5ffYcyu5mbHfCVatFgB6Du6kQquzbj6QXG9Y"
        name={{ label: "alice", parentDomainName: "dash" }}
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "alice.dash" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("falls back to a truncated document ID before the label resolves", () => {
    render(
      <NameCell
        documentId="77XBBQME5ffYcyu5mbHfCVatFgB6Du6kQquzbj6QXG9Y"
        name={null}
      />,
    );
    expect(screen.getByText("77XB…XG9Y")).toBeTruthy();
  });

  it("marks the fallback so it does not read as a name", () => {
    const { container } = render(
      <NameCell
        documentId="77XBBQME5ffYcyu5mbHfCVatFgB6Du6kQquzbj6QXG9Y"
        name={null}
      />,
    );
    const cell = container.querySelector(".data-table__cell-unresolved");
    expect(cell).not.toBeNull();
    // The full ID stays available on hover for anyone who needs it.
    expect(cell?.getAttribute("title")).toContain(
      "77XBBQME5ffYcyu5mbHfCVatFgB6Du6kQquzbj6QXG9Y",
    );
    // It must NOT carry the styling used for real names.
    expect(container.querySelector(".data-table__cell-name")).toBeNull();
  });
});
