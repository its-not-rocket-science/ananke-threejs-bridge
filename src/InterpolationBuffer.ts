import {
  SCALE,
  extractRigSnapshots,
  findBodyPlanMapping,
  interpolateAnimationHints,
  interpolateCondition,
  interpolatePoseModifiers,
  lerpVec3,
  mapPoseModifiers,
  slerpFacing,
} from "@its-not-rocket-science/ananke";
import type {
  BridgeConfig,
  InterpolatedState,
  TickSnapshot,
  WorldState,
} from "@its-not-rocket-science/ananke";
import type { ConditionSample, MotionVector } from "../node_modules/@its-not-rocket-science/ananke/dist/src/debug.js";
import { extractConditionSamples, extractMotionVectors } from "../node_modules/@its-not-rocket-science/ananke/dist/src/debug.js";
import { DT_S } from "../node_modules/@its-not-rocket-science/ananke/dist/src/sim/tick.js";

interface EntityBufferRecord {
  bodyPlanId: string;
  previous: TickSnapshot | null;
  current: TickSnapshot | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class InterpolationBuffer {
  private readonly entities = new Map<number, EntityBufferRecord>();

  private config: BridgeConfig;
  private previousTick = 0;
  private currentTick = 0;
  private previousTime_s = 0;
  private currentTime_s = 0;

  constructor(config: BridgeConfig) {
    this.config = config;
  }

  updateConfig(config: BridgeConfig): void {
    this.config = config;
  }

  setEntityBodyPlan(entityId: number, bodyPlanId: string): void {
    const record = this.entities.get(entityId);
    if (record) {
      record.bodyPlanId = bodyPlanId;
      return;
    }

    this.entities.set(entityId, {
      bodyPlanId,
      previous: null,
      current: null,
    });
  }

  pushWorld(world: WorldState): TickSnapshot[] {
    const rigs = extractRigSnapshots(world);
    const motionByEntity = new Map<number, MotionVector>(
      extractMotionVectors(world).map((motion: MotionVector) => [motion.entityId, motion]),
    );
    const conditionByEntity = new Map<number, ConditionSample>(
      extractConditionSamples(world).map((condition: ConditionSample) => [condition.entityId, condition]),
    );

    const snapshots = rigs.map<TickSnapshot>((rig) => {
      const motion = motionByEntity.get(rig.entityId);
      const condition = conditionByEntity.get(rig.entityId);

      return {
        entityId: rig.entityId,
        teamId: rig.teamId,
        tick: rig.tick,
        position_m: motion?.position_m ?? { x: 0, y: 0, z: 0 },
        velocity_mps: motion?.velocity_mps ?? { x: 0, y: 0, z: 0 },
        facing: motion?.facing ?? { x: SCALE.Q, y: 0, z: 0 },
        animation: rig.animation,
        poseModifiers: rig.pose,
        grapple: rig.grapple,
        condition: {
          shockQ: condition?.shock ?? rig.animation.shockQ,
          fearQ: condition?.fearQ ?? rig.animation.fearQ,
          consciousness: condition?.consciousness ?? SCALE.Q,
          fluidLoss: condition?.fluidLoss ?? 0,
          dead: condition?.dead ?? rig.animation.dead,
        },
      };
    });

    this.pushSnapshots(snapshots);
    return snapshots;
  }

  pushSnapshots(snapshots: TickSnapshot[]): void {
    for (const record of this.entities.values()) {
      record.previous = record.current;
      record.current = null;
    }

    if (snapshots.length === 0) {
      return;
    }

    if (this.currentTick > 0) {
      this.previousTick = this.currentTick;
      this.previousTime_s = this.currentTime_s;
    }

    this.currentTick = snapshots[0]?.tick ?? this.currentTick + 1;
    this.currentTime_s = this.currentTick * (DT_S / SCALE.s);

    for (const snapshot of snapshots) {
      const record = this.entities.get(snapshot.entityId) ?? {
        bodyPlanId: "humanoid",
        previous: null,
        current: null,
      };
      record.current = snapshot;
      this.entities.set(snapshot.entityId, record);
    }
  }

  getInterpolatedState(entityId: number, renderTime_s: number): InterpolatedState | null {
    const record = this.entities.get(entityId);
    if (!record) {
      return null;
    }

    const previous = record.previous;
    const current = record.current;
    if (!previous && !current) {
      return null;
    }

    const from = previous ?? current;
    const to = current ?? previous;
    if (!from || !to) {
      return null;
    }

    const singleSnapshot = !previous || !current;
    const extrapolationAllowed = this.config.extrapolationAllowed ?? false;
    const defaultBoneName = this.config.defaultBoneName ?? "Hips";

    let interpolationFactorQ = SCALE.Q;
    let fromTick = from.tick;
    let toTick = to.tick;
    let shouldExtrapolate = false;

    if (!singleSnapshot) {
      if (renderTime_s <= this.previousTime_s) {
        interpolationFactorQ = 0;
        fromTick = previous.tick;
        toTick = previous.tick;
      } else if (renderTime_s >= this.currentTime_s) {
        interpolationFactorQ = SCALE.Q;
        fromTick = current.tick;
        toTick = current.tick;
        shouldExtrapolate = extrapolationAllowed;
      } else {
        const interval_s = this.currentTime_s - this.previousTime_s;
        const alpha = interval_s <= 0 ? 1 : clamp01((renderTime_s - this.previousTime_s) / interval_s);
        interpolationFactorQ = Math.round(alpha * SCALE.Q);
        fromTick = previous.tick;
        toTick = current.tick;
      }
    }

    const mapping = findBodyPlanMapping(this.config, record.bodyPlanId);
    const position_m = lerpVec3(from.position_m, to.position_m, interpolationFactorQ);
    const velocity_mps = lerpVec3(from.velocity_mps, to.velocity_mps, interpolationFactorQ);
    const facing = slerpFacing(from.facing, to.facing, interpolationFactorQ);
    const animation = interpolateAnimationHints(from.animation, to.animation, interpolationFactorQ);
    const pose = interpolatePoseModifiers(from.poseModifiers, to.poseModifiers, interpolationFactorQ);
    const condition = interpolateCondition(from.condition, to.condition, interpolationFactorQ);

    if (shouldExtrapolate) {
      const delta_s = Math.max(0, renderTime_s - this.currentTime_s);
      const deltaFixed = Math.round(delta_s * SCALE.s);
      position_m.x += Math.trunc((to.velocity_mps.x * deltaFixed) / SCALE.s);
      position_m.y += Math.trunc((to.velocity_mps.y * deltaFixed) / SCALE.s);
      position_m.z += Math.trunc((to.velocity_mps.z * deltaFixed) / SCALE.s);
    }

    const poseModifiers = mapping
      ? mapPoseModifiers(pose, mapping, defaultBoneName)
      : pose.map((modifier) => ({
          segmentId: modifier.segmentId,
          boneName: defaultBoneName,
          impairmentQ: modifier.impairmentQ,
          structuralQ: modifier.structuralQ,
          surfaceQ: modifier.surfaceQ,
        }));

    return {
      entityId,
      teamId: to.teamId,
      position_m,
      velocity_mps,
      facing,
      animation,
      poseModifiers,
      grapple: interpolationFactorQ < SCALE.Q / 2 ? from.grapple : to.grapple,
      condition,
      interpolationFactor: interpolationFactorQ,
      fromTick,
      toTick,
    };
  }

  getLatestSimTime(): number {
    return this.currentTime_s;
  }

  getLatestTick(): number {
    return this.currentTick;
  }

  hasEntity(entityId: number): boolean {
    const record = this.entities.get(entityId);
    return Boolean(record && (record.previous || record.current));
  }

  removeEntity(entityId: number): void {
    this.entities.delete(entityId);
  }

  clear(): void {
    this.entities.clear();
    this.previousTick = 0;
    this.currentTick = 0;
    this.previousTime_s = 0;
    this.currentTime_s = 0;
  }
}
