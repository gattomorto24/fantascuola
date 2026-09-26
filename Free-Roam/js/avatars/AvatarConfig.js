const SHIRT_COLORS = Object.freeze([
  { id: 'red', label: 'Rosso', color: 0xd83a45 },
  { id: 'yellow', label: 'Giallo', color: 0xe4b72e },
  { id: 'blue', label: 'Blu', color: 0x2877d7 },
  { id: 'black', label: 'Nero', color: 0x17191e },
  { id: 'white', label: 'Bianco', color: 0xf1f3f5 },
]);

export const PIXEL_AVATAR_OPTIONS = Object.freeze({
  skinTone: Object.freeze([
    { id: 'very-light', label: 'Chiarissima', color: 0xf7d8bd },
    { id: 'light', label: 'Chiara', color: 0xf1c7a5 },
    { id: 'light-medium', label: 'Medio-chiara', color: 0xe5b58f },
    { id: 'medium', label: 'Media', color: 0xd9a078 },
    { id: 'amber', label: 'Ambrata', color: 0xb8734f },
    { id: 'olive', label: 'Olivastra', color: 0x9d6548 },
    { id: 'dark', label: 'Scura', color: 0x70452f },
    { id: 'deep', label: 'Molto scura', color: 0x4b2f24 },
  ]),
  hairVariant: Object.freeze([
    { id: 'classic', label: 'Classico' },
    { id: 'short', label: 'Corto' },
    { id: 'fringe', label: 'Frangia' },
    { id: 'side-part', label: 'Riga laterale' },
    { id: 'spiky', label: 'Spettinato' },
    { id: 'buzz', label: 'Rasato' },
  ]),
  hairColor: Object.freeze([
    { id: 'blonde', label: 'Biondo', color: 0xd9b760 },
    { id: 'light-brown', label: 'Castano chiaro', color: 0x9a673f },
    { id: 'brown', label: 'Castano', color: 0x5d3827 },
    { id: 'black', label: 'Nero', color: 0x18191c },
  ]),
  eyeColor: Object.freeze([
    { id: 'black', label: 'Neri', color: 0x111216 },
    { id: 'blue', label: 'Azzurri', color: 0x3d89c9 },
    { id: 'brown', label: 'Marroni', color: 0x6f452e },
  ]),
  shirtPrimaryColor: SHIRT_COLORS,
  shirtSecondaryColor: SHIRT_COLORS,
  shirtPattern: Object.freeze([
    { id: 'solid', label: 'Tinta unita' },
    { id: 'horizontal', label: 'Strisce orizzontali' },
    { id: 'vertical', label: 'Strisce verticali' },
  ]),
  // Campo legacy mantenuto per compatibilità con client precedenti.
  shirtColor: SHIRT_COLORS,
  pantsColor: Object.freeze([
    { id: 'red', label: 'Rosso', color: 0xb52d38 },
    { id: 'yellow', label: 'Giallo', color: 0xc99a1d },
    { id: 'blue', label: 'Blu', color: 0x245ca8 },
  ]),
  pantsLength: Object.freeze([
    { id: 'long', label: 'Lunghi' },
    { id: 'short', label: 'Corti' },
  ]),
  shoesColor: Object.freeze([
    { id: 'black', label: 'Nere', color: 0x17191e },
    { id: 'white', label: 'Bianche', color: 0xf1f3f5 },
    { id: 'red', label: 'Rosse', color: 0xd73b45 },
    { id: 'pink', label: 'Rosa', color: 0xe981a7 },
    { id: 'blue', label: 'Blu', color: 0x2877d7 },
  ]),
  shoeVariant: Object.freeze([
    { id: 'black', label: 'Nere', baseColor: 'black' },
    { id: 'white', label: 'Bianche', baseColor: 'white' },
    { id: 'red', label: 'Rosse', baseColor: 'red' },
    { id: 'pink', label: 'Rosa', baseColor: 'pink' },
    { id: 'blue', label: 'Blu', baseColor: 'blue' },
    { id: 'blue-three-stripes', label: 'Speciale blu · 3 strisce', baseColor: 'blue', special: 'three-stripes' },
  ]),
  bodyType: Object.freeze([
    { id: 'slim', label: 'Magro' },
    { id: 'average', label: 'Medio' },
    { id: 'thick', label: 'Robusto' },
    { id: 'muscular', label: 'Muscoloso' },
  ]),
  heightType: Object.freeze([
    { id: 'short', label: 'Basso' },
    { id: 'medium', label: 'Medio' },
    { id: 'tall', label: 'Alto' },
  ]),
});

export const DEFAULT_PIXEL_AVATAR = Object.freeze({
  version: 1,
  type: 'pixel',

  skinTone: 'medium',

  // hairStyle resta "basic" per compatibilità di rete con la v0.5.
  hairStyle: 'basic',
  hairVariant: 'classic',
  hairColor: 'brown',

  eyeColor: 'black',

  shirtColor: 'blue',
  shirtPrimaryColor: 'blue',
  shirtSecondaryColor: 'white',
  shirtPattern: 'solid',

  pantsColor: 'red',
  pantsLength: 'long',

  shoesColor: 'white',
  shoeVariant: 'white',

  bodyType: 'average',
  heightType: 'medium',
});

function hasOption(group, id) {
  return PIXEL_AVATAR_OPTIONS[group]?.some((item) => item.id === id) === true;
}

function safeId(group, id, fallback) {
  return hasOption(group, id) ? id : fallback;
}

function legacyShoeColor(variant) {
  const item = PIXEL_AVATAR_OPTIONS.shoeVariant.find((entry) => entry.id === variant);
  return item?.baseColor || DEFAULT_PIXEL_AVATAR.shoesColor;
}

export function normalizePixelAvatarConfig(value = {}) {
  const input = value && typeof value === 'object' ? value : {};

  const shirtPrimaryColor = safeId(
    'shirtPrimaryColor',
    input.shirtPrimaryColor || input.shirtColor,
    DEFAULT_PIXEL_AVATAR.shirtPrimaryColor,
  );

  const shoeVariantCandidate = input.shoeVariant
    || (hasOption('shoeVariant', input.shoesColor) ? input.shoesColor : null);

  const shoeVariant = safeId(
    'shoeVariant',
    shoeVariantCandidate,
    DEFAULT_PIXEL_AVATAR.shoeVariant,
  );

  return {
    version: 1,
    type: 'pixel',

    skinTone: safeId('skinTone', input.skinTone, DEFAULT_PIXEL_AVATAR.skinTone),

    hairStyle: 'basic',
    hairVariant: safeId('hairVariant', input.hairVariant, DEFAULT_PIXEL_AVATAR.hairVariant),
    hairColor: safeId('hairColor', input.hairColor, DEFAULT_PIXEL_AVATAR.hairColor),

    eyeColor: safeId('eyeColor', input.eyeColor, DEFAULT_PIXEL_AVATAR.eyeColor),

    // Alias legacy lasciato nello snapshot per client v0.5.
    shirtColor: shirtPrimaryColor,
    shirtPrimaryColor,
    shirtSecondaryColor: safeId(
      'shirtSecondaryColor',
      input.shirtSecondaryColor,
      DEFAULT_PIXEL_AVATAR.shirtSecondaryColor,
    ),
    shirtPattern: safeId('shirtPattern', input.shirtPattern, DEFAULT_PIXEL_AVATAR.shirtPattern),

    pantsColor: safeId('pantsColor', input.pantsColor, DEFAULT_PIXEL_AVATAR.pantsColor),
    pantsLength: safeId('pantsLength', input.pantsLength, DEFAULT_PIXEL_AVATAR.pantsLength),

    // Alias legacy come sopra.
    shoesColor: legacyShoeColor(shoeVariant),
    shoeVariant,

    bodyType: safeId('bodyType', input.bodyType, DEFAULT_PIXEL_AVATAR.bodyType),
    heightType: safeId('heightType', input.heightType, DEFAULT_PIXEL_AVATAR.heightType),
  };
}

export function isPixelAvatarConfig(value) {
  if (!value || typeof value !== 'object' || value.type !== 'pixel' || value.version !== 1) return false;
  if (value.hairStyle !== 'basic') return false;

  // Campi v0.5 obbligatori per restare interoperabili con client ancora in cache.
  for (const key of ['skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoesColor']) {
    if (!hasOption(key, value[key])) return false;
  }

  const optionalGroups = [
    'hairVariant',
    'eyeColor',
    'shirtPrimaryColor',
    'shirtSecondaryColor',
    'shirtPattern',
    'pantsLength',
    'shoeVariant',
    'bodyType',
    'heightType',
  ];

  for (const key of optionalGroups) {
    if (value[key] !== undefined && !hasOption(key, value[key])) return false;
  }

  return true;
}

export function pixelAvatarLabel(group, id) {
  return PIXEL_AVATAR_OPTIONS[group]?.find((item) => item.id === id)?.label
    || PIXEL_AVATAR_OPTIONS[group]?.[0]?.label
    || '';
}
