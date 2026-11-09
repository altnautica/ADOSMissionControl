/**
 * @license GPL-3.0-only
 *
 * Flipping one layer switch or the depth style does not save the layout
 * class's default level as the vehicle's own: on a compact screen (Route by
 * default) a flip keeps the level following the class, so a later desktop
 * session opens at Full. A level the operator chose is kept.
 */

import { afterEach, describe, expect, it } from "vitest";

import { useCockpitLayersStore, vehicleLayers } from "@/stores/cockpit-layers-store";

const D = "layers-drone";
const level = () => {
  const s = useCockpitLayersStore.getState();
  return vehicleLayers(s.byVehicle, D, s.classDefault).level;
};

afterEach(() => useCockpitLayersStore.setState({ byVehicle: {}, classDefault: "full" }));

describe("cockpit layer level per vehicle", () => {
  it("keeps following the class default after a layer switch or depth change", () => {
    const st = useCockpitLayersStore.getState();
    st.setClassDefault("route");
    st.setLayer(D, "depth", false);
    st.setDepth(D, "outline", "2");
    expect(level()).toBe("route");
    useCockpitLayersStore.getState().setClassDefault("full");
    expect(level()).toBe("full");
    const v = vehicleLayers(useCockpitLayersStore.getState().byVehicle, D);
    expect(v.flips).toEqual({ depth: false });
    expect(v.depthStyle).toBe("outline");
  });

  it("keeps a level the operator chose across class changes", () => {
    const st = useCockpitLayersStore.getState();
    st.setClassDefault("route");
    st.setLevel(D, "instruments");
    st.setLayer(D, "depth", false);
    useCockpitLayersStore.getState().setClassDefault("full");
    expect(level()).toBe("instruments");
  });
});
