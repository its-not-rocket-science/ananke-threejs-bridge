import { ReplayRecorder, createWorld, q, serializeReplay, stepWorld } from "@its-not-rocket-science/ananke";
import type { CommandMap, WorldState } from "@its-not-rocket-science/ananke";
import type { KernelContext } from "../node_modules/@its-not-rocket-science/ananke/dist/src/sim/context.js";
import { buildAICommands } from "../node_modules/@its-not-rocket-science/ananke/dist/src/sim/ai/system.js";
import { AI_PRESETS } from "../node_modules/@its-not-rocket-science/ananke/dist/src/sim/ai/presets.js";
import { buildSpatialIndex } from "../node_modules/@its-not-rocket-science/ananke/dist/src/sim/spatial.js";
import { TICK_HZ } from "../node_modules/@its-not-rocket-science/ananke/dist/src/sim/tick.js";
import { buildWorldIndex } from "../node_modules/@its-not-rocket-science/ananke/dist/src/sim/indexing.js";

const TICK_INTERVAL_MS = Math.round(1000 / TICK_HZ);
const DEFAULT_MAX_TICKS = TICK_HZ * 90;

export interface SimLoopOptions {
  seed: number;
  maxTicks?: number;
  onTick?: (world: WorldState) => void;
  onReset?: (world: WorldState) => void;
  onStop?: (world: WorldState) => void;
}

export class SimLoop {
  private readonly context: KernelContext = { tractionCoeff: q(0.9) };
  private readonly maxTicks: number;
  private readonly onTick: ((world: WorldState) => void) | undefined;
  private readonly onReset: ((world: WorldState) => void) | undefined;
  private readonly onStop: ((world: WorldState) => void) | undefined;

  private intervalId: number | null = null;
  private seed: number;
  private speed = 1;
  private world: WorldState;
  private recorder: ReplayRecorder;

  constructor(options: SimLoopOptions) {
    this.seed = options.seed;
    this.maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
    this.onTick = options.onTick;
    this.onReset = options.onReset;
    this.onStop = options.onStop;
    this.world = this.createScenario(this.seed);
    this.recorder = new ReplayRecorder(this.world);
  }

  getWorld(): WorldState {
    return this.world;
  }

  getSeed(): number {
    return this.seed;
  }

  get running(): boolean {
    return this.intervalId !== null;
  }

  start(): void {
    if (this.intervalId !== null) {
      return;
    }

    this.intervalId = window.setInterval(() => {
      for (let iteration = 0; iteration < this.speed; iteration += 1) {
        this.tick();
        if (!this.running) {
          break;
        }
      }
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
      this.onStop?.(this.world);
    }
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(1, Math.round(speed));
  }

  reset(seed = this.seed): WorldState {
    this.stop();
    this.seed = seed;
    this.world = this.createScenario(seed);
    this.recorder = new ReplayRecorder(this.world);
    this.onReset?.(this.world);
    return this.world;
  }

  downloadReplayFilename(): string {
    return `ananke-replay-seed-${this.seed}-tick-${this.world.tick}.json`;
  }

  serializeReplay(): string {
    return serializeReplay(this.recorder.toReplay());
  }

  private tick(): void {
    if (this.isFightOver() || this.world.tick >= this.maxTicks) {
      this.stop();
      return;
    }

    const cmds = this.buildCommands();
    this.recorder.record(this.world.tick, cmds);
    stepWorld(this.world, cmds, this.context);
    this.onTick?.(this.world);

    if (this.isFightOver() || this.world.tick >= this.maxTicks) {
      this.stop();
    }
  }

  private buildCommands(): CommandMap {
    const index = buildWorldIndex(this.world);
    const spatial = buildSpatialIndex(this.world, 4);
    const preset = AI_PRESETS.lineInfantry;
    return buildAICommands(this.world, index, spatial, () => preset);
  }

  private createScenario(seed: number): WorldState {
    return createWorld(seed, [
      {
        id: 1,
        teamId: 1,
        seed: seed * 17 + 1,
        archetype: "KNIGHT_INFANTRY",
        weaponId: "wpn_arming_sword",
        armourId: "arm_mail_shirt",
        x_m: -2,
        y_m: 0,
      },
      {
        id: 2,
        teamId: 2,
        seed: seed * 17 + 2,
        archetype: "PRO_BOXER",
        weaponId: "wpn_riot_baton",
        armourId: "arm_gambeson",
        x_m: 2,
        y_m: 0,
      },
    ]);
  }

  private isFightOver(): boolean {
    const livingTeams = new Set(
      this.world.entities
        .filter((entity) => !entity.injury.dead)
        .map((entity) => entity.teamId),
    );
    return livingTeams.size <= 1;
  }
}
