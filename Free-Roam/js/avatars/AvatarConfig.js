export const PIXEL_AVATAR_OPTIONS = Object.freeze({
  skinTone: Object.freeze([
    { id: 'light', label: 'Chiara', color: 0xf1c7a5 },
    { id: 'medium', label: 'Media', color: 0xd9a078 },
    { id: 'amber', label: 'Ambrata', color: 0xb8734f },
    { id: 'dark', label: 'Scura', color: 0x70452f },
  ]),
  hairColor: Object.freeze([
    { id: 'blonde', label: 'Biondo', color: 0xd9b760 },
    { id: 'light-brown', label: 'Castano chiaro', color: 0x9a673f },
    { id: 'brown', label: 'Castano', color: 0x5d3827 },
    { id: 'black', label: 'Nero', color: 0x18191c },
  ]),
  shirtColor: Object.freeze([
    { id: 'red', label: 'Rosso', color: 0xd83a45 },
    { id: 'yellow', label: 'Giallo', color: 0xe4b72e },
    { id: 'blue', label: 'Blu', color: 0x2877d7 },
  ]),
  pantsColor: Object.freeze([
    { id: 'red', label: 'Rosso', color: 0xb52d38 },
    { id: 'yellow', label: 'Giallo', color: 0xc99a1d },
    { id: 'blue', label: 'Blu', color: 0x245ca8 },
  ]),
  shoesColor: Object.freeze([
    { id: 'black', label: 'Nere', color: 0x17191e },
    { id: 'white', label: 'Bianche', color: 0xf1f3f5 },
  ]),
});

export const DEFAULT_PIXEL_AVATAR = Object.freeze({
  version: 1,
  type: 'pixel',
  skinTone: 'medium',
  hairStyle: 'basic',
  hairColor: 'brown',
  shirtColor: 'blue',
  pantsColor: 'red',
  shoesColor: 'white',
});

export function normalizePixelAvatarConfig(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const safeId = (group, id, fallback) => PIXEL_AVATAR_OPTIONS[group].some((item) => item.id === id) ? id : fallback;
  return {
    version: 1,
    type: 'pixel',
    skinTone: safeId('skinTone', input.skinTone, DEFAULT_PIXEL_AVATAR.skinTone),
    hairStyle: 'basic',
    hairColor: safeId('hairColor', input.hairColor, DEFAULT_PIXEL_AVATAR.hairColor),
    shirtColor: safeId('shirtColor', input.shirtColor, DEFAULT_PIXEL_AVATAR.shirtColor),
    pantsColor: safeId('pantsColor', input.pantsColor, DEFAULT_PIXEL_AVATAR.pantsColor),
    shoesColor: safeId('shoesColor', input.shoesColor, DEFAULT_PIXEL_AVATAR.shoesColor),
  };
}

export function isPixelAvatarConfig(value) {
  if (!value || typeof value !== 'object' || value.type !== 'pixel' || value.version !== 1 || value.hairStyle !== 'basic') return false;
  const normalized = normalizePixelAvatarConfig(value);
  return ['skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoesColor']
    .every((key) => normalized[key] === value[key]);
}

export function pixelAvatarLabel(group, id) {
  return PIXEL_AVATAR_OPTIONS[group].find((item) => item.id === id)?.label || PIXEL_AVATAR_OPTIONS[group][0].label;
}
