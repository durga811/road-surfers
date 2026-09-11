import * as THREE from 'three';

/**
 * Every geometry the game will ever need, built once at boot.
 * Nothing in the main loop constructs geometry.
 */
class GeometryLibrary {
  private readonly cache = new Map<string, THREE.BufferGeometry>();

  box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.get(`box:${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)) as THREE.BoxGeometry;
  }

  plane(w: number, h: number): THREE.PlaneGeometry {
    return this.get(`plane:${w},${h}`, () => new THREE.PlaneGeometry(w, h)) as THREE.PlaneGeometry;
  }

  octahedron(r: number, detail = 0): THREE.OctahedronGeometry {
    return this.get(`oct:${r},${detail}`, () => new THREE.OctahedronGeometry(r, detail)) as THREE.OctahedronGeometry;
  }

  icosahedron(r: number, detail = 0): THREE.IcosahedronGeometry {
    return this.get(`ico:${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)) as THREE.IcosahedronGeometry;
  }

  torus(r: number, tube: number, rs = 8, ts = 20): THREE.TorusGeometry {
    return this.get(`tor:${r},${tube},${rs},${ts}`, () =>
      new THREE.TorusGeometry(r, tube, rs, ts)) as THREE.TorusGeometry;
  }

  private get(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.cache.get(key);
    if (!g) {
      g = make();
      this.cache.set(key, g);
    }
    return g;
  }

}

export const Geo = new GeometryLibrary();
