import type { Metadata } from "next";
import "./globals.css";
import { CommandShell } from "@/components/layout/CommandShell";
import { ToastProvider } from "@/components/ui/toast";
import { LocaleProvider } from "@/components/layout/LocaleProvider";
import ConvexClientProvider from "./ConvexClientProvider";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";

// Force all pages to render dynamically (no static prerendering).
// This app is a fully interactive GCS — every page needs client-side
// providers (ConvexProvider, Zustand stores, etc.) that are unavailable
// during static build. Without this, `next build` fails when
// NEXT_PUBLIC_CONVEX_URL is not set (e.g. CI environments).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ADOS Mission Control",
  description: "Open-source Ground Control Station by Altnautica",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const content = (
    <LocaleProvider>
      <ToastProvider>
        <CommandShell>{children}</CommandShell>
      </ToastProvider>
    </LocaleProvider>
  );

  const body = (
    <html lang="en" className="dark">
      <body className="h-dvh overflow-hidden bg-bg-primary text-text-primary font-body">
        <ConvexClientProvider>
          {content}
        </ConvexClientProvider>
      </body>
    </html>
  );

  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <ConvexAuthNextjsServerProvider>
        {body}
      </ConvexAuthNextjsServerProvider>
    );
  }

  return body;
}
