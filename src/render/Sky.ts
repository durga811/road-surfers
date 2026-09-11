import * as THREE from 'three';
import { Palette } from './Palette';

/**
 * Backdrop: a vertical gradient dome plus a slow-drifting star layer.
 * Both are non-lit and depth-write-free, so they cost almost nothing
 * but give the void a horizon to read against.
 */
export function createSky(): THREE.Object3D {
  const group = new THREE.Group();

  const geometry = new THREE.SphereGeometry(600, 24, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(Palette.void) },
      uMid: { value: new THREE.Color(0x241d52) },
      uBottom: { value: new THREE.Color(0x090b1a) },
    },
    vertexShader: /* glsl */ `
      varying float vH;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vH = normalize(world.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom;
      varying float vH;
      void main() {
        float h = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        // Narrow warm band at the horizon, dark above and below.
        vec3 c = mix(uBottom, uMid, smoothstep(0.42, 0.50, h));
        c = mix(c, uTop, smoothstep(0.50, 0.78, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });

  const dome = new THREE.Mesh(geometry, material);
  dome.frustumCulled = false;
  group.add(dome);
  group.add(createStars());
  return group;
}

function createStars(): THREE.Points {
  const count = 520;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Bias toward the upper hemisphere: no stars under the track.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.85 + 0.05);
    const r = 380 + Math.random() * 140;
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.abs(Math.cos(phi)) * r * 0.7 + 30;
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    sizes[i] = Math.random() * 1.6 + 0.5;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uTime;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.55 + 0.45 * sin(uTime * 0.8 + position.x * 0.05 + position.z * 0.03);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * 220.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.06, d) * vTwinkle * 0.75;
        gl_FragColor = vec4(0.78, 0.87, 1.0, a);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.material = material;
  return points;
}

export function updateSky(sky: THREE.Object3D, time: number): void {
  const stars = sky.children[1] as THREE.Points;
  const mat = stars.userData.material as THREE.ShaderMaterial;
  mat.uniforms.uTime.value = time;
  stars.rotation.y = time * 0.004;
}
