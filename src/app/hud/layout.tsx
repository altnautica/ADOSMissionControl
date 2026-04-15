// HDMI kiosk / HUD route layout.
//
// This layout renders a full-screen container with no navbar, no sidebar,
// no CommandShell chrome. Root providers (ConvexClientProvider,
// LocaleProvider, ToastProvider) still wrap this subtree via
// src/app/layout.tsx. CommandShell short-circuits for /hud/* paths, so
// children here get the providers but none of the GCS UI.
//
// See product/specs/08-hdmi-kiosk-mode.md for the kiosk scope, and
// product/specs/09-joystick-input.md for gamepad integration.

export default function HudLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen bg-black text-white overflow-hidden">
      {children}
    </div>
  );
}
