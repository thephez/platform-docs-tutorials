// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityLink } from "../src/components/IdentityLink";

afterEach(cleanup);

describe("IdentityLink", () => {
  it("opens an identity inside the app", () => {
    const onOpen = vi.fn();
    render(<IdentityLink id="identity-123" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("identity-123");
  });
});
