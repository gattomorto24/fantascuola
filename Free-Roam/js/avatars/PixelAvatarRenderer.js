import * as THREE from 'three';
import {
  DEFAULT_PIXEL_AVATAR,
  PIXEL_AVATAR_OPTIONS,
  normalizePixelAvatarConfig,
  pixelAvatarLabel,
  isPixelAvatarConfig,
} from './AvatarConfig.js';

export {
  DEFAULT_PIXEL_AVATAR,
  PIXEL_AVATAR_OPTIONS,
  normalizePixelAvatarConfig,
  pixelAvatarLabel,
  isPixelAvatarConfig,
};

const geometries = new Map();
const materials = new Map();

const BODY_PROFILES = Object.freeze({
  slim: {
    torso: 0.82,
    depth: 0.90,
    pelvis: 0.86,
    limb: 0.82,
    shoulder: 0.90,
  },
  average: {
    torso: 1,
    depth: 1,
    pelvis: 1,
    limb: 1,
    shoulder: 1,
  },
  thick: {
    torso: 1.16,
    depth: 1.12,
    pelvis: 1.15,
    limb: 1.12,
    shoulder: 1.12,
  },
  muscular: {
    torso: 1.18,
    depth: 1.06,
    pelvis: 1.00,
    limb: 1.18,
    shoulder: 1.20,
  },
});

const HEIGHT_SCALE = Object.freeze({
  short: 0.88,
  medium: 1,
  tall: 1.12,
});

function option(group, id) {
  return PIXEL_AVATAR_OPTIONS[group].find((item) => item.id === id)
    || PIXEL_AVATAR_OPTIONS[group][0];
}

function geometry(w, h, d) {
  const key = `${w.toFixed(4)}:${h.toFixed(4)}:${d.toFixed(4)}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.BoxGeometry(w, h, d));
  return geometries.get(key);
}

function material(color) {
  const key = String(color);
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0.02,
    }));
  }
  return materials.get(key);
}

function box(parent, name, size, position, color) {
  const mesh = new THREE.Mesh(geometry(...size), material(color));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.sharedAvatarResource = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent, name, position) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  return group;
}

function addHair(head, variant, color) {
  const frontZ = -0.247;
  const hair = [];

  const add = (name, size, position) => {
    const mesh = box(head, name, size, position, color);
    hair.push(mesh);
    return mesh;
  };

  if (variant === 'buzz') {
    add('hairTop', [0.51, 0.065, 0.47], [0, 0.245, 0.01]);
    add('hairBack', [0.50, 0.16, 0.055], [0, 0.17, 0.245]);
    add('hairLeft', [0.055, 0.15, 0.37], [-0.257, 0.16, 0.02]);
    add('hairRight', [0.055, 0.15, 0.37], [0.257, 0.16, 0.02]);
    return hair;
  }

  if (variant === 'short') {
    add('hairTop', [0.53, 0.10, 0.49], [0, 0.265, 0.015]);
    add('hairBack', [0.52, 0.20, 0.075], [0, 0.17, 0.252]);
    add('hairLeft', [0.075, 0.18, 0.39], [-0.258, 0.16, 0.03]);
    add('hairRight', [0.075, 0.18, 0.39], [0.258, 0.16, 0.03]);
    add('frontShort', [0.22, 0.065, 0.055], [-0.10, 0.225, frontZ], color);
    return hair;
  }

  if (variant === 'fringe') {
    add('hairTop', [0.53, 0.12, 0.49], [0, 0.27, 0.015]);
    add('hairBack', [0.52, 0.29, 0.09], [0, 0.13, 0.255]);
    add('hairLeft', [0.09, 0.26, 0.4], [-0.255, 0.12, 0.03]);
    add('hairRight', [0.09, 0.26, 0.4], [0.255, 0.12, 0.03]);
    add('fringeWide', [0.39, 0.11, 0.065], [0, 0.185, frontZ], color);
    add('fringeDrop', [0.17, 0.095, 0.068], [0.11, 0.12, frontZ], color);
    return hair;
  }

  if (variant === 'side-part') {
    add('hairTop', [0.53, 0.11, 0.49], [0, 0.27, 0.015]);
    add('hairBack', [0.52, 0.26, 0.08], [0, 0.14, 0.255]);
    add('hairLeft', [0.105, 0.28, 0.39], [-0.25, 0.10, 0.03]);
    add('hairRight', [0.065, 0.20, 0.38], [0.26, 0.15, 0.03]);
    add('partA', [0.28, 0.085, 0.06], [-0.075, 0.225, frontZ], color);
    add('partB', [0.12, 0.13, 0.06], [-0.19, 0.16, frontZ], color);
    return hair;
  }

  if (variant === 'spiky') {
    add('hairTopBase', [0.49, 0.075, 0.46], [0, 0.245, 0.015]);
    add('hairBack', [0.50, 0.22, 0.075], [0, 0.15, 0.25]);
    add('hairLeft', [0.07, 0.20, 0.36], [-0.255, 0.14, 0.03]);
    add('hairRight', [0.07, 0.20, 0.36], [0.255, 0.14, 0.03]);

    const spikes = [
      [-0.18, 0.335, -0.08],
      [-0.06, 0.355, 0.02],
      [0.07, 0.35, -0.05],
      [0.18, 0.33, 0.06],
      [0.00, 0.37, 0.14],
    ];
    spikes.forEach((position, index) => {
      add(`spike${index + 1}`, [0.11, 0.16, 0.11], position, color);
    });
    return hair;
  }

  // classic
  add('hairTop', [0.53, 0.12, 0.49], [0, 0.27, 0.015]);
  add('hairBack', [0.52, 0.29, 0.09], [0, 0.13, 0.255]);
  add('hairLeft', [0.09, 0.26, 0.4], [-0.255, 0.12, 0.03]);
  add('hairRight', [0.09, 0.26, 0.4], [0.255, 0.12, 0.03]);
  add('fringeA', [0.16, 0.10, 0.06], [-0.12, 0.205, frontZ], color);
  add('fringeB', [0.18, 0.075, 0.06], [0.07, 0.225, frontZ], color);
  return hair;
}

function addShirtPattern(torso, pattern, primaryColor, secondaryColor, width, depth) {
  if (pattern === 'solid' || primaryColor === secondaryColor) return;

  const frontZ = -(depth / 2 + 0.012);
  const backZ = depth / 2 + 0.012;

  if (pattern === 'horizontal') {
    for (const y of [0.31, 0.15, -0.01]) {
      box(torso, 'shirtStripeFront', [width * 0.94, 0.065, 0.024], [0, y, frontZ], secondaryColor);
      box(torso, 'shirtStripeBack', [width * 0.94, 0.065, 0.024], [0, y, backZ], secondaryColor);
    }
    return;
  }

  if (pattern === 'vertical') {
    const stripeWidth = Math.max(0.045, width * 0.11);
    for (const x of [-width * 0.29, 0, width * 0.29]) {
      box(torso, 'shirtStripeFront', [stripeWidth, 0.53, 0.024], [x, 0.17, frontZ], secondaryColor);
      box(torso, 'shirtStripeBack', [stripeWidth, 0.53, 0.024], [x, 0.17, backZ], secondaryColor);
    }
  }
}

function addShoe(parent, name, x, color, special) {
  const shoe = box(parent, name, [0.25, 0.16, 0.38], [x, -0.43, -0.055], color);

  if (special === 'three-stripes') {
    for (const stripeX of [-0.072, 0, 0.072]) {
      box(
        parent,
        `${name}Stripe`,
        [0.025, 0.018, 0.27],
        [x + stripeX, -0.341, -0.065],
        0xf4f6f8,
      );
    }
  }

  return shoe;
}

export function createPixelAvatar(configInput = DEFAULT_PIXEL_AVATAR) {
  const config = normalizePixelAvatarConfig(configInput);

  const skin = option('skinTone', config.skinTone).color;
  const hair = option('hairColor', config.hairColor).color;
  const eyes = option('eyeColor', config.eyeColor).color;
  const shirtPrimary = option('shirtPrimaryColor', config.shirtPrimaryColor).color;
  const shirtSecondary = option('shirtSecondaryColor', config.shirtSecondaryColor).color;
  const pants = option('pantsColor', config.pantsColor).color;

  const shoeVariant = option('shoeVariant', config.shoeVariant);
  const shoeColor = option('shoesColor', shoeVariant.baseColor || config.shoesColor).color;

  const profile = BODY_PROFILES[config.bodyType] || BODY_PROFILES.average;
  const heightScale = HEIGHT_SCALE[config.heightType] || 1;

  const root = new THREE.Group();
  root.name = 'PixelAvatar';
  root.userData.sharedAvatarResources = true;

  const figure = pivot(root, 'figure', [0, 0, 0]);
  figure.scale.y = heightScale;

  const body = pivot(figure, 'body', [0, 0, 0]);

  const torsoWidth = 0.66 * profile.torso;
  const torsoDepth = 0.34 * profile.depth;
  const pelvisWidth = 0.58 * profile.pelvis;
  const upperArmWidth = 0.20 * profile.limb;
  const forearmWidth = 0.18 * profile.limb;
  const thighWidth = 0.25 * profile.limb;
  const shinWidth = 0.23 * profile.limb;
  const armX = torsoWidth / 2 + upperArmWidth / 2 + 0.03;
  const legX = pelvisWidth * 0.33;

  const torso = pivot(body, 'torsoPivot', [0, 1.22, 0]);
  box(torso, 'torso', [torsoWidth, 0.58, torsoDepth], [0, 0.17, 0], shirtPrimary);
  box(torso, 'shirtHem', [torsoWidth * 1.06, 0.12, torsoDepth * 1.08], [0, -0.15, 0], shirtPrimary);
  addShirtPattern(
    torso,
    config.shirtPattern,
    shirtPrimary,
    shirtSecondary,
    torsoWidth,
    torsoDepth,
  );

  box(body, 'pelvis', [pelvisWidth, 0.24, 0.34 * profile.depth], [0, 0.96, 0], pants);
  box(body, 'neck', [0.18, 0.13, 0.18], [0, 1.68, 0], skin);

  const head = pivot(body, 'headPivot', [0, 1.93, 0]);
  box(head, 'head', [0.5, 0.48, 0.46], [0, 0, 0], skin);
  box(head, 'leftEar', [0.07, 0.16, 0.12], [-0.285, 0, 0], skin);
  box(head, 'rightEar', [0.07, 0.16, 0.12], [0.285, 0, 0], skin);
  box(head, 'nose', [0.07, 0.08, 0.055], [0, -0.015, -0.255], skin);
  box(head, 'leftEye', [0.065, 0.055, 0.03], [-0.115, 0.075, -0.247], eyes);
  box(head, 'rightEye', [0.065, 0.055, 0.03], [0.115, 0.075, -0.247], eyes);
  box(head, 'mouth', [0.11, 0.025, 0.024], [0, -0.105, -0.247], 0x5a2f2b);
  addHair(head, config.hairVariant, hair);

  const leftArm = pivot(body, 'leftArmPivot', [-armX, 1.56, 0]);
  box(leftArm, 'leftUpperArm', [upperArmWidth, 0.37, 0.24 * profile.depth], [0, -0.18, 0], shirtPrimary);
  const leftForearm = pivot(leftArm, 'leftForearmPivot', [0, -0.37, 0]);
  box(leftForearm, 'leftForearm', [forearmWidth, 0.32, 0.20 * profile.depth], [0, -0.16, 0], skin);
  box(leftForearm, 'leftHand', [0.19 * profile.limb, 0.16, 0.20], [0, -0.39, -0.005], skin);

  const rightArm = pivot(body, 'rightArmPivot', [armX, 1.56, 0]);
  box(rightArm, 'rightUpperArm', [upperArmWidth, 0.37, 0.24 * profile.depth], [0, -0.18, 0], shirtPrimary);
  const rightForearm = pivot(rightArm, 'rightForearmPivot', [0, -0.37, 0]);
  box(rightForearm, 'rightForearm', [forearmWidth, 0.32, 0.20 * profile.depth], [0, -0.16, 0], skin);
  box(rightForearm, 'rightHand', [0.19 * profile.limb, 0.16, 0.20], [0, -0.39, -0.005], skin);

  const leftLeg = pivot(body, 'leftLegPivot', [-legX, 0.91, 0]);
  const rightLeg = pivot(body, 'rightLegPivot', [legX, 0.91, 0]);

  if (config.pantsLength === 'short') {
    box(leftLeg, 'leftShorts', [thighWidth, 0.25, 0.30 * profile.depth], [0, -0.125, 0], pants);
    box(leftLeg, 'leftLowerThigh', [thighWidth * 0.96, 0.18, 0.28 * profile.depth], [0, -0.34, 0], skin);
    box(rightLeg, 'rightShorts', [thighWidth, 0.25, 0.30 * profile.depth], [0, -0.125, 0], pants);
    box(rightLeg, 'rightLowerThigh', [thighWidth * 0.96, 0.18, 0.28 * profile.depth], [0, -0.34, 0], skin);
  } else {
    box(leftLeg, 'leftThigh', [thighWidth, 0.43, 0.30 * profile.depth], [0, -0.215, 0], pants);
    box(rightLeg, 'rightThigh', [thighWidth, 0.43, 0.30 * profile.depth], [0, -0.215, 0], pants);
  }

  const leftShin = pivot(leftLeg, 'leftShinPivot', [0, -0.43, 0]);
  const rightShin = pivot(rightLeg, 'rightShinPivot', [0, -0.43, 0]);

  const lowerLegColor = config.pantsLength === 'short' ? skin : pants;
  box(leftShin, 'leftShin', [shinWidth, 0.39, 0.27 * profile.depth], [0, -0.195, 0], lowerLegColor);
  box(rightShin, 'rightShin', [shinWidth, 0.39, 0.27 * profile.depth], [0, -0.195, 0], lowerLegColor);

  addShoe(leftShin, 'leftShoe', 0, shoeColor, shoeVariant.special);
  addShoe(rightShin, 'rightShoe', 0, shoeColor, shoeVariant.special);

  const parts = {
    root,
    figure,
    body,
    torso,
    head,
    leftArm,
    rightArm,
    leftForearm,
    rightForearm,
    leftLeg,
    rightLeg,
    leftShin,
    rightShin,
  };

  let phase = 0;

  const update = (delta, state = 'Idle') => {
    const running = state === 'Running';
    const walking = state === 'Walking';
    const jumping = state === 'Jumping';
    const hanging = state === 'LEDGE_GRAB' || state === 'HANGING' || state === 'SHIMMY';
    const climbing = state === 'FALLBACK_GRAB' || state === 'FALLBACK_CLIMB' || state === 'CLIMB_UP';
    const moving = running || walking;
    const rate = running ? 12 : walking ? 7.8 : 2;

    phase += delta * rate;

    let armSwing = 0;
    let legSwing = 0;

    if (moving) {
      const amount = running ? 0.82 : 0.52;
      legSwing = Math.sin(phase) * amount;
      armSwing = Math.sin(phase) * amount * 0.82;
    }

    leftArm.rotation.x = jumping ? -0.55 : armSwing;
    rightArm.rotation.x = jumping ? -0.55 : -armSwing;
    leftLeg.rotation.x = jumping ? 0.28 : -legSwing;
    rightLeg.rotation.x = jumping ? 0.28 : legSwing;
    leftShin.rotation.x = moving ? Math.max(0, Math.sin(phase + Math.PI) * 0.34) : 0;
    rightShin.rotation.x = moving ? Math.max(0, Math.sin(phase) * 0.34) : 0;
    leftForearm.rotation.x = moving ? -0.08 : 0;
    rightForearm.rotation.x = moving ? -0.08 : 0;

    torso.rotation.z = moving
      ? Math.sin(phase * 0.5) * (running ? 0.035 : 0.018)
      : 0;

    head.rotation.y = moving
      ? Math.sin(phase * 0.5) * 0.025
      : Math.sin(phase * 0.25) * 0.035;

    body.position.y = jumping
      ? 0
      : Math.sin(phase * 0.5) * (moving ? 0.012 : 0.006);
    if (hanging || climbing) {
      const cycle = climbing || state === 'SHIMMY' ? Math.sin(phase * 1.6) : 0;
      leftArm.rotation.x = -2.25 + cycle * 0.18;
      rightArm.rotation.x = -2.25 - cycle * 0.18;
      leftForearm.rotation.x = -0.3;
      rightForearm.rotation.x = -0.3;
      leftLeg.rotation.x = climbing ? 0.35 + cycle * 0.28 : 0.22;
      rightLeg.rotation.x = climbing ? 0.35 - cycle * 0.28 : 0.22;
      leftShin.rotation.x = climbing ? -0.28 : 0;
      rightShin.rotation.x = climbing ? -0.28 : 0;
      body.position.y = 0;
    }
  };

  return {
    object: root,
    update,
    config,
    parts,
    sharedResources: true,
    metrics: {
      heightFactor: heightScale,
      nameTagY: 1.34 * heightScale,
    },
  };
}
