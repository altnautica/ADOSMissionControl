/**
 * @license GPL-3.0-only
 *
 * Render tests for DronePluginCard. Verifies the card renders the
 * plugin name, version, status pill, and the disable affordance for a
 * running plugin. Convex mutations are mocked because the card never
 * fires them at mount time.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render } from "@testing-library/react";
import messages from "../../../../../locales/en.json";

// lucide-react is mocked module-wide so the destructuring imports in
// TrustBadge / etc. resolve to stub components. We list the names the
// card surface actually pulls; everything else falls through to a
// generic stub.
vi.mock("lucide-react", () => {
  const stub = (name: string) =>
    function StubIcon(props: Record<string, unknown>) {
      return <span data-testid={`icon-${name}`} {...props} />;
    };
  return {
    __esModule: true,
    MoreHorizontal: stub("MoreHorizontal"),
    Settings: stub("Settings"),
    Trash2: stub("Trash2"),
    FileText: stub("FileText"),
    ShieldCheck: stub("ShieldCheck"),
    ShieldAlert: stub("ShieldAlert"),
    AlertTriangle: stub("AlertTriangle"),
    AlertOctagon: stub("AlertOctagon"),
    Power: stub("Power"),
    RotateCw: stub("RotateCw"),
    BadgeCheck: stub("BadgeCheck"),
    CheckCircle2: stub("CheckCircle2"),
    Code2: stub("Code2"),
    PackageOpen: stub("PackageOpen"),
    ShieldOff: stub("ShieldOff"),
    Star: stub("Star"),
    Loader2: stub("Loader2"),
    X: stub("X"),
  };
});

// Convex mutation hook returns a no-op function. The card never
// awaits it at mount time so the tests can use the synchronous stub.
// `useQuery` is stubbed too: the card watches the command-ack row via
// `useConvexSkipQuery` (which calls `useQuery`), but with no command in
// flight at mount the query is skipped and resolves to undefined.
vi.mock("convex/react", () => ({
  useMutation: () => async () => null,
  useQuery: () => undefined,
}));

// Toast hook returns a stub recorder.
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// next/link renders the children directly so the underlying button
// surfaces in the rendered DOM.
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DronePluginCard, type DronePluginCardData } from "../DronePluginCard";

function makeInstall(
  overrides: Partial<DronePluginCardData> = {},
): DronePluginCardData {
  return {
    installId: "install-1",
    deviceId: "device-1",
    pluginId: "com.example.alpha",
    version: "1.0.0",
    name: "Example Alpha",
    source: "local_file",
    signerId: "altnautica-2026-A",
    status: "running",
    halves: ["agent", "gcs"],
    ...overrides,
  };
}

function renderCard(install: DronePluginCardData) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DronePluginCard install={install} />
    </NextIntlClientProvider>,
  );
}

describe("DronePluginCard", () => {
  it("renders plugin name and version", () => {
    const { getByText } = renderCard(makeInstall());
    expect(getByText("Example Alpha")).toBeDefined();
    expect(getByText("v1.0.0")).toBeDefined();
  });

  it("renders the Disable affordance when the plugin is running", () => {
    const { getByText } = renderCard(makeInstall({ status: "running" }));
    expect(getByText("Disable")).toBeDefined();
  });

  it("renders the Enable affordance when the plugin is disabled", () => {
    const { getByText } = renderCard(makeInstall({ status: "disabled" }));
    expect(getByText("Enable")).toBeDefined();
  });

  it("renders the Crashed status pill when the plugin crashed", () => {
    const { getByText } = renderCard(makeInstall({ status: "crashed" }));
    expect(getByText("Crashed")).toBeDefined();
  });

  it("renders no trust badge for a stored signer id", () => {
    // `install.signerId` is a client-supplied column on `recordInstall` with no
    // server-side enrolled-key check, so it is a declared value rather than a
    // verification result. The card must not turn it into a Signed / Verified /
    // First-party badge — the archive signature is verified at install time and
    // badged by the install pop-up instead.
    const { queryByTitle } = renderCard(
      makeInstall({ signerId: "altnautica-2026-A" }),
    );
    expect(queryByTitle(/first-party/i)).toBeNull();
    expect(queryByTitle(/Ed25519 signature/i)).toBeNull();
    expect(queryByTitle(/first-party allowlist/i)).toBeNull();
  });
});
