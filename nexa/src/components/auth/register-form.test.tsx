import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  http,
  HttpResponse,
  renderWithProviders,
  screen,
  server,
} from "@/test";

import { RegisterForm } from "./register-form";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => "/register",
  useSearchParams: () => new URLSearchParams(),
}));

describe("RegisterForm", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  it("requires email and password but leaves name optional", () => {
    // Arrange / Act
    renderWithProviders(<RegisterForm />);

    // Assert
    expect(screen.getByLabelText(/Email/)).toBeRequired();
    expect(screen.getByLabelText("Password")).toBeRequired();
    expect(screen.getByLabelText(/Name/)).not.toBeRequired();
  });

  it("POSTs registration data and redirects home on success", async () => {
    // Arrange
    let body: unknown = null;
    server.use(
      http.post("*/api/auth/register", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = renderWithProviders(<RegisterForm />);

    // Act
    await user.type(screen.getByLabelText(/Name/), "Ada");
    await user.type(screen.getByLabelText(/Email/), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "longpassword");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert
    expect(body).toEqual({
      name: "Ada",
      email: "ada@example.com",
      password: "longpassword",
    });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the account-exists message on a 409", async () => {
    // Arrange
    server.use(
      http.post("*/api/auth/register", () =>
        HttpResponse.json({ error: "exists" }, { status: 409 }),
      ),
    );
    const { user } = renderWithProviders(<RegisterForm />);

    // Act
    await user.type(screen.getByLabelText(/Email/), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "longpassword");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with this email already exists",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the password-too-short message on a 400", async () => {
    // Arrange
    server.use(
      http.post("*/api/auth/register", () =>
        HttpResponse.json({ error: "short" }, { status: 400 }),
      ),
    );
    const { user } = renderWithProviders(<RegisterForm />);

    // Act
    await user.type(screen.getByLabelText(/Email/), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters",
    );
  });

  it("shows a generic message when the request throws", async () => {
    // Arrange
    server.use(http.post("*/api/auth/register", () => HttpResponse.error()));
    const { user } = renderWithProviders(<RegisterForm />);

    // Act
    await user.type(screen.getByLabelText(/Email/), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "longpassword");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );
  });

  it("disables the button and shows creating text while pending", async () => {
    // Arrange
    server.use(
      http.post(
        "*/api/auth/register",
        () => new Promise<HttpResponse<null>>(() => {}),
      ),
    );
    const { user } = renderWithProviders(<RegisterForm />);

    // Act
    await user.type(screen.getByLabelText(/Email/), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "longpassword");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert
    const button = await screen.findByRole("button", {
      name: "Creating account...",
    });
    expect(button).toBeDisabled();
  });
});
