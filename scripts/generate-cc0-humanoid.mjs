class FileReader {
  constructor(){ this.result = null; this.onloadend = null; }
  async readAsArrayBuffer(blob){ this.result = await blob.arrayBuffer(); this.onloadend && this.onloadend(); }
  async readAsDataURL(blob){ const ab = await blob.arrayBuffer(); const b64 = Buffer.from(ab).toString('base64'); this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`; this.onloadend && this.onloadend(); }
}
globalThis.FileReader = FileReader;

import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const scene = new THREE.Scene();

const material = new THREE.MeshStandardMaterial({
  color: 0xd7c8b1,
  metalness: 0.05,
  roughness: 0.95,
});

function makeBone(name, x, y, z) {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(x, y, z);
  return bone;
}

const hips = makeBone('Hips', 0, 1.0, 0);
const spine = makeBone('Spine', 0, 0.35, 0);
const chest = makeBone('Chest', 0, 0.35, 0);
const neck = makeBone('Neck', 0, 0.22, 0);
const head = makeBone('Head', 0, 0.24, 0);
const upperArmL = makeBone('UpperArm.L', 0.32, 0.2, 0);
const lowerArmL = makeBone('LowerArm.L', 0.32, 0, 0);
const handL = makeBone('Hand.L', 0.26, 0, 0);
const upperArmR = makeBone('UpperArm.R', -0.32, 0.2, 0);
const lowerArmR = makeBone('LowerArm.R', -0.32, 0, 0);
const handR = makeBone('Hand.R', -0.26, 0, 0);
const upperLegL = makeBone('UpperLeg.L', 0.18, -0.45, 0);
const lowerLegL = makeBone('LowerLeg.L', 0, -0.48, 0);
const footL = makeBone('Foot.L', 0, -0.43, 0.08);
const upperLegR = makeBone('UpperLeg.R', -0.18, -0.45, 0);
const lowerLegR = makeBone('LowerLeg.R', 0, -0.48, 0);
const footR = makeBone('Foot.R', 0, -0.43, 0.08);

hips.add(spine);
spine.add(chest);
chest.add(neck);
neck.add(head);
chest.add(upperArmL); upperArmL.add(lowerArmL); lowerArmL.add(handL);
chest.add(upperArmR); upperArmR.add(lowerArmR); lowerArmR.add(handR);
hips.add(upperLegL); upperLegL.add(lowerLegL); lowerLegL.add(footL);
hips.add(upperLegR); upperLegR.add(lowerLegR); lowerLegR.add(footR);

const bones = [hips, spine, chest, neck, head, upperArmL, lowerArmL, handL, upperArmR, lowerArmR, handR, upperLegL, lowerLegL, footL, upperLegR, lowerLegR, footR];
const skeleton = new THREE.Skeleton(bones);

function addPart(name, size, pos, boneWeights) {
  const geom = new THREE.BoxGeometry(size[0], size[1], size[2], 1, 1, 1);
  const position = geom.attributes.position;
  const skinIndices = [];
  const skinWeights = [];
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) + pos[1];
    const z = position.getZ(i) + pos[2];
    const x = position.getX(i) + pos[0];
    const influences = boneWeights({ x, y, z });
    const indices = [0, 0, 0, 0];
    const weights = [0, 0, 0, 0];
    influences.slice(0, 4).forEach((entry, idx) => {
      indices[idx] = bones.findIndex((bone) => bone.name === entry[0]);
      weights[idx] = entry[1];
    });
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    for (let j = 0; j < 4; j++) {
      weights[j] /= total;
    }
    skinIndices.push(...indices);
    skinWeights.push(...weights);
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geom.translate(pos[0], pos[1], pos[2]);
  const mesh = new THREE.SkinnedMesh(geom, material.clone());
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.add(hips);
  mesh.bind(skeleton);
  return mesh;
}

const torso = addPart('Torso', [0.7, 1.1, 0.38], [0, 1.55, 0], ({ y }) => y > 1.7 ? [['Chest', 0.75], ['Spine', 0.25]] : [['Spine', 0.85], ['Hips', 0.15]]);
const headMesh = addPart('HeadMesh', [0.42, 0.42, 0.42], [0, 2.18, 0.02], () => [['Head', 1]]);
const armL = addPart('ArmMesh.L', [0.24, 0.95, 0.24], [0.63, 1.52, 0], ({ y }) => y > 1.5 ? [['UpperArm.L', 0.8], ['Chest', 0.2]] : [['LowerArm.L', 0.9], ['UpperArm.L', 0.1]]);
const armR = addPart('ArmMesh.R', [0.24, 0.95, 0.24], [-0.63, 1.52, 0], ({ y }) => y > 1.5 ? [['UpperArm.R', 0.8], ['Chest', 0.2]] : [['LowerArm.R', 0.9], ['UpperArm.R', 0.1]]);
const legL = addPart('LegMesh.L', [0.26, 1.25, 0.26], [0.18, 0.45, 0], ({ y }) => y > 0.55 ? [['UpperLeg.L', 0.9], ['Hips', 0.1]] : [['LowerLeg.L', 0.9], ['UpperLeg.L', 0.1]]);
const legR = addPart('LegMesh.R', [0.26, 1.25, 0.26], [-0.18, 0.45, 0], ({ y }) => y > 0.55 ? [['UpperLeg.R', 0.9], ['Hips', 0.1]] : [['LowerLeg.R', 0.9], ['UpperLeg.R', 0.1]]);

const root = new THREE.Group();
root.name = 'CC0Humanoid';
root.add(torso, headMesh, armL, armR, legL, legR);
scene.add(root);

const q = THREE.Quaternion;
const idleClip = new THREE.AnimationClip('Idle', 2, [
  new THREE.VectorKeyframeTrack('.position', [0, 1, 2], [0,0,0, 0,0.03,0, 0,0,0]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/Hips.quaternion', [0,1,2], [0,0,0,1, 0.015,0,0,0.9999, 0,0,0,1]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/Chest.quaternion', [0,1,2], [0,0,0,1, -0.02,0,0,0.9998, 0,0,0,1]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/UpperArm.L.quaternion', [0,1,2], [0,0,0.08,0.9968, 0,0,-0.08,0.9968, 0,0,0.08,0.9968]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/UpperArm.R.quaternion', [0,1,2], [0,0,-0.08,0.9968, 0,0,0.08,0.9968, 0,0,-0.08,0.9968]),
]);

function quatFromEuler(x, y, z) {
  const e = new THREE.Euler(x, y, z);
  const quat = new THREE.Quaternion().setFromEuler(e);
  return [quat.x, quat.y, quat.z, quat.w];
}

const attackTimes = [0, 0.2, 0.45, 0.75, 1.0];
const attackClip = new THREE.AnimationClip('Attack', 1, [
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/Chest.quaternion', attackTimes, attackTimes.flatMap((t, i) => quatFromEuler(i < 2 ? 0 : -0.15, 0, 0))),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/UpperArm.R.quaternion', attackTimes, [
    ...quatFromEuler(0, 0, -0.1),
    ...quatFromEuler(-0.4, 0, 0.2),
    ...quatFromEuler(-1.5, 0, 0.35),
    ...quatFromEuler(-0.15, 0, -0.25),
    ...quatFromEuler(0, 0, -0.1),
  ]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/LowerArm.R.quaternion', attackTimes, [
    ...quatFromEuler(0, 0, 0),
    ...quatFromEuler(-0.2, 0, 0),
    ...quatFromEuler(-0.8, 0, 0),
    ...quatFromEuler(-0.1, 0, 0),
    ...quatFromEuler(0, 0, 0),
  ]),
  new THREE.VectorKeyframeTrack('.position', attackTimes, [
    0,0,0,
    0,0,0.02,
    0,0,-0.18,
    0,0,0.03,
    0,0,0,
  ]),
]);

const proneClip = new THREE.AnimationClip('Prone', 0.6, [
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/Hips.quaternion', [0, 0.6], [
    ...quatFromEuler(0,0,0),
    ...quatFromEuler(0, 0, Math.PI / 2),
  ]),
  new THREE.VectorKeyframeTrack('.position', [0, 0.6], [0,0,0, 0,-0.78,0]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/UpperArm.L.quaternion', [0,0.6], [
    ...quatFromEuler(0,0,0),
    ...quatFromEuler(0,0,0.5),
  ]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/UpperArm.R.quaternion', [0,0.6], [
    ...quatFromEuler(0,0,0),
    ...quatFromEuler(0,0,-0.5),
  ]),
]);

const unconsciousClip = new THREE.AnimationClip('Unconscious', 1.2, [
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/Hips.quaternion', [0,0.6,1.2], [
    ...quatFromEuler(0,0,0),
    ...quatFromEuler(-0.15,0,0.4),
    ...quatFromEuler(-0.1,0,0.55),
  ]),
  new THREE.QuaternionKeyframeTrack('CC0Humanoid/Chest.quaternion', [0,0.6,1.2], [
    ...quatFromEuler(0,0,0),
    ...quatFromEuler(0.4,0,0),
    ...quatFromEuler(0.45,0,0),
  ]),
  new THREE.VectorKeyframeTrack('.position', [0,0.6,1.2], [0,0,0, 0,-0.15,0.02, 0,-0.16,0.02]),
]);

const exporter = new GLTFExporter();
const gltf = await new Promise((resolve, reject) => {
  exporter.parse(scene, resolve, reject, {
    binary: false,
    includeCustomExtensions: false,
    animations: [idleClip, attackClip, proneClip, unconsciousClip],
  });
});

await fs.writeFile('public/models/cc0-humanoid.gltf', JSON.stringify(gltf, null, 2));
await fs.writeFile('public/models/CC0.txt', 'CC0 1.0 Universal\n\nThis simple humanoid GLTF asset was generated for ananke-threejs-bridge and dedicated to the public domain by its author.\n');
console.log('wrote public/models/cc0-humanoid.gltf');
