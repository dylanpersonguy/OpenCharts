import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton, TableSkeleton, CardSkeleton } from "@/components/ui/skeleton";

describe("Badge", () => {
  it("renders with text", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies variant class", () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText("Success");
    expect(badge.className).toContain("success");
  });

  it("applies custom className", () => {
    render(<Badge className="my-badge">Test</Badge>);
    expect(screen.getByText("Test").className).toContain("my-badge");
  });

  it("renders default variant", () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText("Default");
    expect(badge.className).toContain("bg-primary");
  });
});

describe("Input", () => {
  it("renders with placeholder", () => {
    render(<Input placeholder="Enter email" />);
    expect(screen.getByPlaceholderText("Enter email")).toBeInTheDocument();
  });

  it("renders with type", () => {
    render(<Input type="password" placeholder="Password" />);
    const input = screen.getByPlaceholderText("Password");
    expect(input).toHaveAttribute("type", "password");
  });

  it("is disabled when disabled prop is set", () => {
    render(<Input disabled placeholder="Disabled" />);
    expect(screen.getByPlaceholderText("Disabled")).toBeDisabled();
  });

  it("applies custom className", () => {
    render(<Input className="custom-input" placeholder="Test" />);
    expect(screen.getByPlaceholderText("Test").className).toContain("custom-input");
  });
});

describe("Card", () => {
  it("renders card with header and content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Test Title</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Card body</p>
        </CardContent>
      </Card>,
    );
    expect(screen.getByText("Test Title")).toBeInTheDocument();
    expect(screen.getByText("Card body")).toBeInTheDocument();
  });

  it("applies custom className to Card", () => {
    render(<Card className="my-card" data-testid="card" />);
    expect(screen.getByTestId("card").className).toContain("my-card");
  });
});

describe("Skeleton", () => {
  it("renders skeleton div", () => {
    render(<Skeleton data-testid="skel" />);
    const skel = screen.getByTestId("skel");
    expect(skel).toBeInTheDocument();
    expect(skel.className).toContain("animate-skeleton-pulse");
  });

  it("renders TableSkeleton with correct rows", () => {
    const { container } = render(<TableSkeleton rows={3} cols={2} />);
    // 1 header row + 3 body rows
    const flexRows = container.querySelectorAll(".flex.gap-4");
    expect(flexRows.length).toBe(4);
  });

  it("renders CardSkeleton", () => {
    const { container } = render(<CardSkeleton />);
    expect(container.querySelector(".rounded-lg")).toBeTruthy();
  });
});
