import {
  BridgeEngine,
  SCALE,
  extractRigSnapshots,
} from "@its-not-rocket-science/ananke";
import type {
  BodyPlanMapping,
  BridgeConfig,
  InterpolatedState,
  WorldState,
} from "@its-not-rocket-science/ananke";
import * as THREE from "three";

import { AnimationController } from "./animation.js";
import { EntityMesh } from "./entities.js";
import { SceneBuilder } from "./scene.js";
import type { SceneConfig } from "./scene.js";
import { DEFAULT_HUMANOID_SEGMENT_BONES } from "./SegmentBoneMapper.js";

const INTERPOLATION_BACK_TIME_S = 1 / 20;

const HEAD_BONE = "Head";
const TORSO_BONE = "Chest";
const LEFT_ARM_BONE = "UpperArm.L";
const RIGHT_ARM_BONE = "UpperArm.R";
const LEFT_LEG_BONE = "UpperLeg.L";
const RIGHT_LEG_BONE = "UpperLeg.R";

export const HUMANOID_SEGMENT_MAPPING: BodyPlanMapping = {
  bodyPlanId: "humanoid",
  segments: [
    { segmentId: "head", boneName: HEAD_BONE },
    { segmentId: "torso", boneName: TORSO_BONE },
    { segmentId: "leftArm", boneName: LEFT_ARM_BONE },
    { segmentId: "rightArm", boneName: RIGHT_ARM_BONE },
    { segmentId: "leftLeg", boneName: LEFT_LEG_BONE },
    { segmentId: "rightLeg", boneName: RIGHT_LEG_BONE },
  ],
};

export interface AnankeRendererOptions {
  scene?: Partial<SceneConfig>;
  extrapolationAllowed?: boolean;
  extraMappings?: BodyPlanMapping[];
}

export class AnankeRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: AnankeRendererOptions;

  private threeRenderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private bridgeEngine!: BridgeEngine;
  private bridgeConfig!: BridgeConfig;
  private sceneBuilder!: SceneBuilder;

  private entityMeshes = new Map<number, EntityMesh>();
  private entityAnimControllers = new Map<number, AnimationController>();
  private resizeObserver: ResizeObserver | null = null;
  private startTime_ms = 0;
  private lastRenderTimestamp_ms: number | null = null;
  private renderFrameHandle: number | null = null;
  private isInitialised = false;

  constructor(canvas: HTMLCanvasElement, options: AnankeRendererOptions = {}) {
    this.canvas = canvas;
    this.options = options;
  }

  init(): void {
    if (this.isInitialised) {
      return;
    }

    this.threeRenderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.threeRenderer.setPixelRatio(window.devicePixelRatio);
    this.threeRenderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.threeRenderer.shadowMap.enabled = true;

    this.sceneBuilder = new SceneBuilder(this.options.scene);
    const { scene, camera } = this.sceneBuilder.build();
    this.scene = scene;
    this.camera = camera;

    this.bridgeConfig = {
      mappings: [HUMANOID_SEGMENT_MAPPING, ...(this.options.extraMappings ?? [])],
      extrapolationAllowed: this.options.extrapolationAllowed ?? false,
      defaultBoneName: "Hips",
    };
    this.bridgeEngine = new BridgeEngine(this.bridgeConfig);
    this.startTime_ms = performance.now();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.canvas);
    this.handleResize();

    this.isInitialised = true;
  }

  startRenderLoop(): void {
    if (!this.isInitialised || this.renderFrameHandle !== null) {
      return;
    }

    const frame = (timestamp: number): void => {
      this.render(timestamp);
      this.renderFrameHandle = window.requestAnimationFrame(frame);
    };

    this.renderFrameHandle = window.requestAnimationFrame(frame);
  }

  stopRenderLoop(): void {
    if (this.renderFrameHandle !== null) {
      window.cancelAnimationFrame(this.renderFrameHandle);
      this.renderFrameHandle = null;
    }
    this.lastRenderTimestamp_ms = null;
  }

  reset(): void {
    this.bridgeEngine.clear();
    for (const mesh of this.entityMeshes.values()) {
      mesh.dispose();
      this.scene.remove(mesh.group);
    }
    this.entityMeshes.clear();
    this.entityAnimControllers.clear();
    this.startTime_ms = performance.now();
    this.lastRenderTimestamp_ms = null;
  }

  writeSimFrame(world: WorldState): void {
    if (!this.isInitialised) {
      throw new Error("AnankeRenderer.init() must be called before writeSimFrame().");
    }

    const snapshots = extractRigSnapshots(world);
    this.syncEntityMeshes(world);
    this.bridgeEngine.update(snapshots);
  }

  render(timestamp: number): void {
    if (!this.isInitialised) {
      return;
    }

    const deltaSeconds = this.lastRenderTimestamp_ms === null
      ? 1 / 60
      : Math.min(0.1, (timestamp - this.lastRenderTimestamp_ms) / 1000);
    this.lastRenderTimestamp_ms = timestamp;

    const elapsed_s = (timestamp - this.startTime_ms) / 1000;
    const renderTime_s = Math.max(0, elapsed_s - INTERPOLATION_BACK_TIME_S);

    for (const [entityId, mesh] of this.entityMeshes) {
      const state = this.bridgeEngine.getInterpolatedState(entityId, renderTime_s);
      if (!state) {
        continue;
      }

      this.applyStateToMesh(mesh, state);
      this.entityAnimControllers.get(entityId)?.update(deltaSeconds, state.animation, state.condition);
    }

    this.threeRenderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stopRenderLoop();
    this.reset();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.threeRenderer.dispose();
    this.isInitialised = false;
  }

  private applyStateToMesh(mesh: EntityMesh, state: InterpolatedState): void {
    mesh.group.position.set(state.position_m.x, 0, state.position_m.y);

    if (state.facing.x !== 0 || state.facing.y !== 0) {
      const fx = state.facing.x / SCALE.Q;
      const fz = state.facing.y / SCALE.Q;
      mesh.group.rotation.y = Math.atan2(fx, fz);
    }

    mesh.setDead(state.animation.dead);
    mesh.setUnconscious(!state.animation.dead && state.animation.unconscious);
    mesh.setProne(state.animation.prone && !state.animation.dead);
    mesh.resetPoseModifiers();

    for (const mod of state.poseModifiers) {
      mesh.setSegmentImpairment(mod.boneName, mod.impairmentQ / SCALE.Q);
    }

    mesh.setShockIntensity(state.condition.shockQ / SCALE.Q);
  }

  private syncEntityMeshes(world: WorldState): void {
    const liveIds = new Set(world.entities.map((entity) => entity.id));

    for (const entity of world.entities) {
      if (this.entityMeshes.has(entity.id)) {
        continue;
      }

      const mesh = new EntityMesh(entity.id, entity.teamId);
      mesh.build();
      this.scene.add(mesh.group);
      this.entityMeshes.set(entity.id, mesh);
      this.entityAnimControllers.set(entity.id, new AnimationController(mesh));
      this.bridgeEngine.setEntityBodyPlan(entity.id, HUMANOID_SEGMENT_MAPPING.bodyPlanId);
    }

    for (const [entityId, mesh] of this.entityMeshes) {
      if (liveIds.has(entityId)) {
        continue;
      }
      mesh.dispose();
      this.scene.remove(mesh.group);
      this.entityMeshes.delete(entityId);
      this.entityAnimControllers.delete(entityId);
      this.bridgeEngine.removeEntity(entityId);
    }
  }

  private handleResize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.threeRenderer.setSize(width, height, false);
  }
}
