import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  http,
  HttpResponse,
  renderWithProviders,
  screen,
  server,
} from "@/test";

import { LoginForm } from "./login-form";

// Stable router + controllable searchParams (for the redirect query).
const push = vi.fn();
const refresh = vi.fn();
let redirectParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () =>
    new URLSearchParams(redirectParam ? `redirect=${redirectParam}` : ""),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    redirectParam = null;
  });

  it("renders required email and password inputs", () => {
    // Arrange / Act
    renderWithProviders(<LoginForm />);

    // Assert
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    expect(email).toBeRequired();
    expect(password).toBeRequired();
    expect(password).toHaveAttribute("type", "password");
  });

  it("POSTs credentials and redirects to the safe redirect target on success", async () => {
    // Arrange
    redirectParam = "/dashboard";
    let body: unknown = null;
    server.use(
      http.post("*/api/auth/login", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = renderWithProviders(<LoginForm />);

    // Act
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Assert
    expect(body).toEqual({
      email: "user@example.com",
      password: "secret123",
    });
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a login-failed message on a non-OK response", async () => {
    // Arrange
    server.use(
      http.post("*/api/auth/login", () =>
        HttpResponse.json({ error: "bad" }, { status: 401 }),
      ),
    );
    const { user } = renderWithProviders(<LoginForm />);

    // Act
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent("Login failed");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a generic message when the request throws (network error)", async () => {
    // Arrange
    server.use(http.post("*/api/auth/login", () => HttpResponse.error()));
    const { user } = renderWithProviders(<LoginForm />);

    // Act
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );
  });

  it("shows the signing-in label while the request is pending", async () => {
    // Arrange: a never-resolving handler keeps loading=true.
    server.use(
      http.post(
        "*/api/auth/login",
        () => new Promise<HttpResponse<null>>(() => {}),
      ),
    );
    const { user } = renderWithProviders(<LoginForm />);

    // Act
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Assert
    const button = await screen.findByRole("button", { name: "Signing in..." });
    expect(button).toBeDisabled();
  });
});
