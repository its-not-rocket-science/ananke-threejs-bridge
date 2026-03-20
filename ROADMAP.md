# ananke-threejs-bridge — Roadmap

This renderer is intentionally milestone-gated. Each milestone is independently shippable and builds on the previous one without breaking the public API.

---

## Milestone 1 — Static scene (current)

**Status: in progress**

Two humanoid capsules rendered in a Three.js scene. Positions, facing, and animation state driven entirely by `BridgeEngine.getInterpolatedState()` at 60 Hz from a 20 Hz Ananke simulation.

Deliverables:
- [x] `AnankeRenderer` class with `init()`, `writeSimFrame()`, `render()`, `dispose()`
- [x] `SceneBuilder` — configurable scene, camera, directional + ambient + rim lights, arena ground plane
- [x] `EntityMesh` — `CapsuleGeometry` humanoid per entity; team-colour rim ring; facing disc
- [x] Dead / unconscious / prone visual states (mesh rotation + tint)
- [x] Shock emissive flash; fear tremor (sum-of-sines, deterministic — no `Math.random()`)
- [x] Browser demo: Knight vs Boxer fight; seed selector; speed control (0.25× – 4×); live HUD bars
- [x] `HUMANOID_SEGMENT_MAPPING` exported for host customisation
- [ ] `ResizeObserver`-driven canvas resize (implemented, needs manual testing)

---

## Milestone 2 — Animation state machine

**Goal:** Replace procedural capsule animation with a proper state machine driving `THREE.AnimationMixer` + `AnimationClip` assets.

Planned work:
- Load a GLTF/GLB skeletal humanoid mesh in `EntityMesh`
- Attach `THREE.AnimationMixer` per entity
- Map `AnimationState` enum to named `AnimationClip` assets: `idle`, `walk`, `run`, `sprint`, `crawl`, `attack`, `guard`, `prone`, `unconscious`, `death`
- Crossfade between states using `mixer.clipAction().crossFadeTo()` with per-transition durations
- Drive per-bone injury deformation: traverse skeleton, apply `PoseModifier.impairmentQ` as blend shape or bone scale
- Drive `guardingQ` → guard pose blend weight; `attackingQ` → swing clip weight
- `AnimationController.update()` signature stays identical — no changes to `renderer.ts`

---

## Milestone 3 — Grapple constraints

**Goal:** When two entities are grappling, lock their relative Three.js positions and apply the appropriate pose layer.

Planned work:
- Read `InterpolatedState.grapple` (`GrapplePoseConstraint`) each render frame
- For the holder (`isHolder === true`): set up a `THREE.Object3D` parent-child constraint anchoring the held entity's root to the holder's grip anchor bone
- For the held entity (`isHeld === true`): disable root transform update; inherit holder's transform
- Map `grapple.position` (`"standing"` / `"prone"` / `"pinned"` / `"mounted"`) to a dedicated grapple animation layer
- Blend `grapple.gripQ / SCALE.Q` → "full grip" animation clip weight on the holder
- Add a visual indicator (thin line between holder and held entity) as a debug aid

---

## Milestone 4 — Weather effects

**Goal:** Integrate Ananke's `WeatherState` / `HazardZone` outputs into visual environment effects.

Planned work:
- Subscribe to `WorldState.__sensoryEnv` (or a dedicated weather feed from the host)
- Fog density: drive `THREE.Fog.near` / `THREE.Fog.far` from visibility distance
- Rain: `THREE.Points` particle system with downward velocity; intensity from precipitation rate
- Wind: lean vegetation / particle drift direction from wind vector
- Fire hazard zone: `THREE.PointLight` + `THREE.SphereGeometry` billboard at `HazardZone` position; flickering emissive driven by `intensity_Q`
- Extreme cold zone: blue-tinted fog sphere overlay
- All particle counts and light intensities scale from `HazardZone.intensity_Q / SCALE.Q`

---

## Milestone 5 — UI overlay

**Goal:** Production-quality in-scene UI overlay — health bars, shock indicators, team colours — rendered as HTML overlay (CSS transforms driven by projected world-space positions).

Planned work:
- Project each entity's world position to screen space: `vector.project(camera)` → CSS left/top
- Floating health / shock / consciousness bars per entity (HTML divs, updated each render frame)
- Team colour nameplate; status label (`idle` / `attacking` / `unconscious` / `dead`)
- Grapple indicator icon when `grapple.isHolder` or `grapple.isHeld`
- Optional: minimap (2D canvas overlay, top-down view of entity positions)
- Decouple from `AnankeRenderer` — implement as a separate `HUDController` class that takes the same `InterpolatedState[]` array

---

## Milestone 6 — Multi-entity battle scene (10v10)

**Goal:** Demonstrate the renderer at campaign scale with 10 entities per team (20 total).

Planned work:
- `instanced geometry` option in `EntityMesh` (`THREE.InstancedMesh` for capsule bodies) to reduce draw calls from 20 to 2 (one per team)
- `LOD` switching: full animation at < 15 m from camera; simplified capsule at > 15 m (maps to Ananke's `src/lod.ts` LOD levels)
- `SpatialIndex`-aware culling: skip `getInterpolatedState()` calls for entities behind camera frustum
- Formation debug visualiser: draw lines between entities with `intent.move.formationTarget` set
- Performance target: 60 fps on a mid-range laptop GPU with 20 entities

---

## Future ideas (unscheduled)

- WebXR / VR mode (first-person or third-person spectator)
- Audio bridge: map `AnimationHints` fields to spatial audio cues (`AudioContext` via `THREE.PositionalAudio`)
- Replay playback: drive `AnankeRenderer` from a `ReplayRecorder` snapshot file instead of live sim
- Headless render mode: `node-three` or `puppeteer` for CI screenshot regression tests
