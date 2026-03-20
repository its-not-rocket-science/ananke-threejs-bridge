// src/renderer.ts — AnankeRenderer: drives a Three.js scene from Ananke WorldState.
//
// Architecture:
//   Sim thread (20 Hz): writeSimFrame(world) → extractRigSnapshots → BridgeEngine.update()
//   Render thread (60 Hz): render(timestamp) → BridgeEngine.getInterpolatedState() → Three.js
//
// See docs/bridge-contract.md in the parent ananke repo for the full integration contract.

import {
  BridgeEngine,
  extractRigSnapshots,
  SCALE,
} from "@its-not-rocket-science/ananke";
import type {
  WorldState,
  BridgeConfig,
  InterpolatedState,
  BodyPlanMapping,
} from "@its-not-rocket-science/ananke";
import * as THREE from "three";

import { SceneBuilder } from "./scene.js";
import type { SceneConfig } from "./scene.js";
import { EntityMesh } from "./entities.js";
import { AnimationController } from "./animation.js";

// ── Canonical humanoid segment → Three.js bone mapping ───────────────────────
//
// Segment IDs are camelCase strings from Ananke's injury region keys.
// Bone names here target a generic Three.js skeleton; swap for your rig's names.
// See bridge-contract.md §3 for the full list of canonical segment IDs.

export const HUMANOID_SEGMENT_MAPPING: BodyPlanMapping = {
  bodyPlanId: "humanoid",
  segments: [
    { segmentId: "head",     boneName: "Bone_Head"     },
    { segmentId: "torso",    boneName: "Bone_Spine02"  },
    { segmentId: "leftArm",  boneName: "Bone_ArmL"     },
    { segmentId: "rightArm", boneName: "Bone_ArmR"     },
    { segmentId: "leftLeg",  boneName: "Bone_LegL"     },
    { segmentId: "rightLeg", boneName: "Bone_LegR"     },
  ],
};

// ── Options ───────────────────────────────────────────────────────────────────

export interface AnankeRendererOptions {
  /** Optional override for the scene configuration (camera, lights, fog…). */
  scene?: Partial<SceneConfig>;
  /** Allow velocity-based extrapolation when render time outpaces sim time. Default false. */
  extrapolationAllowed?: boolean;
  /** Additional body-plan mappings (e.g., quadruped plans). Humanoid is always included. */
  extraMappings?: BodyPlanMapping[];
}

// ── AnankeRenderer ────────────────────────────────────────────────────────────

/**
 * AnankeRenderer — drives a Three.js scene from Ananke WorldState at 60 Hz.
 *
 * Usage:
 *   const renderer = new AnankeRenderer(canvas, { extrapolationAllowed: false });
 *   renderer.init();
 *
 *   // Each simulation tick (20 Hz via setInterval or worker message):
 *   renderer.writeSimFrame(world);
 *
 *   // Each render frame (60 Hz via requestAnimationFrame):
 *   requestAnimationFrame(function loop(timestamp) {
 *     renderer.render(timestamp);
 *     requestAnimationFrame(loop);
 *   });
 *
 *   // When done:
 *   renderer.dispose();
 */
export class AnankeRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: AnankeRendererOptions;

  // Three.js core
  private threeRenderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Bridge
  private bridgeEngine!: BridgeEngine;
  private bridgeConfig!: BridgeConfig;

  // Per-entity state: maps entity ID → { mesh, animController }
  private entityMeshes = new Map<number, EntityMesh>();
  private entityAnimControllers = new Map<number, AnimationController>();

  // Render timing
  private startTime_ms: number = 0;
  private isInitialised: boolean = false;

  // Scene builder (creates camera, lights, ground plane)
  private sceneBuilder!: SceneBuilder;

  constructor(canvas: HTMLCanvasElement, options: AnankeRendererOptions = {}) {
    this.canvas = canvas;
    this.options = options;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Initialise the Three.js renderer, scene, camera, and bridge engine.
   * Must be called once before writeSimFrame() or render().
   */
  init(): void {
    if (this.isInitialised) return;

    // ── Three.js renderer ──────────────────────────────────────────────────
    this.threeRenderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.threeRenderer.setPixelRatio(window.devicePixelRatio);
    this.threeRenderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.threeRenderer.shadowMap.enabled = true;

    // ── Scene & camera (delegated to SceneBuilder) ─────────────────────────
    this.sceneBuilder = new SceneBuilder(this.options.scene);
    const { scene, camera } = this.sceneBuilder.build();
    this.scene = scene;
    this.camera = camera;

    // ── Bridge engine ──────────────────────────────────────────────────────
    this.bridgeConfig = {
      mappings: [HUMANOID_SEGMENT_MAPPING, ...(this.options.extraMappings ?? [])],
      extrapolationAllowed: this.options.extrapolationAllowed ?? false,
      defaultBoneName: "Bone_Root",
    };
    this.bridgeEngine = new BridgeEngine(this.bridgeConfig);

    // ── Timing ────────────────────────────────────────────────────────────
    this.startTime_ms = performance.now();

    // ── Resize observer ───────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(this.canvas);

    this.isInitialised = true;
  }

  // ── Write side (20 Hz) ──────────────────────────────────────────────────────

  /**
   * Ingest the current WorldState into the bridge engine.
   * Call this once per simulation tick, immediately after stepWorld().
   *
   * Automatically registers new entities and removes entities that have
   * left the world since the last frame.
   *
   * @param world The WorldState produced by stepWorld().
   */
  writeSimFrame(world: WorldState): void {
    if (!this.isInitialised) {
      throw new Error("AnankeRenderer.init() must be called before writeSimFrame()");
    }

    // Extract rig snapshots from the current world state.
    // extractRigSnapshots() is pure — safe to call every tick.
    const snapshots = extractRigSnapshots(world);

    // Sync Three.js entity meshes with the current entity set.
    this.syncEntityMeshes(world);

    // Push snapshots into the bridge engine's double buffer.
    this.bridgeEngine.update(snapshots);
  }

  // ── Read side (60 Hz) ───────────────────────────────────────────────────────

  /**
   * Render one frame. Call this inside requestAnimationFrame.
   *
   * @param timestamp DOMHighResTimeStamp from requestAnimationFrame (milliseconds).
   */
  render(timestamp: number): void {
    if (!this.isInitialised) return;

    const renderTime_s = (timestamp - this.startTime_ms) / 1000;

    // Update each entity mesh from interpolated bridge state.
    for (const [entityId, mesh] of this.entityMeshes) {
      const state = this.bridgeEngine.getInterpolatedState(entityId, renderTime_s);
      if (!state) continue;

      this.applyStateToMesh(mesh, state);

      const animController = this.entityAnimControllers.get(entityId);
      if (animController) {
        animController.update(state.animation, state.condition);
      }
    }

    this.threeRenderer.render(this.scene, this.camera);
  }

  /**
   * Dispose of all Three.js resources. Call when the renderer is no longer needed.
   */
  dispose(): void {
    for (const mesh of this.entityMeshes.values()) {
      mesh.dispose();
      this.scene.remove(mesh.group);
    }
    this.entityMeshes.clear();
    this.entityAnimControllers.clear();
    this.threeRenderer.dispose();
    this.isInitialised = false;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Apply an interpolated bridge state to a Three.js entity group.
   *
   * position_m from InterpolatedState is already in real metres (the bridge
   * converts from SCALE.m fixed-point). See bridge-contract.md §7.
   */
  private applyStateToMesh(mesh: EntityMesh, state: InterpolatedState): void {
    // Position — bridge gives real metres, Three.js uses metres directly.
    // Ananke uses a 2D XY plane; map Y→Z for Three.js (Y-up convention).
    mesh.group.position.set(
      state.position_m.x,
      0,                    // TODO: replace with terrain height sampling
      state.position_m.y,
    );

    // Facing — state.facing is a unit vector in sim XY space; map to Three.js XZ.
    // facing.x/y are fixed-point Q values: divide by SCALE.Q to get [-1, 1].
    if (state.facing.x !== 0 || state.facing.y !== 0) {
      const fx = state.facing.x / SCALE.Q;
      const fz = state.facing.y / SCALE.Q;
      mesh.group.rotation.y = Math.atan2(fx, fz);
    }

    // Dead / unconscious — hide or tint the mesh.
    if (state.animation.dead) {
      mesh.setDead(true);
    } else if (state.animation.unconscious) {
      mesh.setUnconscious(true);
    } else {
      mesh.setDead(false);
      mesh.setUnconscious(false);
    }

    // Prone — rotate the capsule to lie flat.
    if (state.animation.prone && !state.animation.dead) {
      mesh.setProne(true);
    } else {
      mesh.setProne(false);
    }

    // Per-segment injury deformation (impairmentQ drives a colour tint per bone).
    // TODO (Milestone 2): drive blend shapes / bone constraints from poseModifiers.
    for (const mod of state.poseModifiers) {
      mesh.setSegmentImpairment(mod.boneName, mod.impairmentQ / SCALE.Q);
    }

    // Shock overlay — drive emissive intensity on the mesh material.
    const shockFloat = state.condition.shockQ / SCALE.Q;
    mesh.setShockIntensity(shockFloat);
  }

  /**
   * Ensure the entity mesh set matches the current world entity set.
   * Adds meshes for new entities; removes meshes for departed entities.
   */
  private syncEntityMeshes(world: WorldState): void {
    const liveIds = new Set(world.entities.map(e => e.id));

    // Add meshes for entities not yet tracked.
    for (const entity of world.entities) {
      if (!this.entityMeshes.has(entity.id)) {
        const mesh = new EntityMesh(entity.id, entity.teamId);
        mesh.build();
        this.scene.add(mesh.group);
        this.entityMeshes.set(entity.id, mesh);
        this.entityAnimControllers.set(entity.id, new AnimationController(mesh));

        // Register the entity's body plan with the bridge engine.
        // Humanoid plan ID matches HUMANOID_SEGMENT_MAPPING.bodyPlanId above.
        this.bridgeEngine.setEntityBodyPlan(entity.id, "humanoid");
      }
    }

    // Remove meshes for entities no longer in the world.
    for (const [entityId, mesh] of this.entityMeshes) {
      if (!liveIds.has(entityId)) {
        mesh.dispose();
        this.scene.remove(mesh.group);
        this.entityMeshes.delete(entityId);
        this.entityAnimControllers.delete(entityId);
        this.bridgeEngine.removeEntity(entityId);
      }
    }
  }

  private handleResize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.threeRenderer.setSize(w, h);
  }
}
