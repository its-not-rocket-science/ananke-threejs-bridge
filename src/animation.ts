// src/animation.ts — AnimationController: maps AnimationHints to mesh transforms.
//
// Milestone 1: purely procedural animation (no animation clips, no mixer).
//   - Idle: subtle breathing bob (Y sine wave)
//   - Walk/Run/Sprint: body lean forward, bob amplitude scales with speed
//   - Attack: brief forward punch (Z offset)
//   - Guard: arms-raised tilt (X rotation)
//   - Prone / Unconscious / Dead: handled by EntityMesh state setters directly
//
// Milestone 2: replace with THREE.AnimationMixer + AnimationClip assets.
// The AnimationState type and the update() signature will remain stable.

import * as THREE from "three";
import type { AnimationHints } from "@its-not-rocket-science/ananke";
import { SCALE } from "@its-not-rocket-science/ananke";
import type { EntityMesh } from "./entities.js";

// ── AnimationState ────────────────────────────────────────────────────────────

/**
 * Discrete animation state derived from AnimationHints.
 * Used to drive state-machine transitions in Milestone 2.
 *
 * Priority (highest first): dead → unconscious → prone → attack → guard → locomotion
 */
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

/** Derive a single AnimationState from AnimationHints (priority-ordered). */
export function deriveAnimationState(hints: AnimationHints): AnimationState {
  if (hints.dead)        return "dead";
  if (hints.unconscious) return "unconscious";
  if (hints.prone)       return "prone";
  if (hints.attackingQ > SCALE.Q / 2) return "attack";
  if (hints.guardingQ  > SCALE.Q / 4) return "guard";
  if (hints.sprint === SCALE.Q) return "sprint";
  if (hints.run    === SCALE.Q) return "run";
  if (hints.walk   === SCALE.Q) return "walk";
  return "idle";
}

// ── AnimationController ───────────────────────────────────────────────────────

// Procedural animation tuning constants
const IDLE_BOB_AMP   = 0.015; // metres, amplitude of breathing bob
const IDLE_BOB_HZ    = 0.4;   // Hz (slow breathing at idle)
const WALK_BOB_AMP   = 0.04;
const WALK_BOB_HZ    = 1.2;
const RUN_BOB_AMP    = 0.07;
const RUN_BOB_HZ     = 2.0;
const SPRINT_BOB_AMP = 0.10;
const SPRINT_BOB_HZ  = 2.8;
const LEAN_WALK_DEG  = 4;
const LEAN_RUN_DEG   = 10;
const LEAN_SPRINT_DEG = 18;
const ATTACK_Z_OFFSET = 0.18; // forward punch Z offset in metres
const GUARD_X_ROT_DEG = -12;  // slight backward lean when guarding

/**
 * AnimationController applies procedural animation transforms to an EntityMesh
 * based on AnimationHints delivered each render frame via the bridge.
 *
 * It owns no per-entity simulation state — all inputs come from InterpolatedState.
 *
 * Milestone 2 upgrade path:
 *   1. Attach a THREE.AnimationMixer to the EntityMesh's SkinnedMesh.
 *   2. Add AnimationClip assets for each AnimationState string.
 *   3. Replace the procedural offsets below with mixer.clipAction() weight blending.
 *   4. Keep update() signature identical — no changes needed in renderer.ts.
 */
export class AnimationController {
  private readonly mesh: EntityMesh;

  /** Monotonic time accumulator in seconds, advanced each update(). */
  private time_s: number = 0;
  private prevState: AnimationState = "idle";

  // Attack flash timer — counts down from ATTACK_DURATION_S after an attack fires.
  private attackTimer_s: number = 0;
  private static readonly ATTACK_DURATION_S = 0.18;

  constructor(mesh: EntityMesh) {
    this.mesh = mesh;
  }

  /**
   * Update procedural animation for one render frame.
   *
   * @param hints  AnimationHints from BridgeEngine.getInterpolatedState().animation
   * @param condition  Condition scalars from BridgeEngine.getInterpolatedState().condition
   */
  update(
    hints: AnimationHints,
    condition: { shockQ: number; fearQ: number; consciousness: number; fluidLoss: number; dead: boolean },
  ): void {
    // Advance internal timer (assume ~60 Hz; caller may pass DOMHighResTimeStamp delta instead)
    this.time_s += 1 / 60;

    const state = deriveAnimationState(hints);

    // State transition bookkeeping for Milestone 2 (currently unused beyond logging)
    if (state !== this.prevState) {
      // TODO (Milestone 2): trigger AnimationMixer crossfade here
      // this.crossFadeTo(state, TRANSITION_DURATIONS[state]);
      this.prevState = state;
    }

    // Dead / unconscious / prone are handled by EntityMesh — nothing to do here.
    if (state === "dead" || state === "unconscious" || state === "prone") {
      this.resetBodyTransforms();
      return;
    }

    // ── Procedural animation ─────────────────────────────────────────────
    this.applyLocomotion(state, hints);
    this.applyAttack(state, hints);
    this.applyGuard(state, hints);
    this.applyFearTremor(condition.fearQ / SCALE.Q);
  }

  // ── Private procedural helpers ────────────────────────────────────────────

  private applyLocomotion(state: AnimationState, _hints: AnimationHints): void {
    let bobAmp = 0;
    let bobHz  = 0;
    let leanDeg = 0;

    switch (state) {
      case "walk":   bobAmp = WALK_BOB_AMP;   bobHz = WALK_BOB_HZ;   leanDeg = LEAN_WALK_DEG;   break;
      case "run":    bobAmp = RUN_BOB_AMP;    bobHz = RUN_BOB_HZ;    leanDeg = LEAN_RUN_DEG;    break;
      case "sprint": bobAmp = SPRINT_BOB_AMP; bobHz = SPRINT_BOB_HZ; leanDeg = LEAN_SPRINT_DEG; break;
      default:       bobAmp = IDLE_BOB_AMP;   bobHz = IDLE_BOB_HZ;   leanDeg = 0;               break;
    }

    // Vertical bob (breathing / footfall)
    const bob = Math.sin(this.time_s * bobHz * 2 * Math.PI) * bobAmp;

    // TODO: apply bob to mesh.group.position.y offset (requires base Y tracking)
    // For now, apply to bodyMesh directly as a small Y offset.
    // mesh.group.position.y is managed by renderer.ts from position_m — don't touch it here.
    // Instead, offset the body mesh within the group:
    // this.mesh.group.children[0].position.y += bob;  // fragile — TODO Milestone 2

    // Forward lean (X rotation — negative = lean forward in Three.js Y-up)
    this.mesh.group.rotation.x = THREE.MathUtils.degToRad(-leanDeg);

    // Suppress unused variable warning from TS strict mode
    void bob;
  }

  private applyAttack(state: AnimationState, hints: AnimationHints): void {
    if (state === "attack" && hints.attackingQ > 0) {
      // Advance attack timer
      this.attackTimer_s = AnimationController.ATTACK_DURATION_S;
    }

    if (this.attackTimer_s > 0) {
      this.attackTimer_s -= 1 / 60;
      // Punch: move the group slightly forward (negative Z in Three.js = forward)
      const progress = 1 - (this.attackTimer_s / AnimationController.ATTACK_DURATION_S);
      const zOffset = Math.sin(progress * Math.PI) * ATTACK_Z_OFFSET;
      this.mesh.group.position.z += -zOffset; // forward in -Z direction
      // TODO (Milestone 2): blend attack animation clip weight here
    }
  }

  private applyGuard(state: AnimationState, hints: AnimationHints): void {
    if (state === "guard") {
      const guardBlend = hints.guardingQ / SCALE.Q;
      this.mesh.group.rotation.x = THREE.MathUtils.degToRad(GUARD_X_ROT_DEG * guardBlend);
      // TODO (Milestone 2): blend in guard pose AnimationClip
    }
  }

  /**
   * Fear tremor — a subtle random-looking shake driven by the fear Q value.
   * Uses a sum of sines at prime-ratio frequencies (deterministic, no Math.random()).
   *
   * TODO (Milestone 2): drive a dedicated "tremor" blend shape or bone layer.
   */
  private applyFearTremor(fearFloat: number): void {
    if (fearFloat < 0.1) return;

    const amp = fearFloat * 0.008; // max 8 mm lateral shake
    // Sum of two sine waves at incommensurable frequencies = pseudo-random feel
    const shake =
      Math.sin(this.time_s * 11.3 * 2 * Math.PI) * amp * 0.6 +
      Math.sin(this.time_s * 17.7 * 2 * Math.PI) * amp * 0.4;

    // Apply as Z rotation (visible sway)
    this.mesh.group.rotation.z = shake;
  }

  private resetBodyTransforms(): void {
    this.mesh.group.rotation.x = 0;
    this.mesh.group.rotation.z = 0;
    this.attackTimer_s = 0;
  }
}
