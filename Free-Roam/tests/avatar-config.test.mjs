import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PIXEL_AVATAR,
  PIXEL_AVATAR_OPTIONS,
  isPixelAvatarConfig,
  normalizePixelAvatarConfig,
} from '../js/avatars/AvatarConfig.js';

test('avatar v0.6 normalizza tutte le nuove opzioni indipendenti', () => {
  const config = normalizePixelAvatarConfig({
    skinTone: 'deep',
    hairVariant: 'spiky',
    hairColor: 'blonde',
    eyeColor: 'blue',
    shirtPrimaryColor: 'red',
    shirtSecondaryColor: 'blue',
    shirtPattern: 'vertical',
    pantsColor: 'blue',
    pantsLength: 'short',
    shoeVariant: 'blue-three-stripes',
    bodyType: 'muscular',
    heightType: 'tall',
  });

  assert.equal(config.version, 1);
  assert.equal(config.type, 'pixel');
  assert.equal(config.hairStyle, 'basic');

  assert.equal(config.skinTone, 'deep');
  assert.equal(config.hairVariant, 'spiky');
  assert.equal(config.hairColor, 'blonde');
  assert.equal(config.eyeColor, 'blue');

  assert.equal(config.shirtPrimaryColor, 'red');
  assert.equal(config.shirtSecondaryColor, 'blue');
  assert.equal(config.shirtPattern, 'vertical');
  assert.equal(config.shirtColor, 'red');

  assert.equal(config.pantsColor, 'blue');
  assert.equal(config.pantsLength, 'short');

  assert.equal(config.shoeVariant, 'blue-three-stripes');
  assert.equal(config.shoesColor, 'blue');

  assert.equal(config.bodyType, 'muscular');
  assert.equal(config.heightType, 'tall');

  assert.equal(isPixelAvatarConfig(config), true);
});

test('config v0.5 viene migrata mantenendo compatibilità di rete', () => {
  const legacy = {
    version: 1,
    type: 'pixel',
    skinTone: 'medium',
    hairStyle: 'basic',
    hairColor: 'brown',
    shirtColor: 'blue',
    pantsColor: 'red',
    shoesColor: 'white',
  };

  assert.equal(isPixelAvatarConfig(legacy), true);

  const config = normalizePixelAvatarConfig(legacy);
  assert.equal(config.skinTone, 'medium');
  assert.equal(config.hairVariant, DEFAULT_PIXEL_AVATAR.hairVariant);
  assert.equal(config.eyeColor, DEFAULT_PIXEL_AVATAR.eyeColor);
  assert.equal(config.shirtPrimaryColor, 'blue');
  assert.equal(config.shirtColor, 'blue');
  assert.equal(config.pantsLength, 'long');
  assert.equal(config.shoeVariant, 'white');
  assert.equal(config.shoesColor, 'white');
  assert.equal(config.bodyType, 'average');
  assert.equal(config.heightType, 'medium');
});

test('valori sconosciuti tornano ai preset sicuri', () => {
  const config = normalizePixelAvatarConfig({
    skinTone: 'alien',
    hairVariant: 'helmet',
    hairColor: 'purple',
    eyeColor: 'green',
    shirtPrimaryColor: 'orange',
    shirtSecondaryColor: 'cyan',
    shirtPattern: 'dots',
    pantsColor: 'orange',
    pantsLength: 'capri',
    shoeVariant: 'rocket',
    bodyType: 'giant',
    heightType: 'tiny',
  });

  assert.equal(config.skinTone, DEFAULT_PIXEL_AVATAR.skinTone);
  assert.equal(config.hairVariant, DEFAULT_PIXEL_AVATAR.hairVariant);
  assert.equal(config.hairColor, DEFAULT_PIXEL_AVATAR.hairColor);
  assert.equal(config.eyeColor, DEFAULT_PIXEL_AVATAR.eyeColor);
  assert.equal(config.shirtPrimaryColor, DEFAULT_PIXEL_AVATAR.shirtPrimaryColor);
  assert.equal(config.shirtSecondaryColor, DEFAULT_PIXEL_AVATAR.shirtSecondaryColor);
  assert.equal(config.shirtPattern, DEFAULT_PIXEL_AVATAR.shirtPattern);
  assert.equal(config.pantsColor, DEFAULT_PIXEL_AVATAR.pantsColor);
  assert.equal(config.pantsLength, DEFAULT_PIXEL_AVATAR.pantsLength);
  assert.equal(config.shoeVariant, DEFAULT_PIXEL_AVATAR.shoeVariant);
  assert.equal(config.bodyType, DEFAULT_PIXEL_AVATAR.bodyType);
  assert.equal(config.heightType, DEFAULT_PIXEL_AVATAR.heightType);
});

test('catalogo v0.6 include le varianti richieste', () => {
  assert.ok(PIXEL_AVATAR_OPTIONS.skinTone.length >= 8);
  assert.ok(PIXEL_AVATAR_OPTIONS.hairVariant.length >= 6);
  assert.deepEqual(
    PIXEL_AVATAR_OPTIONS.eyeColor.map((item) => item.id),
    ['black', 'blue', 'brown'],
  );

  assert.deepEqual(
    PIXEL_AVATAR_OPTIONS.shirtPrimaryColor.map((item) => item.id),
    ['red', 'yellow', 'blue', 'black', 'white'],
  );

  assert.deepEqual(
    PIXEL_AVATAR_OPTIONS.shirtPattern.map((item) => item.id),
    ['solid', 'horizontal', 'vertical'],
  );

  assert.deepEqual(
    PIXEL_AVATAR_OPTIONS.pantsLength.map((item) => item.id),
    ['long', 'short'],
  );

  assert.ok(
    PIXEL_AVATAR_OPTIONS.shoeVariant.some((item) => item.id === 'blue-three-stripes'),
  );

  assert.deepEqual(
    PIXEL_AVATAR_OPTIONS.bodyType.map((item) => item.id),
    ['slim', 'average', 'thick', 'muscular'],
  );

  assert.deepEqual(
    PIXEL_AVATAR_OPTIONS.heightType.map((item) => item.id),
    ['short', 'medium', 'tall'],
  );
});
