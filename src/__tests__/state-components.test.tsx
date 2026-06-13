import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No data found" />);
    expect(screen.getByText("No data found")).toBeInTheDocument();
  });

  it("renders description", () => {
    render(<EmptyState title="Empty" description="There are no records yet." />);
    expect(screen.getByText("There are no records yet.")).toBeInTheDocument();
  });

  it("renders custom action", () => {
    render(<EmptyState title="Empty" action={<button>Create New</button>} />);
    expect(screen.getByRole("button", { name: "Create New" })).toBeInTheDocument();
  });

  it("renders default icon when none provided", () => {
    const { container } = render(<EmptyState title="Empty" />);
    // Default is Inbox icon (an SVG)
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders custom icon", () => {
    render(<EmptyState title="Empty" icon={<span data-testid="custom-icon">★</span>} />);
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders default title", () => {
    render(<ErrorState />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders custom title", () => {
    render(<ErrorState title="Network Error" />);
    expect(screen.getByText("Network Error")).toBeInTheDocument();
  });

  it("renders message", () => {
    render(<ErrorState message="Please try again later" />);
    expect(screen.getByText("Please try again later")).toBeInTheDocument();
  });

  it("shows retry button when onRetry is provided", () => {
    render(<ErrorState onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("does not show retry button without onRetry", () => {
    render(<ErrorState />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onRetry when retry is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
