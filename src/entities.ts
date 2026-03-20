// src/entities.ts — EntityMesh: capsule-geometry humanoid per entity.
//
// Each entity is represented as a THREE.Group containing:
//   - A capsule body (CapsuleGeometry)
//   - A directional indicator disc (shows facing)
//   - A team-colour rim ring
//
// Milestone 2 will replace the capsule with a skinned SkinnedMesh driven
// by the BridgeEngine's poseModifiers. For now the capsule is the MVP stand-in.

import * as THREE from "three";

// ── Team colours ──────────────────────────────────────────────────────────────

export type TeamColourMap = Map<number, THREE.ColorRepresentation>;

/** Default team palette. Extend or replace via AnankeRendererOptions. */
export const TEAM_COLOURS: TeamColourMap = new Map([
  [1, 0x3399ff], // team 1 — blue
  [2, 0xff4422], // team 2 — red
  [3, 0x22cc44], // team 3 — green
  [4, 0xffcc00], // team 4 — yellow
]);

const FALLBACK_COLOUR: THREE.ColorRepresentation = 0xaaaaaa;

// ── Capsule geometry constants ────────────────────────────────────────────────

const CAPSULE_RADIUS  = 0.25; // metres
const CAPSULE_LENGTH  = 1.25; // metres (cylindrical section between hemispheres)
const CAPSULE_HEIGHT  = CAPSULE_RADIUS * 2 + CAPSULE_LENGTH; // total: 1.75 m
const CAPSULE_Y_OFFSET = CAPSULE_HEIGHT / 2; // lift capsule so feet are at y=0

// ── EntityMesh ────────────────────────────────────────────────────────────────

/**
 * EntityMesh wraps all Three.js objects for a single entity.
 *
 * Call build() once after construction, then add group to the scene.
 * Call dispose() when the entity is removed from the world.
 */
export class EntityMesh {
  readonly entityId: number;
  readonly teamId: number;

  /** Root group — translate this to move the entity. */
  readonly group: THREE.Group;

  // Internal meshes
  private bodyMesh!: THREE.Mesh;
  private bodyMaterial!: THREE.MeshLambertMaterial;
  private facingDisc!: THREE.Mesh;
  private rimRing!: THREE.Mesh;

  // State tracking (avoid redundant material updates)
  private isDead: boolean = false;
  private isUnconscious: boolean = false;
  private isProne: boolean = false;

  constructor(entityId: number, teamId: number) {
    this.entityId = entityId;
    this.teamId   = teamId;
    this.group    = new THREE.Group();
    this.group.name = `entity_${entityId}`;
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  /**
   * Build Three.js geometry and add it to this.group.
   * Must be called once before the group is added to the scene.
   */
  build(): void {
    const teamColour = TEAM_COLOURS.get(this.teamId) ?? FALLBACK_COLOUR;

    // ── Body capsule ───────────────────────────────────────────────────
    const capsuleGeo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 8, 16);

    // TODO (Milestone 2): replace with a skinned mesh and skeleton rig
    this.bodyMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color(teamColour),
    });

    this.bodyMesh = new THREE.Mesh(capsuleGeo, this.bodyMaterial);
    this.bodyMesh.position.y = CAPSULE_Y_OFFSET;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = false;
    this.group.add(this.bodyMesh);

    // ── Facing indicator disc ──────────────────────────────────────────
    // A small flat disc at the front of the capsule base showing facing direction.
    const discGeo = new THREE.CircleGeometry(0.12, 12);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.6, transparent: true });
    this.facingDisc = new THREE.Mesh(discGeo, discMat);
    this.facingDisc.position.set(0, 0.02, -CAPSULE_RADIUS - 0.05); // in front of capsule base
    this.group.add(this.facingDisc);

    // ── Team rim ring ──────────────────────────────────────────────────
    const ringGeo = new THREE.TorusGeometry(CAPSULE_RADIUS + 0.06, 0.03, 6, 32);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColour) });
    this.rimRing = new THREE.Mesh(ringGeo, ringMat);
    this.rimRing.position.y = 0.02;
    this.group.add(this.rimRing);
  }

  // ── State setters ─────────────────────────────────────────────────────────

  /**
   * Toggle the dead visual state (grey, collapsed rotation).
   * When dead, prone rotation is also applied and the entity is greyed out.
   */
  setDead(dead: boolean): void {
    if (this.isDead === dead) return;
    this.isDead = dead;

    if (dead) {
      this.bodyMaterial.color.set(0x555555);
      this.bodyMaterial.opacity = 0.7;
      this.bodyMaterial.transparent = true;
      // Rotate capsule to lie on its side — Z-axis rotation 90° puts it horizontal.
      this.bodyMesh.rotation.z = Math.PI / 2;
      this.bodyMesh.position.set(0, CAPSULE_RADIUS, 0);
      this.facingDisc.visible = false;
    } else {
      // Restore upright state (setUnconscious will re-apply if needed).
      this.bodyMesh.rotation.z = 0;
      this.bodyMesh.position.y = CAPSULE_Y_OFFSET;
      this.facingDisc.visible = true;
      this.refreshColour();
    }
  }

  /**
   * Toggle the unconscious visual state (darkened, slightly tilted).
   */
  setUnconscious(unconscious: boolean): void {
    if (this.isUnconscious === unconscious) return;
    this.isUnconscious = unconscious;

    if (unconscious && !this.isDead) {
      this.bodyMaterial.color.set(0x334455);
      // Tilt 60° — not fully flat (that is reserved for dead/prone)
      this.bodyMesh.rotation.z = Math.PI / 3;
      this.bodyMesh.position.set(0, CAPSULE_RADIUS + 0.1, 0);
    } else if (!this.isDead) {
      this.bodyMesh.rotation.z = 0;
      this.bodyMesh.position.y = CAPSULE_Y_OFFSET;
      this.refreshColour();
    }
  }

  /**
   * Toggle prone posture — capsule rotates to horizontal.
   */
  setProne(prone: boolean): void {
    if (this.isProne === prone) return;
    this.isProne = prone;

    // Dead handling overrides prone rotation — skip if dead
    if (this.isDead) return;

    if (prone && !this.isUnconscious) {
      this.bodyMesh.rotation.z = Math.PI / 2;
      this.bodyMesh.position.set(0, CAPSULE_RADIUS + 0.02, 0);
      this.facingDisc.visible = false;
    } else if (!this.isUnconscious) {
      this.bodyMesh.rotation.z = 0;
      this.bodyMesh.position.y = CAPSULE_Y_OFFSET;
      this.facingDisc.visible = true;
    }
  }

  /**
   * Drive shock visual — adds a red emissive flash proportional to shockFloat [0, 1].
   * At high shock values the capsule flickers red (hit feedback).
   *
   * TODO (Milestone 2): replace with a post-processing pass (bloom / vignette).
   */
  setShockIntensity(shockFloat: number): void {
    if (this.isDead) return;
    const r = Math.min(1, shockFloat * 2);
    this.bodyMaterial.emissive.set(r * 0.6, 0, 0);
  }

  /**
   * Apply a per-segment injury tint to a named bone.
   * Currently a stub — Milestone 2 will drive actual bone transforms.
   *
   * @param boneName  The Three.js bone name from the segment mapping.
   * @param impairment Normalised impairment [0, 1] from mod.impairmentQ / SCALE.Q.
   *
   * TODO (Milestone 2): traverse skeleton, find bone by name, apply transform/blend.
   */
  setSegmentImpairment(_boneName: string, _impairment: number): void {
    // Stub: no-op until skeleton rig is wired up.
    // When Milestone 2 is implemented:
    //   const bone = this.skeleton.getBoneByName(boneName);
    //   if (bone) { bone.scale.setScalar(1 - impairment * 0.2); }
  }

  // ── Disposal ───────────────────────────────────────────────────────────────

  dispose(): void {
    this.bodyMesh.geometry.dispose();
    this.bodyMaterial.dispose();
    (this.facingDisc.material as THREE.MeshBasicMaterial).dispose();
    this.facingDisc.geometry.dispose();
    (this.rimRing.material as THREE.MeshBasicMaterial).dispose();
    this.rimRing.geometry.dispose();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private refreshColour(): void {
    const teamColour = TEAM_COLOURS.get(this.teamId) ?? FALLBACK_COLOUR;
    this.bodyMaterial.color.set(teamColour);
    this.bodyMaterial.opacity = 1;
    this.bodyMaterial.transparent = false;
    this.bodyMaterial.emissive.set(0, 0, 0);
  }
}
