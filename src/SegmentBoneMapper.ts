import * as THREE from "three";
import type { BodyPlanMapping } from "@its-not-rocket-science/ananke";

export const DEFAULT_HUMANOID_SEGMENT_BONES: Record<string, string[]> = {
  head: ["Head", "Neck"],
  torso: ["Chest", "Spine", "Hips"],
  leftArm: ["UpperArm.L", "LowerArm.L", "Hand.L"],
  rightArm: ["UpperArm.R", "LowerArm.R", "Hand.R"],
  leftLeg: ["UpperLeg.L", "LowerLeg.L", "Foot.L"],
  rightLeg: ["UpperLeg.R", "LowerLeg.R", "Foot.R"],
};

export class SegmentBoneMapper {
  readonly skeleton: THREE.Skeleton;
  readonly mapping: BodyPlanMapping;

  private readonly boneLookup = new Map<string, THREE.Bone>();
  private readonly baseScales = new Map<string, THREE.Vector3>();
  private readonly baseQuaternions = new Map<string, THREE.Quaternion>();

  constructor(skeleton: THREE.Skeleton, mapping: BodyPlanMapping) {
    this.skeleton = skeleton;
    this.mapping = mapping;

    for (const bone of skeleton.bones) {
      this.boneLookup.set(bone.name, bone);
      this.baseScales.set(bone.name, bone.scale.clone());
      this.baseQuaternions.set(bone.name, bone.quaternion.clone());
    }
  }

  static fromObject(root: THREE.Object3D, bodyPlanId = "humanoid"): SegmentBoneMapper | null {
    let foundSkeleton: THREE.Skeleton | null = null;
    root.traverse((child) => {
      if (foundSkeleton || !(child instanceof THREE.SkinnedMesh) || !child.skeleton) {
        return;
      }
      foundSkeleton = child.skeleton;
    });

    if (!foundSkeleton) {
      return null;
    }

    const segments = Object.entries(DEFAULT_HUMANOID_SEGMENT_BONES)
      .map(([segmentId, candidates]) => {
        const boneName = candidates.find((candidate) => foundSkeleton!.getBoneByName(candidate)?.name === candidate);
        return boneName ? { segmentId, boneName } : null;
      })
      .filter((entry): entry is { segmentId: string; boneName: string } => entry !== null);

    return new SegmentBoneMapper(foundSkeleton, {
      bodyPlanId,
      segments,
    });
  }

  getBone(segmentId: string): THREE.Bone | undefined {
    const mapping = this.mapping.segments.find((segment) => segment.segmentId === segmentId);
    return mapping ? this.boneLookup.get(mapping.boneName) : undefined;
  }

  getBoneName(segmentId: string): string | undefined {
    return this.mapping.segments.find((segment) => segment.segmentId === segmentId)?.boneName;
  }

  resetImpairments(): void {
    for (const [name, bone] of this.boneLookup) {
      const baseScale = this.baseScales.get(name);
      const baseQuaternion = this.baseQuaternions.get(name);
      if (baseScale) {
        bone.scale.copy(baseScale);
      }
      if (baseQuaternion) {
        bone.quaternion.copy(baseQuaternion);
      }
    }
  }

  applyImpairment(boneName: string, impairment: number): void {
    const bone = this.boneLookup.get(boneName);
    const baseScale = this.baseScales.get(boneName);
    const baseQuaternion = this.baseQuaternions.get(boneName);

    if (!bone || !baseScale || !baseQuaternion) {
      return;
    }

    bone.scale.copy(baseScale);
    bone.scale.multiplyScalar(1 - impairment * 0.18);

    bone.quaternion.copy(baseQuaternion);
    const droop = impairment * 0.22;
    if (boneName.includes("Arm")) {
      bone.rotateZ(boneName.endsWith(".L") ? droop : -droop);
    }
    if (boneName.includes("Leg")) {
      bone.rotateX(-droop * 0.6);
    }
    if (boneName === "Head") {
      bone.rotateX(droop * 0.5);
    }
  }
}
