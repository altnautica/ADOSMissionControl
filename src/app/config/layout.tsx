import { ConfigNav } from "@/components/config/ConfigNav";

export default function ConfigLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
      <ConfigNav />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
