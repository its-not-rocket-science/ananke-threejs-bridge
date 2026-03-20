# ananke-threejs-bridge

![Ananke version](https://img.shields.io/badge/ananke-0.1.0-6366f1)
![Three.js](https://img.shields.io/badge/Three.js-r165%2B-000000?logo=threedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.x-646cff?logo=vite&logoColor=white)
![Browser](https://img.shields.io/badge/browser-Chrome%20%7C%20Firefox%20%7C%20Safari-4285f4)
![Status](https://img.shields.io/badge/status-wanted-lightgrey)

Ananke running entirely in the browser, rendered with Three.js/WebGL. No server, no sidecar, no install — just a bundled single-page application. Once complete, it will be listed in [Ananke's ecosystem.md](https://github.com/its-not-rocket-science/ananke/blob/master/docs/ecosystem.md).

---

## Table of contents

1. [Purpose](#purpose)
2. [Prerequisites](#prerequisites)
3. [Architecture](#architecture)
4. [What gets built](#what-gets-built)
5. [Quick start](#quick-start)
6. [File layout](#file-layout)
7. [Fixed-point to Three.js units](#fixed-point-to-threejs-units)
8. [Ananke API surface used](#ananke-api-surface-used)
9. [Tick interpolation strategy](#tick-interpolation-strategy)
10. [Bundle size](#bundle-size)
11. [Demo scene](#demo-scene)
12. [Contributing](#contributing)

---

## Purpose

The Godot and Unity reference implementations require a game engine install and a running Node.js sidecar. This project has neither requirement. Ananke is pure TypeScript with zero runtime dependencies, so it bundles cleanly with Vite (or esbuild) into a single JavaScript file that any browser can run.

The result is the lowest-friction way to demonstrate Ananke: share a URL, open a browser, see physics-grounded combat.

---

## Prerequisites

| Dependency | Minimum version | Notes |
|-----------|----------------|-------|
| Node.js | 18 | Build tooling only; not in the browser bundle |
| npm | 9 | Bundled with Node.js 18 |
| Ananke | 0.1.0 | Cloned alongside this repo |

Clone Ananke into a sibling directory before cloning this project:

```
workspace/
  ananke/                     ← https://github.com/its-not-rocket-science/ananke
  ananke-threejs-bridge/      ← this repo
```

The build resolves Ananke via a path alias in `vite.config.ts`. No server-side Node.js is needed at runtime.

---

## Architecture

Everything runs in a single browser tab. The Ananke kernel and Three.js share the same JS thread. A `setInterval` drives the 20 Hz simulation loop; `requestAnimationFrame` drives the render loop.

```
Browser (single tab)
│
├── Simulation loop (setInterval, 50 ms)
│   ├── stepWorld(world, cmds, ctx)
│   ├── extractRigSnapshots(world)      → TickSnapshot[]
│   ├── deriveAnimationHints(entity)    → AnimationHints
│   ├── derivePoseModifiers(entity)     → PoseModifier[]
│   └── deriveGrappleConstraint(...)    → GrappleConstraint | null
│       │
│       └── pushes snapshot to InterpolationBuffer
│
└── Render loop (requestAnimationFrame, display Hz)
    ├── InterpolationBuffer.getState(entityId, now)
    ├── SegmentBoneMapper.apply(state, skeleton)
    ├── AnimationClipBlender.apply(hints, mixer)
    └── renderer.render(scene, camera)
```

There is no worker thread in the initial implementation. The simulation runs synchronously on the main thread. For scenarios with more than ~50 entities, consider moving `stepWorld` to a Web Worker with `postMessage` frame transfer.

---

## What gets built

### Skeleton approach

Three.js uses `THREE.Skeleton` + `THREE.SkinnedMesh`. Each bone in the skeleton corresponds to one Ananke segment. `SegmentBoneMapper.ts` maps segment IDs to bone indices:

```typescript
// SegmentBoneMapper.ts
const SEGMENT_BONE_INDEX: Record<string, number> = {
  torso:    0,
  head:     1,
  leftArm:  2,
  rightArm: 3,
  leftLeg:  4,
  rightLeg: 5,
};

export function applySnapshot(snapshot: RigSnapshot, skeleton: THREE.Skeleton): void {
  for (const seg of snapshot.segments) {
    const boneIdx = SEGMENT_BONE_INDEX[seg.segmentId];
    if (boneIdx === undefined) continue;
    const bone = skeleton.bones[boneIdx];
    bone.position.set(
      seg.position_Sm.x / SCALE.m,
      seg.position_Sm.y / SCALE.m,
      (seg.position_Sm.z ?? 0) / SCALE.m,
    );
  }
}
```

### AnimationHints → Three.js animation clip blending

`AnimationClipBlender.ts` uses a `THREE.AnimationMixer` to blend between named clips:

```typescript
export function applyHints(hints: AnimationHints, mixer: THREE.AnimationMixer): void {
  // Fade to the primary state clip over 0.1 s
  const clip = mixer.clipAction(hints.primaryState);
  clip.fadeIn(0.1);
  // Scale injury morph targets
  mesh.morphTargetInfluences[0] = hints.injuryWeight / SCALE.Q;
}
```

The bridge ships with a minimal GLTF character model that has idle, attack, prone, and unconscious clips. Bring your own model and map clip names in `config.ts`.

### Camera rig

`CameraRig.ts` keeps both characters in frame with a simple look-at constraint. It tracks the midpoint between the two entity positions and orbits at a fixed distance.

---

## Quick start

```bash
# 1. Clone Ananke and build it
git clone https://github.com/its-not-rocket-science/ananke.git
cd ananke && npm install && npm run build && cd ..

# 2. Clone this repo
git clone https://github.com/its-not-rocket-science/ananke-threejs-bridge.git
cd ananke-threejs-bridge

# 3. Install dependencies
npm install

# 4. Start dev server
npm run dev
# Opens http://localhost:5173 in your browser

# 5. Build for production
npm run build
# Output in dist/; deploy to any static host (GitHub Pages, Netlify, etc.)
```

---

## File layout

```
ananke-threejs-bridge/
├── src/
│   ├── main.ts                 Entry point: sim loop + render loop
│   ├── scenario.ts             Knight vs Brawler setup
│   ├── simulation/
│   │   ├── SimLoop.ts          setInterval-based 20 Hz loop
│   │   └── InterpolationBuffer.ts  Double-buffered snapshot store
│   ├── renderer/
│   │   ├── SceneSetup.ts       Three.js scene, camera, lights
│   │   ├── SegmentBoneMapper.ts Ananke segments → Three.js bones
│   │   ├── AnimationClipBlender.ts AnimationHints → mixer actions
│   │   ├── GrappleVisualiser.ts GrappleConstraint → bone locks / debug lines
│   │   └── CameraRig.ts        Follow camera
│   ├── ui/
│   │   ├── OutcomeOverlay.ts   Win/loss/tick display
│   │   └── Controls.ts         Start/Reset/Seed input
│   └── config.ts               Bone names, clip names, scale overrides
│
├── public/
│   └── models/
│       └── humanoid.glb        Placeholder CC0 character model
│
├── index.html
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## Fixed-point to Three.js units

Ananke stores all lengths as integers with `SCALE.m = 10000` (10000 units = 1 metre). Three.js uses floating-point metres. Divide by `SCALE.m` everywhere a length reaches Three.js:

```typescript
import { SCALE } from "../ananke/dist/src/units.js";

// Position
bone.position.set(
  seg.position_Sm.x / SCALE.m,  // → metres
  seg.position_Sm.y / SCALE.m,
  (seg.position_Sm.z ?? 0) / SCALE.m,
);

// Q-scaled floats (shock, fear, blend weights)
const shockFloat = entity.condition.shock_Q / SCALE.Q;  // → [0, 1]
```

Never divide by a hardcoded `10000`. Always import and use `SCALE.m` and `SCALE.Q` so that future Ananke scale changes (if any) are caught at the import site.

---

## Ananke API surface used

All imports are from Ananke's **Tier 1 (Stable)** surface. The complete field-by-field
contract for `AnimationHints`, `GrapplePoseConstraint`, and `InterpolatedState` is
documented in
[`docs/bridge-contract.md`](https://github.com/its-not-rocket-science/ananke/blob/master/docs/bridge-contract.md).

| Ananke export | Used in | Tier |
|--------------|---------|------|
| `stepWorld(world, cmds, ctx)` | `src/simulation/SimLoop.ts` | Tier 1 |
| `generateIndividual(seed, archetype)` | `src/scenario.ts` | Tier 1 |
| `extractRigSnapshots(world)` | `src/simulation/SimLoop.ts` | Tier 1 |
| `deriveAnimationHints(entity)` | `src/simulation/SimLoop.ts` | Tier 1 |
| `derivePoseModifiers(entity)` | `src/simulation/SimLoop.ts` | Tier 1 |
| `deriveGrappleConstraint(entity, world)` | `src/simulation/SimLoop.ts` | Tier 1 |
| `serializeReplay(replay)` | `src/ui/Controls.ts` | Tier 1 |
| `ReplayRecorder` | `src/simulation/SimLoop.ts` | Tier 1 |
| `SCALE` | `src/renderer/SegmentBoneMapper.ts` | Tier 1 |
| `q()` | `src/scenario.ts` | Tier 1 |

---

## Tick interpolation strategy

The simulation runs at 20 Hz (`setInterval(tick, 50)`). `requestAnimationFrame` runs at display rate. `InterpolationBuffer` retains the previous and current simulation timestamps:

```typescript
// InterpolationBuffer.ts
getState(entityId: number, nowMs: number): InterpolatedState {
  const { prev, curr } = this._snapshots.get(entityId)!;
  const t = Math.min(1, (nowMs - prev.timestampMs) / (curr.timestampMs - prev.timestampMs));
  return lerpSnapshots(prev, curr, t);
}
```

The interpolation factor `t` is clamped to `[0, 1]`. Extrapolation is disabled. Positions are lerped component-wise. Boolean flags snap at `t >= 0.5`.

`setInterval` is not perfectly accurate in browsers (it can drift up to ~15 ms). If you need better timing, use a `MessageChannel` trick to achieve more accurate 50 ms intervals, or run the sim loop in a Web Worker.

---

## Bundle size

Ananke source is approximately 150 KB of TypeScript with zero runtime dependencies. After tree-shaking and minification with Vite, the Ananke contribution to the bundle is typically under 80 KB gzipped. Three.js r165 is ~600 KB gzipped (with tree-shaking). Total expected bundle: under 750 KB gzipped.

Do not import all of Three.js with `import * as THREE from "three"`. Import only the classes you use:

```typescript
import { Scene, PerspectiveCamera, WebGLRenderer, Skeleton, SkinnedMesh } from "three";
```

---

## Demo scene

A single-page app with:

- **Viewport**: Knight vs Brawler in a minimal arena (plane + directional light)
- **Outcome banner**: winner, tick count, entity state (shock, fluid loss, consciousness)
- **Seed input**: change the world seed and restart the fight
- **Start / Reset button**: restart with the same or a new seed
- **Replay download**: saves the fight as a JSON replay file compatible with Ananke's `deserializeReplay`

The demo is the lowest-friction proof that Ananke integrates with a WebGL renderer and produces physically differentiated outcomes.

---

## Contributing

1. Fork this repository and create a feature branch.
2. Keep `src/simulation/` free of Three.js imports — the simulation layer must remain renderer-agnostic.
3. Keep `src/renderer/` free of Ananke internals beyond the bridge API.
4. Run `npm run typecheck` before opening a PR.
5. Test in Chrome, Firefox, and Safari. WebGL support varies for skinned mesh features.

To list this project in Ananke's `docs/ecosystem.md`, open a PR to the Ananke repository adding a row to the Renderer Bridges table with a link and a one-line description.
