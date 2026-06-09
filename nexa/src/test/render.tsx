import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";

import { PostHogProvider } from "@/components/posthog-provider";
import { I18nProvider } from "@/i18n/provider";

// All app-wide client providers a component might transitively depend on.
// next/navigation is already globally mocked in vitest.setup.tsx, so it is not
// repeated here. PostHogProvider no-ops without NEXT_PUBLIC_POSTHOG_KEY.
function AllProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <PostHogProvider>{children}</PostHogProvider>
    </I18nProvider>
  );
}

export type RenderWithProvidersResult = RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
};

/**
 * RTL `render` wrapped in the app's client providers, plus a ready-to-use
 * `userEvent` instance. Use this for any component that touches i18n/posthog
 * context.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderWithProvidersResult {
  const user = userEvent.setup();
  const result = render(ui, { wrapper: AllProviders, ...options });
  return { ...result, user };
}

// Re-export the RTL surface so tests import everything from one place.
export * from "@testing-library/react";
export { userEvent };
