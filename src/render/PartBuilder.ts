import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/**
 * Assembles a prop from primitives and collapses it into one mesh per
 * material.
 *
 * Props are built from a dozen boxes each for silhouette detail, but a
 * dozen meshes per obstacle would mean hundreds of draw calls once the
 * track is full — and each one is drawn twice, once for the shadow map.
 * Merging by material keeps a fully detailed hazard at two or three
 * draw calls.
 */
export class PartBuilder {
  private readonly parts: Part[] = [];

  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0, y = 0, z = 0,
    rotation?: { x?: number; y?: number; z?: number },
  ): this {
    // Clone before baking the transform: the source geometry is shared.
    const g = geometry.clone();
    if (rotation) {
      if (rotation.x) g.rotateX(rotation.x);
      if (rotation.y) g.rotateY(rotation.y);
      if (rotation.z) g.rotateZ(rotation.z);
    }
    g.translate(x, y, z);
    this.parts.push({ geometry: g, material });
    return this;
  }

  box(
    material: THREE.Material,
    w: number, h: number, d: number,
    x = 0, y = 0, z = 0,
    rotation?: { x?: number; y?: number; z?: number },
  ): this {
    return this.add(new THREE.BoxGeometry(w, h, d), material, x, y, z, rotation);
  }

  /**
   * @param shareKey  When given, the merged buffers are built once and
   *   reused by every later prop with the same key. Pools hold several
   *   instances of each hazard, and they are identical — there is no
   *   reason for each one to own its own copy on the GPU.
   * @param castShadow applied to the opaque merged meshes only.
   */
  build(shareKey?: string, castShadow = true): THREE.Group {
    const cached = shareKey ? PartBuilder.shared.get(shareKey) : undefined;
    if (cached) {
      this.parts.length = 0;
      return PartBuilder.assemble(cached, castShadow);
    }

    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();

    for (const part of this.parts) {
      // Normalise indexing so geometries from different primitive types
      // can be merged together.
      const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
      if (geometry !== part.geometry) part.geometry.dispose();
      const list = byMaterial.get(part.material);
      if (list) list.push(geometry);
      else byMaterial.set(part.material, [geometry]);
    }

    const merged: Part[] = [];
    for (const [material, geometries] of byMaterial) {
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)!;
      if (geometries.length > 1) for (const g of geometries) g.dispose();
      merged.push({ geometry, material });
    }

    this.parts.length = 0;
    if (shareKey) PartBuilder.shared.set(shareKey, merged);
    return PartBuilder.assemble(merged, castShadow);
  }

  private static readonly shared = new Map<string, Part[]>();

  private static assemble(parts: readonly Part[], castShadow: boolean): THREE.Group {
    const group = new THREE.Group();
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      // Only lit surfaces cast: emissive trim sits inside the prop's
      // silhouette, so shadowing it would double the shadow-pass cost
      // for no visible difference.
      const lit = part.material.type === 'MeshStandardMaterial';
      mesh.castShadow = castShadow && lit;
      mesh.receiveShadow = castShadow && lit;
      group.add(mesh);
    }
    return group;
  }
}
