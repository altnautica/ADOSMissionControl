import { GeneralSection } from "@/components/config/GeneralSection";
import { LanguageSection } from "@/components/config/LanguageSection";

export default function ConfigurationPage() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl space-y-6">
        <GeneralSection />
        <LanguageSection />
      </div>
    </div>
  );
}
