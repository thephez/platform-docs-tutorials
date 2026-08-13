// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityChip } from "../src/components/IdentityChip";

afterEach(cleanup);

describe("IdentityChip", () => {
  it("renders the signed-in identity, balance, and responsive state", () => {
    const onClick = vi.fn();
    render(
      <IdentityChip
        name="stoppable-baguette3.dash"
        identityId="identity-1"
        balance={100_000_000_000n}
        onClick={onClick}
      />,
    );

    const chip = screen.getByRole("button", {
      name: /stoppable-baguette3/i,
    });
    expect(screen.queryByText(/\.dash/i)).toBeNull();
    expect(screen.getByText("1.000 Ð")).toBeTruthy();
    expect(chip.className).toContain("identity-chip--signed-in");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders an interactive sign-in action without signed-in metadata", () => {
    const onClick = vi.fn();
    render(
      <IdentityChip
        name={null}
        identityId={null}
        balance={null}
        onClick={onClick}
      />,
    );

    const chip = screen.getByRole("button", { name: "Sign in" });
    expect(chip.className).not.toContain("identity-chip--signed-in");
    expect(screen.queryByText(/Ð/)).toBeNull();
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
