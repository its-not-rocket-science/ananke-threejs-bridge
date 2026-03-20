import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { SegmentBoneMapper } from "./SegmentBoneMapper.js";

export type TeamColourMap = Map<number, THREE.ColorRepresentation>;

export const TEAM_COLOURS: TeamColourMap = new Map([
  [1, 0x3399ff],
  [2, 0xff4422],
  [3, 0x22cc44],
  [4, 0xffcc00],
]);

const FALLBACK_COLOUR: THREE.ColorRepresentation = 0xaaaaaa;
const CAPSULE_RADIUS = 0.25;
const CAPSULE_LENGTH = 1.25;
const CAPSULE_HEIGHT = CAPSULE_RADIUS * 2 + CAPSULE_LENGTH;
const CAPSULE_Y_OFFSET = CAPSULE_HEIGHT / 2;
const MODEL_URL = new URL("../public/models/cc0-humanoid.gltf", import.meta.url).href;

interface HumanoidAsset {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export class EntityMesh {
  readonly entityId: number;
  readonly teamId: number;
  readonly group: THREE.Group;
  readonly visualRoot: THREE.Group;

  private static assetPromise: Promise<HumanoidAsset> | null = null;

  private bodyMesh!: THREE.Mesh;
  private bodyMaterial!: THREE.MeshLambertMaterial;
  private facingDisc!: THREE.Mesh;
  private rimRing!: THREE.Mesh;
  private modelRoot: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationAction>();
  private mapper: SegmentBoneMapper | null = null;
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private activeClip = "Idle";

  private isDead = false;
  private isUnconscious = false;
  private isProne = false;

  constructor(entityId: number, teamId: number) {
    this.entityId = entityId;
    this.teamId = teamId;
    this.group = new THREE.Group();
    this.group.name = `entity_${entityId}`;
    this.visualRoot = new THREE.Group();
    this.visualRoot.name = `entity_${entityId}_visual`;
    this.group.add(this.visualRoot);
  }

  build(): void {
    const teamColour = TEAM_COLOURS.get(this.teamId) ?? FALLBACK_COLOUR;

    const capsuleGeo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 8, 16);
    this.bodyMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(teamColour) });
    this.bodyMesh = new THREE.Mesh(capsuleGeo, this.bodyMaterial);
    this.bodyMesh.position.y = CAPSULE_Y_OFFSET;
    this.bodyMesh.castShadow = true;
    this.visualRoot.add(this.bodyMesh);

    const discGeo = new THREE.CircleGeometry(0.12, 12);
    discGeo.rotateX(-Math.PI / 2);
    this.facingDisc = new THREE.Mesh(
      discGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.6, transparent: true }),
    );
    this.facingDisc.position.set(0, 0.02, -CAPSULE_RADIUS - 0.05);
    this.group.add(this.facingDisc);

    const ringGeo = new THREE.TorusGeometry(CAPSULE_RADIUS + 0.12, 0.03, 8, 32);
    ringGeo.rotateX(Math.PI / 2);
    this.rimRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColour) }),
    );
    this.rimRing.position.y = 0.02;
    this.group.add(this.rimRing);

    void this.attachHumanoidModel();
  }

  hasClipAnimation(): boolean {
    return this.mixer !== null && this.clips.size > 0;
  }

  playClip(clipName: "Idle" | "Attack" | "Prone" | "Unconscious", fadeSeconds: number): void {
    if (!this.mixer) {
      return;
    }

    const next = this.clips.get(clipName);
    const current = this.clips.get(this.activeClip);
    if (!next) {
      return;
    }

    if (this.activeClip === clipName && clipName !== "Attack") {
      return;
    }

    if (clipName === "Attack") {
      next.reset();
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
      next.fadeIn(fadeSeconds).play();
      if (current && current !== next) {
        current.fadeOut(fadeSeconds * 0.75);
      }
      this.activeClip = clipName;
      return;
    }

    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.fadeIn(fadeSeconds).play();

    if (current && current !== next) {
      current.fadeOut(fadeSeconds);
    }

    this.activeClip = clipName;
  }

  setClipTimeScale(scale: number): void {
    const action = this.clips.get(this.activeClip);
    if (action) {
      action.timeScale = scale;
    }
  }

  updateMixer(deltaSeconds: number): void {
    this.mixer?.update(deltaSeconds);
  }

  setDead(dead: boolean): void {
    this.isDead = dead;
    this.refreshColour();
    if (!this.modelRoot) {
      if (dead) {
        this.bodyMesh.rotation.z = Math.PI / 2;
        this.bodyMesh.position.set(0, CAPSULE_RADIUS, 0);
        this.facingDisc.visible = false;
      } else {
        this.bodyMesh.rotation.z = 0;
        this.bodyMesh.position.set(0, CAPSULE_Y_OFFSET, 0);
        this.facingDisc.visible = true;
      }
    }
  }

  setUnconscious(unconscious: boolean): void {
    this.isUnconscious = unconscious;
    this.refreshColour();
    if (!this.modelRoot && !this.isDead) {
      if (unconscious) {
        this.bodyMesh.rotation.z = Math.PI / 3;
        this.bodyMesh.position.set(0, CAPSULE_RADIUS + 0.1, 0);
      } else {
        this.bodyMesh.rotation.z = 0;
        this.bodyMesh.position.set(0, CAPSULE_Y_OFFSET, 0);
      }
    }
  }

  setProne(prone: boolean): void {
    this.isProne = prone;
    if (!this.modelRoot && !this.isDead && !this.isUnconscious) {
      if (prone) {
        this.bodyMesh.rotation.z = Math.PI / 2;
        this.bodyMesh.position.set(0, CAPSULE_RADIUS + 0.02, 0);
        this.facingDisc.visible = false;
      } else {
        this.bodyMesh.rotation.z = 0;
        this.bodyMesh.position.set(0, CAPSULE_Y_OFFSET, 0);
        this.facingDisc.visible = true;
      }
    }
  }

  setShockIntensity(shockFloat: number): void {
    const emissive = Math.min(0.4, shockFloat * 0.4);
    this.bodyMaterial.emissive.setRGB(emissive, 0, 0);
    for (const material of this.modelMaterials) {
      material.emissive.setRGB(emissive, 0, 0);
      material.needsUpdate = true;
    }
  }

  setSegmentImpairment(boneName: string, impairment: number): void {
    this.mapper?.applyImpairment(boneName, impairment);
  }

  resetPoseModifiers(): void {
    this.mapper?.resetImpairments();
  }

  resetVisualPose(): void {
    this.visualRoot.position.set(0, 0, 0);
    this.visualRoot.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.bodyMesh.geometry.dispose();
    this.bodyMaterial.dispose();
    (this.facingDisc.material as THREE.Material).dispose();
    this.facingDisc.geometry.dispose();
    (this.rimRing.material as THREE.Material).dispose();
    this.rimRing.geometry.dispose();
    this.mixer?.stopAllAction();
    this.modelMaterials.forEach((material) => material.dispose());
    this.modelRoot?.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
  }

  private async attachHumanoidModel(): Promise<void> {
    try {
      const asset = await EntityMesh.loadHumanoidAsset();
      const clonedRoot = cloneSkeleton(asset.scene);
      clonedRoot.position.y = 0;
      clonedRoot.scale.setScalar(0.92);
      clonedRoot.visible = true;

      this.mapper = SegmentBoneMapper.fromObject(clonedRoot);
      this.modelRoot = clonedRoot;
      this.visualRoot.add(clonedRoot);
      this.bodyMesh.visible = false;

      this.modelMaterials = [];
      clonedRoot.traverse((child: THREE.Object3D) => {
        if (!(child instanceof THREE.Mesh)) {
          return;
        }
        child.castShadow = true;
        child.receiveShadow = false;
        const material = Array.isArray(child.material) ? child.material[0] : child.material;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.set(TEAM_COLOURS.get(this.teamId) ?? FALLBACK_COLOUR);
          material.roughness = 0.95;
          material.metalness = 0.05;
          this.modelMaterials.push(material);
        }
      });

      this.mixer = new THREE.AnimationMixer(clonedRoot);
      this.clips = new Map(
        asset.animations.map((clip) => {
          const action = this.mixer!.clipAction(clip);
          action.enabled = true;
          return [clip.name, action] as const;
        }),
      );
      this.playClip("Idle", 0);
      this.refreshColour();
    } catch (error) {
      console.warn("Failed to load CC0 humanoid model, using capsule fallback.", error);
    }
  }

  private refreshColour(): void {
    const teamColour = TEAM_COLOURS.get(this.teamId) ?? FALLBACK_COLOUR;
    const displayColour = this.isDead
      ? 0x555555
      : this.isUnconscious
        ? 0x5f6a7a
        : teamColour;

    this.bodyMaterial.color.set(displayColour);
    this.bodyMaterial.opacity = this.isDead ? 0.7 : 1;
    this.bodyMaterial.transparent = this.isDead;

    for (const material of this.modelMaterials) {
      material.color.set(displayColour);
      material.opacity = this.isDead ? 0.78 : 1;
      material.transparent = this.isDead;
      material.needsUpdate = true;
    }

    this.facingDisc.visible = !(this.isDead || this.isProne);
  }

  private static loadHumanoidAsset(): Promise<HumanoidAsset> {
    if (!EntityMesh.assetPromise) {
      const loader = new GLTFLoader();
      EntityMesh.assetPromise = loader.loadAsync(MODEL_URL).then((gltf: GLTF) => ({
        scene: gltf.scene,
        animations: gltf.animations,
      }));
    }
    return EntityMesh.assetPromise;
  }
}
