import * as THREE from 'three';

const MAX_PARTICLES = 13;
const origin = new THREE.Vector3();

export function createSmokeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float aSize;
      attribute float aOpacity;
      attribute float aShade;
      varying float vOpacity;
      varying float vShade;
      void main() {
        vOpacity = aOpacity;
        vShade = aShade;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(aSize * 285.0 / max(1.0, -view.z), 1.0, 72.0);
      }
    `,
    fragmentShader: `
      varying float vOpacity;
      varying float vShade;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float edge = length(uv);
        float soft = 1.0 - smoothstep(0.2, 1.0, edge);
        float detail = 0.9 + 0.1 * sin(uv.x * 13.0 + uv.y * 17.0);
        float alpha = vOpacity * soft * detail;
        if (alpha < 0.01) discard;
        vec3 grey = mix(vec3(0.64, 0.67, 0.68), vec3(0.12, 0.14, 0.16), vShade);
        gl_FragColor = vec4(grey, alpha);
      }
    `,
  });
}

export class VehicleSmoke {
  constructor(scene, root, material, id, motorcycle = false, count = MAX_PARTICLES) {
    this.scene = scene;
    this.root = root;
    this.motorcycle = motorcycle;
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.opacities = new Float32Array(count);
    this.shades = new Float32Array(count);
    this.particles = Array.from({ length: count }, () => ({
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: Infinity, life: 1,
    }));
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(this.opacities, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aShade', new THREE.BufferAttribute(this.shades, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geometry, material);
    this.points.name = 'VehicleDamageSmoke';
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.scene.add(this.points);
    this.seed = [...id].reduce((hash, char) => ((hash * 31 + char.charCodeAt(0)) >>> 0), 2166136261);
    this.cursor = 0;
    this.spawnAccumulator = 0;
    this.lastTimeMs = null;
    this.lastCondition = 100;
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  spawn(condition) {
    const particle = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    origin.set(this.motorcycle ? 0.12 : 0.16,
      this.motorcycle ? 0.87 : 1.3,
      this.motorcycle ? -0.36 : 1.15);
    this.root.updateMatrixWorld(true);
    this.root.localToWorld(origin);
    particle.position.copy(origin);
    particle.position.x += (this.random() - 0.5) * 0.15;
    particle.position.z += (this.random() - 0.5) * 0.16;
    particle.velocity.set((this.random() - 0.5) * 0.24,
      0.5 + this.random() * 0.4,
      (this.random() - 0.5) * 0.24);
    particle.age = 0;
    particle.life = 1.65 + this.random() * 0.8;
    particle.shade = Math.min(1, 0.24 + (65 - condition) / 65 * 0.64 + this.random() * 0.11);
  }

  update(condition, timeMs) {
    const damaged = condition <= 65;
    const wasVisible = this.points.visible;
    this.points.visible = damaged;
    const delta = this.lastTimeMs === null ? 0.016 : Math.max(0, Math.min(0.08, (timeMs - this.lastTimeMs) / 1000));
    this.lastTimeMs = timeMs;
    if (!damaged) { this.lastCondition = condition; return; }
    const intensity = Math.max(0, Math.min(1, (65 - condition) / 65));
    if (!wasVisible) this.spawn(condition);
    if (condition < this.lastCondition - 5) {
      const burst = Math.min(4, Math.ceil((this.lastCondition - condition) / 18));
      for (let i = 0; i < burst; i += 1) this.spawn(condition);
    }
    this.lastCondition = condition;
    this.spawnAccumulator += delta * (2.6 + intensity * 5.2);
    while (this.spawnAccumulator >= 1) {
      this.spawn(condition);
      this.spawnAccumulator -= 1;
    }
    for (let i = 0; i < this.count; i += 1) {
      const particle = this.particles[i];
      if (particle.age >= particle.life) { this.opacities[i] = 0; continue; }
      particle.age += delta;
      const life = Math.min(1, particle.age / particle.life);
      particle.position.addScaledVector(particle.velocity, delta);
      particle.velocity.x += Math.sin(timeMs * 0.0017 + i * 2.3) * delta * 0.1;
      particle.velocity.z += Math.cos(timeMs * 0.0013 + i * 1.7) * delta * 0.1;
      this.positions[i * 3] = particle.position.x;
      this.positions[i * 3 + 1] = particle.position.y;
      this.positions[i * 3 + 2] = particle.position.z;
      this.sizes[i] = (this.motorcycle ? 0.28 : 0.38) + life * (0.65 + intensity * 0.36);
      this.opacities[i] = (0.16 + intensity * 0.26) * Math.min(1, life * 7) * (1 - life) ** 1.35;
      this.shades[i] = particle.shade;
    }
    for (const attribute of Object.values(this.geometry.attributes)) attribute.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
  }
}
