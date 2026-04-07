import { OperatorProfileEditor } from "@/components/config/operator/OperatorProfileEditor";
import { AircraftRegistryEditor } from "@/components/config/operator/AircraftRegistryEditor";

export default function OperatorPage() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl flex flex-col gap-4">
        <div>
          <h1 className="text-sm font-display font-semibold text-text-primary">
            Operator &amp; Aircraft
          </h1>
          <p className="text-[11px] text-text-tertiary mt-1">
            Pilot, organisation, insurance, and aircraft registry. Used for
            compliance exports and the per-flight pilot &amp; aircraft snapshot.
          </p>
        </div>
        <OperatorProfileEditor />
        <AircraftRegistryEditor />
      </div>
    </div>
  );
}
