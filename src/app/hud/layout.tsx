// HDMI kiosk / HUD route layout.
//
// This layout renders a full-screen container with no navbar, no sidebar,
// no CommandShell chrome. Root providers (ConvexClientProvider,
// LocaleProvider, ToastProvider) still wrap this subtree via
// src/app/layout.tsx. CommandShell short-circuits for /hud/* paths: children
// here get the providers and the headless connection bridges (ShellBridges),
// but none of the GCS UI. The page drives a kiosk display attached to the
// node and reads a gamepad for input.

export default function HudLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen bg-media text-on-media overflow-hidden">
      {children}
    </div>
  );
}
