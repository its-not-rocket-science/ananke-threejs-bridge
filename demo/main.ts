import { SCALE, deriveAnimationHints } from "@its-not-rocket-science/ananke";

import { AnankeRenderer, SimLoop } from "../src/index.js";

const canvas = document.getElementById("ananke-canvas") as HTMLCanvasElement;
const seedInput = document.getElementById("seed-input") as HTMLInputElement;
const startButton = document.getElementById("start-btn") as HTMLButtonElement;
const resetButton = document.getElementById("reset-btn") as HTMLButtonElement;
const replayButton = document.getElementById("replay-btn") as HTMLButtonElement;
const speedSelect = document.getElementById("speed-select") as HTMLSelectElement;
const tickDisplay = document.getElementById("tick-display") as HTMLSpanElement;
const statusDisplay = document.getElementById("sim-status") as HTMLSpanElement;

const renderer = new AnankeRenderer(canvas);
renderer.init();
renderer.startRenderLoop();

const simLoop = new SimLoop({
  seed: Number(seedInput.value),
  onReset(world) {
    renderer.reset();
    renderer.writeSimFrame(world);
    updateHud(world);
  },
  onTick(world) {
    renderer.writeSimFrame(world);
    updateHud(world);
  },
  onStop(world) {
    updateHud(world);
    syncButtons();
  },
});

renderer.writeSimFrame(simLoop.getWorld());
updateHud(simLoop.getWorld());
syncButtons();

startButton.addEventListener("click", () => {
  if (simLoop.running) {
    simLoop.stop();
  } else {
    simLoop.start();
  }
  syncButtons();
});

resetButton.addEventListener("click", () => {
  const seed = Math.max(1, Math.trunc(Number(seedInput.value) || 1));
  seedInput.value = String(seed);
  simLoop.reset(seed);
  syncButtons();
});

replayButton.addEventListener("click", () => {
  const replayJson = simLoop.serializeReplay();
  const url = URL.createObjectURL(new Blob([replayJson], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = simLoop.downloadReplayFilename();
  link.click();
  URL.revokeObjectURL(url);
});

speedSelect.addEventListener("change", () => {
  simLoop.setSpeed(Number(speedSelect.value));
});

window.addEventListener("beforeunload", () => {
  simLoop.stop();
  renderer.dispose();
});

function updateHud(world: ReturnType<SimLoop["getWorld"]>): void {
  tickDisplay.textContent = `tick: ${world.tick}`;
  statusDisplay.textContent = simLoop.running ? "running" : (isFightOver(world) ? "finished" : "paused");

  for (const entity of world.entities.slice(0, 2)) {
    const index = entity.id;
    const consciousness = document.getElementById(`bar${index}-consciousness`) as HTMLDivElement;
    const shock = document.getElementById(`bar${index}-shock`) as HTMLDivElement;
    const fear = document.getElementById(`bar${index}-fear`) as HTMLDivElement;
    const status = document.getElementById(`status-${index}`) as HTMLDivElement;

    consciousness.style.width = `${Math.max(0, Math.min(100, (entity.injury.consciousness / SCALE.Q) * 100))}%`;
    shock.style.width = `${Math.max(0, Math.min(100, (entity.injury.shock / SCALE.Q) * 100))}%`;
    fear.style.width = `${Math.max(0, Math.min(100, ((entity.condition.fearQ ?? 0) / SCALE.Q) * 100))}%`;

    const hints = deriveAnimationHints(entity);
    const labels = [
      hints.dead ? "dead" : null,
      hints.unconscious ? "unconscious" : null,
      hints.prone ? "prone" : null,
      hints.attackingQ > SCALE.Q / 2 ? "attacking" : null,
      hints.guardingQ > SCALE.Q / 4 ? "guarding" : null,
      hints.run === SCALE.Q ? "running" : null,
      hints.walk === SCALE.Q ? "walking" : null,
      !hints.dead && !hints.unconscious && !hints.prone && hints.idle === SCALE.Q ? "idle" : null,
    ].filter((value): value is string => value !== null);

    status.textContent = labels.join(" · ") || "engaged";
  }
}

function isFightOver(world: ReturnType<SimLoop["getWorld"]>): boolean {
  const livingTeams = new Set(world.entities.filter((entity) => !entity.injury.dead).map((entity) => entity.teamId));
  return livingTeams.size <= 1;
}

function syncButtons(): void {
  startButton.textContent = simLoop.running ? "Pause" : "Start";
}
