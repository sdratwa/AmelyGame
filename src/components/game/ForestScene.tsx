"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Season } from "@/lib/game/engine";
import { mulberry32 } from "@/lib/game/core/rng";

export type MoveInput = {
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
};

export const emptyInput = (): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
});

const FOREST_RADIUS = 52;

const PALETTE: Record<
  Season,
  { ground: string; conifer: string; round: string; trunk: string }
> = {
  winter: { ground: "#eef4fa", conifer: "#2d6a4f", round: "#dfe8f2", trunk: "#5b4636" },
  spring: { ground: "#6fb85a", conifer: "#3f9a4a", round: "#8fd16b", trunk: "#6b4b32" },
  summer: { ground: "#4c9a3e", conifer: "#27743a", round: "#3f9e48", trunk: "#5e4029" },
  autumn: { ground: "#a8844a", conifer: "#3d6b3d", round: "#d9822b", trunk: "#5b3d27" },
};

type Tree = { x: number; z: number; s: number; round: boolean };

function makeTrees(): Tree[] {
  const rnd = mulberry32(2030);
  const trees: Tree[] = [];
  const place = (minR: number, maxR: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = minR + Math.sqrt(rnd()) * (maxR - minR);
      trees.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        s: 0.8 + rnd() * 0.9,
        round: rnd() > 0.6,
      });
    }
  };
  place(5, FOREST_RADIUS, 230);
  place(FOREST_RADIUS, FOREST_RADIUS + 8, 120);
  return trees;
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

function fillInstances(mesh: THREE.InstancedMesh | null, list: Tree[], height: number) {
  if (!mesh) return;
  list.forEach((t, i) => {
    tmpPos.set(t.x, height * t.s, t.z);
    tmpScale.set(t.s, t.s, t.s);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(i, tmpMatrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function Forest({ season, trees }: { season: Season; trees: Tree[] }) {
  const conifers = useMemo(() => trees.filter((t) => !t.round), [trees]);
  const rounds = useMemo(() => trees.filter((t) => t.round), [trees]);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const coneARef = useRef<THREE.InstancedMesh>(null);
  const coneBRef = useRef<THREE.InstancedMesh>(null);
  const snowRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const palette = PALETTE[season];

  useLayoutEffect(() => {
    fillInstances(trunkRef.current, trees, 1.1);
    fillInstances(coneARef.current, conifers, 2.6);
    fillInstances(coneBRef.current, conifers, 4.0);
    fillInstances(snowRef.current, conifers, 4.55);
    fillInstances(crownRef.current, rounds, 3.2);
  }, [trees, conifers, rounds]);

  return (
    <>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, trees.length]} frustumCulled={false}>
        <cylinderGeometry args={[0.18, 0.3, 2.2, 6]} />
        <meshStandardMaterial color={palette.trunk} />
      </instancedMesh>
      <instancedMesh ref={coneARef} args={[undefined, undefined, conifers.length]} frustumCulled={false}>
        <coneGeometry args={[1.5, 2.6, 8]} />
        <meshStandardMaterial color={palette.conifer} />
      </instancedMesh>
      <instancedMesh ref={coneBRef} args={[undefined, undefined, conifers.length]} frustumCulled={false}>
        <coneGeometry args={[1.1, 2.2, 8]} />
        <meshStandardMaterial color={palette.conifer} />
      </instancedMesh>
      <instancedMesh
        ref={snowRef}
        args={[undefined, undefined, conifers.length]}
        frustumCulled={false}
        visible={season === "winter"}
      >
        <coneGeometry args={[0.55, 0.9, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[undefined, undefined, rounds.length]} frustumCulled={false}>
        <icosahedronGeometry args={[1.7, 1]} />
        <meshStandardMaterial color={palette.round} flatShading />
      </instancedMesh>
    </>
  );
}

function Snowfall({ active }: { active: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const count = 700;
  const positions = useMemo(() => {
    const rnd = mulberry32(7);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rnd() - 0.5) * 40;
      arr[i * 3 + 1] = rnd() * 14;
      arr[i * 3 + 2] = (rnd() - 0.5) * 40;
    }
    return arr;
  }, []);
  const { camera } = useThree();

  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts || !active) return;
    pts.position.set(camera.position.x, 0, camera.position.z);
    const attr = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = attr.getY(i) - dt * 1.4;
      if (y < 0) y += 14;
      attr.setY(i, y);
      attr.setX(i, attr.getX(i) + Math.sin(y * 1.3 + i) * dt * 0.25);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} visible={active} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={0.12} sizeAttenuation transparent opacity={0.9} />
    </points>
  );
}

function Player({ input, trees }: { input: React.RefObject<MoveInput>; trees: Tree[] }) {
  const { camera } = useThree();
  const yaw = useRef(0);
  const bob = useRef(0);

  useEffect(() => {
    camera.position.set(0, 1.7, 0);
  }, [camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const i = input.current;
    const turn = (Number(i.turnLeft) - Number(i.turnRight)) * 1.9 * dt;
    yaw.current += turn;
    const f = Number(i.forward) - Number(i.back);
    const s = Number(i.strafeRight) - Number(i.strafeLeft);
    const speed = 4.2;
    const sin = Math.sin(yaw.current);
    const cos = Math.cos(yaw.current);
    let dx = (-sin * f + cos * s) * speed * dt;
    let dz = (-cos * f - sin * s) * speed * dt;
    if (f !== 0 && s !== 0) {
      dx *= Math.SQRT1_2;
      dz *= Math.SQRT1_2;
    }
    let x = camera.position.x + dx;
    let z = camera.position.z + dz;
    for (const t of trees) {
      const ddx = x - t.x;
      const ddz = z - t.z;
      const min = 0.35 * t.s + 0.45;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.001;
        x = t.x + (ddx / d) * min;
        z = t.z + (ddz / d) * min;
      }
    }
    const r = Math.hypot(x, z);
    if (r > FOREST_RADIUS - 1) {
      x *= (FOREST_RADIUS - 1) / r;
      z *= (FOREST_RADIUS - 1) / r;
    }
    const moving = f !== 0 || s !== 0;
    if (moving) bob.current += dt * 9;
    camera.position.set(x, 1.7 + (moving ? Math.sin(bob.current) * 0.05 : 0), z);
    camera.rotation.set(0, yaw.current, 0, "YXZ");
  });

  return null;
}

function Atmosphere({ isDay, season }: { isDay: boolean; season: Season }) {
  const sky = isDay ? (season === "winter" ? "#cfdeea" : "#8fc8f0") : "#050a1c";
  return (
    <>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, isDay ? 12 : 4, isDay ? 48 : 30]} />
      <ambientLight intensity={isDay ? 1.05 : 0.5} color={isDay ? "#ffffff" : "#6f86d6"} />
      <directionalLight
        position={[10, 20, 6]}
        intensity={isDay ? 1.6 : 0.5}
        color={isDay ? "#fff4d6" : "#8aa4ff"}
      />
      <hemisphereLight args={[isDay ? "#cfe8ff" : "#16224d", "#445", isDay ? 0.4 : 0.25]} />
    </>
  );
}

export default function ForestScene({
  season,
  isDay,
  input,
}: {
  season: Season;
  isDay: boolean;
  input: React.RefObject<MoveInput>;
}) {
  const trees = useMemo(() => makeTrees(), []);
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 72, near: 0.1, far: 120, position: [0, 1.7, 0] }}
      gl={{ antialias: true }}
      style={{ touchAction: "none" }}
    >
      <Atmosphere isDay={isDay} season={season} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <circleGeometry args={[FOREST_RADIUS + 14, 48]} />
        <meshStandardMaterial color={PALETTE[season].ground} />
      </mesh>
      <Forest season={season} trees={trees} />
      <Snowfall active={season === "winter"} />
      <Player input={input} trees={trees} />
    </Canvas>
  );
}
