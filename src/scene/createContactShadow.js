import * as THREE from 'three';

/** Small procedural contact blob for a readable height cue on the asphalt. */
export function createContactShadow() {
  // A soft contact blob keeps altitude legible even on low resolution shadow maps.
  const shadowSize = 64;
  const shadowPixels = new Uint8Array(shadowSize * shadowSize * 4);
  for (let y = 0; y < shadowSize; y++) {
    for (let x = 0; x < shadowSize; x++) {
      const d = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
      shadowPixels[(y * shadowSize + x) * 4 + 3] = Math.max(0, 1 - d) ** 2 * 170;
    }
  }
  const shadowTexture = new THREE.DataTexture(shadowPixels, shadowSize, shadowSize);
  shadowTexture.needsUpdate = true;
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 4.3),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.45,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.renderOrder = 2;
  return contactShadow;
}
