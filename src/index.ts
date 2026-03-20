// src/index.ts — Public API for ananke-threejs-bridge
//
// Import this module to access the AnankeRenderer and its supporting types.
// The renderer drives a Three.js scene from Ananke WorldState at 60 Hz using
// BridgeEngine interpolation between 20 Hz simulation ticks.

export { AnankeRenderer } from "./renderer.js";
export type { AnankeRendererOptions } from "./renderer.js";

export { SceneBuilder } from "./scene.js";
export type { SceneConfig } from "./scene.js";

export { EntityMesh, TEAM_COLOURS } from "./entities.js";
export type { TeamColourMap } from "./entities.js";

export { AnimationController } from "./animation.js";
export type { AnimationState } from "./animation.js";

// Re-export the humanoid segment mapping for convenience — host code can pass
// this directly to BridgeConfig.mappings without reading bridge-contract.md.
export { HUMANOID_SEGMENT_MAPPING } from "./renderer.js";
