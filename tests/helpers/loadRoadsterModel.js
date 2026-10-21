import { readFile } from 'node:fs/promises';
import { DataTexture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const asset = new URL('../../src/assets/roadster-rocket.glb', import.meta.url);
let bytes;

/**
 * Parse the actual shipped GLB in Node. Only image decoding is substituted:
 * geometry, node transforms, material factors and extensions remain genuine.
 * Browser rendering checks exercise the original embedded PNG textures.
 */
export async function loadRoadsterModel() {
  bytes ||= readFile(asset);
  const buffer = await bytes;
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'node-test-texture-placeholder',
    loadTexture() {
      const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      texture.flipY = false;
      texture.needsUpdate = true;
      return Promise.resolve(texture);
    },
  }));
  const gltf = await loader.parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    '',
  );
  return gltf.scene;
}
