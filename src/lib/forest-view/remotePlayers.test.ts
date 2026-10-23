import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, withAppearance } from "@/lib/character";
import { loadTestPlayer } from "@/lib/tpp/testkit";
import { idleMotion, type Player } from "@/lib/multiplayer/protocol";
import { AppearanceRig } from "./appearance/appearanceRig";
import { PlayerModel } from "./playerModel";
import { RemotePlayers, createRemoteTemplate } from "./remotePlayers";

const player = (id: string): Player => ({ ...idleMotion(0, 0, 0), playerId: id, sessionId: id, name: id, lanternOn: false });

/** Kolory siatek `appearance-*` w całym drzewie sceny (ubrania i włosy), w kolejności przejścia. */
const outfitColors = (root: THREE.Object3D) => {
  const colors: Record<string, string> = {};
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && o.name.startsWith("appearance-")) colors[o.name] = (mesh.material as THREE.MeshStandardMaterial).color.getHexString();
  });
  return colors;
};

describe("gracze zdalni mają własny wygląd", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillText() {} }) }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("kolor lokalnego gracza nie przechodzi na zdalnych, a kolor zdalnego nie na innych ani na lokalnego", async () => {
    const source = await loadTestPlayer();
    // Wzorzec robiony przed założeniem rigu lokalnemu (tak jak w rendererze).
    const template = createRemoteTemplate(source);
    const localModel = new PlayerModel(source, { castShadow: false, receiveShadow: false });
    const local = new AppearanceRig(source);
    const red = withAppearance(DEFAULT_APPEARANCE, { topColor: "#ff0000" });
    local.apply(red);

    const scene = new THREE.Scene();
    const remote = new RemotePlayers(scene, template);
    const blue = withAppearance(DEFAULT_APPEARANCE, { topColor: "#0000ff" });
    remote.update([player("a"), player("b")], 0.016, { b: blue });

    const models = scene.children.map((c) => c);
    expect(models).toHaveLength(2);
    const [a, b] = models;
    // Zdalny bez wpisu ma wygląd domyślny (nie czerwony lokalnego), zdalny z wpisem ma własny niebieski.
    expect(outfitColors(a)["appearance-top.01"]).toBe("4f8f5a");
    expect(outfitColors(b)["appearance-top.01"]).toBe("0000ff");
    expect(outfitColors(localModel.group)["appearance-top.01"]).toBe("ff0000");

    // Zmiana wyglądu jednego gracza zdalnego nie rusza pozostałych ani lokalnego.
    remote.update([player("a"), player("b")], 0.016, { a: withAppearance(DEFAULT_APPEARANCE, { topColor: "#00ff00" }), b: blue });
    expect(outfitColors(a)["appearance-top.01"]).toBe("00ff00");
    expect(outfitColors(b)["appearance-top.01"]).toBe("0000ff");
    expect(outfitColors(localModel.group)["appearance-top.01"]).toBe("ff0000");

    // Maska ciała lokalnego nie wpływa na geometrię zdalnych i odwrotnie.
    const index = (o: THREE.Object3D) => {
      let skinned: THREE.SkinnedMesh | undefined;
      o.traverse((n) => {
        if ((n as THREE.SkinnedMesh).isSkinnedMesh && !n.name.startsWith("appearance-")) skinned = n as THREE.SkinnedMesh;
      });
      return skinned!.geometry;
    };
    expect(index(a)).not.toBe(index(b));
    expect(index(a)).not.toBe(source.skinned.geometry);

    remote.dispose();
    local.dispose();
  });
});
