# ananke-threejs-bridge

A Three.js real-time renderer for [@its-not-rocket-science/ananke](https://github.com/its-not-rocket-science/ananke) humanoid combat simulation.

Drives a Three.js scene at 60 Hz from Ananke's physics simulation running at 20 Hz, using the `BridgeEngine` interpolation layer to produce smooth visuals between simulation ticks. No sidecar process required — everything runs in-browser via ESM import.

---

## What it does

- Consumes `WorldState` from `@its-not-rocket-science/ananke` via `stepWorld`
- Passes each tick's `extractRigSnapshots()` output into `BridgeEngine`
- Renders at 60 Hz using `BridgeEngine.getInterpolatedState()` to interpolate position, facing, and animation hints between 20 Hz sim ticks
- Maps `AnimationHints` fields (`idle`, `walk`, `run`, `sprint`, `attack`, `guard`, `prone`, `dead`) to Three.js mesh transforms
- Displays team-coloured capsule-geometry humanoids (Milestone 1) — upgradeable to skinned meshes in Milestone 2
- Includes a live demo: Knight vs Boxer fight with health/shock/fear HUD bars, seed selector, and speed control

---

## Prerequisites

- Node 18+
- npm 9+
- A modern browser with WebGL2 support

---

## Quick start

```bash
# Install dependencies
npm install

# Start the Vite dev server (opens browser automatically)
npm run dev

# Production build (output to dist/)
npm run build

# Preview the production build locally
npm run preview
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Host application                                            │
│                                                              │
│  setInterval (20 Hz)          requestAnimationFrame (60 Hz)  │
│       │                               │                      │
│       ▼                               ▼                      │
│  stepWorld(world, cmds, ctx)    renderer.render(timestamp)   │
│       │                               │                      │
│       ▼                               │                      │
│  renderer.writeSimFrame(world)        │                      │
│       │                               │                      │
└───────┼───────────────────────────────┼──────────────────────┘
        │                               │
        ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│  AnankeRenderer  (src/renderer.ts)                           │
│                                                              │
│  extractRigSnapshots(world) ──► BridgeEngine.update()        │
│                                       │                      │
│                          BridgeEngine.getInterpolatedState() │
│                                       │                      │
│                               InterpolatedState              │
│                           ┌──────────┴──────────┐           │
│                           ▼                     ▼           │
│                    EntityMesh              AnimationController│
│                   (src/entities.ts)        (src/animation.ts) │
│                           │                     │           │
│                           ▼                     ▼           │
│                    THREE.Group          procedural transforms │
│                    capsule mesh         (Milestone 1)        │
│                    team colour          → AnimationMixer     │
│                    shock/dead tint        (Milestone 2)      │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
THREE.WebGLRenderer.render(scene, camera)
```

The bridge operates on a **double-buffer protocol**: the write side (20 Hz sim) pushes snapshots; the read side (60 Hz render) linearly interpolates position, facing, and animation blend weights between the two most recent snapshots.

---

## Key files

| File | Role |
|------|------|
| `src/renderer.ts` | `AnankeRenderer` — top-level class wiring sim → Three.js |
| `src/scene.ts` | `SceneBuilder` — creates Three.js scene, camera, lights, ground |
| `src/entities.ts` | `EntityMesh` — capsule-geometry humanoid, team colours, dead/prone states |
| `src/animation.ts` | `AnimationController` — maps `AnimationHints` to mesh transforms |
| `src/index.ts` | Public API re-exports |
| `demo/index.html` | Live browser demo: Knight vs Boxer, 20 Hz sim → 60 Hz render |

---

## AnimationHints mapping

`AnimationHints` is produced by `deriveAnimationHints(entity)` inside Ananke after each `stepWorld` call and delivered via the bridge's `InterpolatedState.animation`. All Q values are integers in `[0, SCALE.Q]` where `SCALE.Q = 10 000`.

| Field | Type | This renderer maps it to... |
|-------|------|-----------------------------|
| `idle` | Q (0 or SCALE.Q) | Breathing bob at 0.4 Hz |
| `walk` | Q (0 or SCALE.Q) | Forward lean 4°, bob 1.2 Hz |
| `run` | Q (0 or SCALE.Q) | Forward lean 10°, bob 2.0 Hz |
| `sprint` | Q (0 or SCALE.Q) | Forward lean 18°, bob 2.8 Hz |
| `crawl` | Q (0 or SCALE.Q) | TODO (Milestone 2) |
| `guardingQ` | Q [0, SCALE.Q] | Backward lean proportional to guard intensity |
| `attackingQ` | Q (0 or SCALE.Q) | Forward punch Z-offset (0.18 m, 180 ms) |
| `shockQ` | Q [0, SCALE.Q] | Red emissive flash on body mesh |
| `fearQ` | Q [0, SCALE.Q] | Lateral sway tremor (sum-of-sines, no random) |
| `prone` | boolean | Capsule rotated 90° to horizontal |
| `unconscious` | boolean | Capsule tilted 60°, darkened |
| `dead` | boolean | Capsule flat + greyed out, all animation frozen |

Priority order: `dead` > `unconscious` > `prone` > `attack` > `guard` > locomotion.

---

## Bridge contract

See [`docs/bridge-contract.md`](https://github.com/its-not-rocket-science/ananke/blob/master/docs/bridge-contract.md) in the parent repo for the full integration contract (interpolation semantics, segment ID conventions, scale units, stability promises).

The humanoid segment mapping used here is:

```typescript
import { HUMANOID_SEGMENT_MAPPING } from "@its-not-rocket-science/ananke-threejs-bridge";
// {
//   bodyPlanId: "humanoid",
//   segments: [
//     { segmentId: "head",     boneName: "Bone_Head"    },
//     { segmentId: "torso",    boneName: "Bone_Spine02" },
//     { segmentId: "leftArm",  boneName: "Bone_ArmL"   },
//     { segmentId: "rightArm", boneName: "Bone_ArmR"   },
//     { segmentId: "leftLeg",  boneName: "Bone_LegL"   },
//     { segmentId: "rightLeg", boneName: "Bone_LegR"   },
//   ],
// }
```

Swap the `boneName` strings to match your own rig's skeleton hierarchy.

---

## Parent project

[https://github.com/its-not-rocket-science/ananke](https://github.com/its-not-rocket-science/ananke)
