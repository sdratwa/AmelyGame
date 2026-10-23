import * as THREE from "three";

/**
 * Blask lampy widoczny z daleka: pojedynczy sprite (billboard) z addytywną teksturą miękkiej poświaty. To NIE jest
 * światło: nie oświetla niczego, nie zajmuje `PointLight`, kosztuje jeden draw call i może być widoczny nawet ze 150 m.
 * Tekstura jest generowana z danych (`DataTexture`), więc nie potrzebuje DOM ani plików.
 */

/** Piksele RGBA poświaty: biały kolor, alfa to promienisty zanik z jasnym rdzeniem (zero na brzegu, bez widocznego kwadratu). */
export function glowPixels(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - c, y - c) / c);
      const falloff = Math.pow(1 - r, 2.2);
      const core = Math.exp(-r * r * 40) * 0.5;
      const a = Math.min(1, falloff * 0.85 + core);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return data;
}

export function createGlowTexture(size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(glowPixels(size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Sprite blasku: addytywny, test głębi włączony (drzewa i skały go zasłaniają), mgła liczona ręcznie (`fogInteraction`). */
export function createGlowSprite(map: THREE.Texture): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map,
    color: 0xffa640,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "lantern-glow";
  sprite.renderOrder = 5;
  sprite.frustumCulled = true;
  sprite.visible = false;
  return sprite;
}
