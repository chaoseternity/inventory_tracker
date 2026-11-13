import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { UsersManager } from "@/components/UsersManager";
import type { User } from "@/lib/types";

// Mock UserLink
jest.mock("@/components/UserLink", () => ({
  UserLink: ({ name }: { name: string }) => <span>{name}</span>,
}));

describe("UsersManager Component", () => {
  const users: User[] = [
    {
      id: 1,
      name: "Current Admin",
      email: "admin@school.edu",
      google_id: "g1",
      image: null,
      role: "admin",
      provider: "google",
      created_at: "2026-01-01",
    },
    {
      id: 2,
      name: "Dev Dave",
      email: "dev@school.edu",
      google_id: "g2",
      image: null,
      role: "developer",
      provider: "google",
      created_at: "2026-01-01",
    },
    {
      id: 3,
      name: "Regular Viewer",
      email: "viewer@school.edu",
      google_id: "g3",
      image: null,
      role: "viewer",
      provider: "google",
      created_at: "2026-01-01",
    },
  ];

  test("renders users and prevents editing or deleting developer accounts", () => {
    render(<UsersManager users={users} currentUserId="1" />);

    // Renders roles
    expect(screen.getByText("developer")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();

    // Dev Dave cannot be edited or deleted
    expect(screen.queryByLabelText("Edit role for Dev Dave")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete Dev Dave")).not.toBeInTheDocument();

    // Self cannot be edited or deleted
    expect(screen.queryByLabelText("Edit role for Current Admin")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete Current Admin")).not.toBeInTheDocument();

    // Regular Viewer can be edited
    const editBtn = screen.getByLabelText("Edit role for Regular Viewer");
    expect(editBtn).toBeInTheDocument();
  });

  test("role select dropdown only offers admin, verified, and viewer (developer is excluded)", () => {
    render(<UsersManager users={users} currentUserId="1" />);

    const editBtn = screen.getByLabelText("Edit role for Regular Viewer");
    fireEvent.click(editBtn);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeInTheDocument();

    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["admin", "verified", "viewer"]);
    expect(options).not.toContain("developer");
  });
});
