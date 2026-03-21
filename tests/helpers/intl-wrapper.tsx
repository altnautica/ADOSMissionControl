import { NextIntlClientProvider } from "next-intl";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import messages from "../../locales/en.json";

function IntlWrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export function renderWithIntl(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) {
  return render(ui, { wrapper: IntlWrapper, ...options });
}
