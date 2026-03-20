// src/scene.ts — SceneBuilder: creates the Three.js scene, camera, and lights.
//
// SceneBuilder is intentionally thin. It produces a usable starting scene for
// the demo and can be replaced entirely by the host application — AnankeRenderer
// only requires a THREE.Scene and THREE.PerspectiveCamera from init().

import * as THREE from "three";

// ── Configuration ─────────────────────────────────────────────────────────────

export interface SceneConfig {
  /** Camera field of view in degrees. Default 60. */
  fov: number;
  /** Camera initial position (Three.js world space). Default: above and behind the arena. */
  cameraPosition: THREE.Vector3Like;
  /** Camera look-at target. Default: origin. */
  cameraTarget: THREE.Vector3Like;
  /** Ambient light intensity [0, 1]. Default 0.4. */
  ambientIntensity: number;
  /** Directional light intensity [0, 1]. Default 0.8. */
  directionalIntensity: number;
  /** Whether to add a ground plane. Default true. */
  showGround: boolean;
  /** Ground plane size in metres. Default 30. */
  groundSize: number;
  /** Background colour (CSS string or hex number). Default 0x1a1a2e (dark navy). */
  background: THREE.ColorRepresentation;
  /** Enable fog. Default true. */
  fog: boolean;
  /** Fog near distance in metres. Default 20. */
  fogNear: number;
  /** Fog far distance in metres. Default 60. */
  fogFar: number;
}

const DEFAULTS: SceneConfig = {
  fov: 60,
  cameraPosition: { x: 0, y: 8, z: 14 },
  cameraTarget:   { x: 0, y: 0, z: 0  },
  ambientIntensity: 0.4,
  directionalIntensity: 0.8,
  showGround: true,
  groundSize: 30,
  background: 0x1a1a2e,
  fog: true,
  fogNear: 20,
  fogFar: 60,
};

// ── SceneBuilder ─────────────────────────────────────────────────────────────

export class SceneBuilder {
  private readonly config: SceneConfig;

  constructor(overrides: Partial<SceneConfig> = {}) {
    this.config = { ...DEFAULTS, ...overrides };
  }

  /**
   * Build and return a configured THREE.Scene and THREE.PerspectiveCamera.
   * Both are owned by the caller; dispose of them when done.
   */
  build(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
    const { config } = this;

    // ── Scene ────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(config.background);

    if (config.fog) {
      scene.fog = new THREE.Fog(config.background, config.fogNear, config.fogFar);
    }

    // ── Camera ───────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(
      config.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    camera.position.set(
      config.cameraPosition.x,
      config.cameraPosition.y,
      config.cameraPosition.z,
    );
    camera.lookAt(
      config.cameraTarget.x,
      config.cameraTarget.y,
      config.cameraTarget.z,
    );

    // ── Lighting ─────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, config.ambientIntensity);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfff4e0, config.directionalIntensity);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left  = -15;
    dirLight.shadow.camera.right =  15;
    dirLight.shadow.camera.top   =  15;
    dirLight.shadow.camera.bottom = -15;
    scene.add(dirLight);

    // Rim light from behind for silhouette clarity
    const rimLight = new THREE.DirectionalLight(0x4060ff, 0.3);
    rimLight.position.set(-5, 3, -8);
    scene.add(rimLight);

    // ── Ground plane ─────────────────────────────────────────────────────
    if (config.showGround) {
      this.addGround(scene, config.groundSize);
    }

    return { scene, camera };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private addGround(scene: THREE.Scene, size: number): void {
    // Checker-pattern ground using vertex colours — no texture dependency.
    const geometry = new THREE.PlaneGeometry(size, size, 20, 20);
    geometry.rotateX(-Math.PI / 2);

    // TODO (Milestone 4): replace with a proper terrain mesh driven by WeatherState
    const material = new THREE.MeshLambertMaterial({
      color: 0x2a2a3a,
      side: THREE.FrontSide,
    });

    const ground = new THREE.Mesh(geometry, material);
    ground.receiveShadow = true;
    scene.add(ground);

    // Arena boundary ring (wireframe circle, 5 m radius — matches demo arena)
    const ringGeo = new THREE.TorusGeometry(5, 0.04, 8, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x555577 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);
  }
}
