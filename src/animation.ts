import * as THREE from "three";
import type { AnimationHints } from "@its-not-rocket-science/ananke";
import { SCALE } from "@its-not-rocket-science/ananke";
import type { EntityMesh } from "./entities.js";

export type AnimationState =
  | "dead"
  | "unconscious"
  | "prone"
  | "attack"
  | "guard"
  | "sprint"
  | "run"
  | "walk"
  | "idle";

export function deriveAnimationState(hints: AnimationHints): AnimationState {
  if (hints.dead) return "dead";
  if (hints.unconscious) return "unconscious";
  if (hints.prone) return "prone";
  if (hints.attackingQ > SCALE.Q / 2) return "attack";
  if (hints.guardingQ > SCALE.Q / 4) return "guard";
  if (hints.sprint === SCALE.Q) return "sprint";
  if (hints.run === SCALE.Q) return "run";
  if (hints.walk === SCALE.Q) return "walk";
  return "idle";
}

const IDLE_BOB_AMP = 0.015;
const WALK_BOB_AMP = 0.03;
const RUN_BOB_AMP = 0.05;
const SPRINT_BOB_AMP = 0.07;
const IDLE_BOB_HZ = 0.4;
const WALK_BOB_HZ = 1.2;
const RUN_BOB_HZ = 2.0;
const SPRINT_BOB_HZ = 2.8;
const GUARD_X_ROT_DEG = -12;
const FEAR_SWAY_DEG = 2.5;

export class AnimationController {
  private readonly mesh: EntityMesh;
  private time_s = 0;
  private prevState: AnimationState = "idle";

  constructor(mesh: EntityMesh) {
    this.mesh = mesh;
  }

  update(
    deltaSeconds: number,
    hints: AnimationHints,
    condition: { shockQ: number; fearQ: number; consciousness: number; fluidLoss: number; dead: boolean },
  ): void {
    this.time_s += deltaSeconds;
    const state = deriveAnimationState(hints);
    this.mesh.resetVisualPose();

    if (this.mesh.hasClipAnimation()) {
      this.applyClipAnimation(state);
      this.applySecondaryMotion(state, hints, condition, deltaSeconds);
      this.mesh.updateMixer(deltaSeconds);
      this.prevState = state;
      return;
    }

    this.applyProceduralFallback(state, hints, condition);
    this.prevState = state;
  }

  private applyClipAnimation(state: AnimationState): void {
    switch (state) {
      case "attack":
        if (this.prevState !== "attack") {
          this.mesh.playClip("Attack", 0.08);
        }
        break;
      case "dead":
      case "unconscious":
        this.mesh.playClip("Unconscious", 0.18);
        this.mesh.setClipTimeScale(0.9);
        break;
      case "prone":
        this.mesh.playClip("Prone", 0.12);
        this.mesh.setClipTimeScale(1);
        break;
      case "sprint":
        this.mesh.playClip("Idle", 0.12);
        this.mesh.setClipTimeScale(1.8);
        break;
      case "run":
        this.mesh.playClip("Idle", 0.12);
        this.mesh.setClipTimeScale(1.45);
        break;
      case "walk":
      case "guard":
        this.mesh.playClip("Idle", 0.12);
        this.mesh.setClipTimeScale(1.15);
        break;
      case "idle":
      default:
        this.mesh.playClip("Idle", 0.12);
        this.mesh.setClipTimeScale(1);
        break;
    }
  }

  private applySecondaryMotion(
    state: AnimationState,
    hints: AnimationHints,
    condition: { fearQ: number },
    _deltaSeconds: number,
  ): void {
    const bobSettings = this.getBobSettings(state);
    const bob = Math.sin(this.time_s * bobSettings.hz * Math.PI * 2) * bobSettings.amp;
    const visual = this.mesh.visualRoot;
    visual.position.y += bob;

    if (state === "guard") {
      visual.rotation.x = THREE.MathUtils.degToRad(GUARD_X_ROT_DEG * (hints.guardingQ / SCALE.Q));
    }

    const fear = condition.fearQ / SCALE.Q;
    if (fear > 0.1) {
      const sway = Math.sin(this.time_s * 14) * THREE.MathUtils.degToRad(FEAR_SWAY_DEG * fear);
      visual.rotation.z += sway;
    }
  }

  private applyProceduralFallback(
    state: AnimationState,
    hints: AnimationHints,
    condition: { fearQ: number },
  ): void {
    const bobSettings = this.getBobSettings(state);
    const bob = Math.sin(this.time_s * bobSettings.hz * Math.PI * 2) * bobSettings.amp;
    this.mesh.visualRoot.position.y = bob;

    if (state === "guard") {
      this.mesh.visualRoot.rotation.x = THREE.MathUtils.degToRad(GUARD_X_ROT_DEG * (hints.guardingQ / SCALE.Q));
    }

    const fear = condition.fearQ / SCALE.Q;
    if (fear > 0.1) {
      this.mesh.visualRoot.rotation.z = Math.sin(this.time_s * 12) * fear * 0.08;
    }
  }

  private getBobSettings(state: AnimationState): { amp: number; hz: number } {
    switch (state) {
      case "walk":
      case "guard":
        return { amp: WALK_BOB_AMP, hz: WALK_BOB_HZ };
      case "run":
        return { amp: RUN_BOB_AMP, hz: RUN_BOB_HZ };
      case "sprint":
        return { amp: SPRINT_BOB_AMP, hz: SPRINT_BOB_HZ };
      default:
        return { amp: IDLE_BOB_AMP, hz: IDLE_BOB_HZ };
    }
  }
}
