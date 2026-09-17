// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "../src/components/AppHeader";

afterEach(cleanup);

describe("AppHeader", () => {
  it("submits name search when the search icon is clicked", () => {
    const onSearchSubmit = vi.fn();

    render(
      <AppHeader
        view="discover"
        onNavigate={vi.fn()}
        showSearch
        searchValue="alice"
        onSearchChange={vi.fn()}
        onSearchSubmit={onSearchSubmit}
        identityName={null}
        identityId={null}
        balance={null}
        network="testnet"
        onNetworkChange={vi.fn()}
        onSettingsClick={vi.fn()}
        onIdentityClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit name search" }));
    expect(onSearchSubmit).toHaveBeenCalledOnce();
  });
});
