import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../js/storage/StorageService.js';

const avatarRelease = 'https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/';
const mapRelease = 'https://github.com/gattomorto24/fantascuola/releases/download/maps/';

test('avatar usa Pages mentre mappa salva URL diretto della Release maps', async () => {
  const originalFetch = globalThis.fetch;
  const rows = [];
  const calls = [];

  globalThis.fetch = async (url) => {
    if (url.includes('/releases/tags/free-roam-assets')) {
      return {
        ok: true,
        json: async () => ({ assets: [
          {
            name: 'eroe.glb',
            size: 1024,
            state: 'uploaded',
            browser_download_url: `${avatarRelease}eroe.glb`,
          },
        ] }),
      };
    }

    if (url.includes('/releases/tags/maps')) {
      return {
        ok: true,
        json: async () => ({ assets: [
          {
            name: 'mondo.glb',
            size: 816976060,
            state: 'uploaded',
            browser_download_url: `${mapRelease}mondo.glb`,
          },
        ] }),
      };
    }

    return { ok: true };
  };

  const client = {
    get storage() { throw new Error('Supabase Storage non deve essere usato'); },
    from(table) {
      return {
        insert(row) {
          rows.push([table, row]);
          return {
            select() {
              return {
                async single() {
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      calls.push([name, args]);
      return { error: null };
    },
  };

  try {
    const service = new StorageService(client, 'utente');

    await service.publishAvatar(`${avatarRelease}eroe.glb`, 'Eroe');
    await service.uploadMap(`${mapRelease}mondo.glb`, 'Mondo');

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(([table]) => table), ['free_roam_avatars', 'free_roam_maps']);
    assert.deepEqual(rows.map(([, row]) => row.storage_path), [null, null]);

    assert.equal(
      rows[0][1].asset_url,
      'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/eroe.glb',
    );
    assert.equal(rows[1][1].asset_url, `${mapRelease}mondo.glb`);

    assert.equal(rows[0][1].file_size, 1024);
    assert.equal(rows[1][1].file_size, 816976060);

    assert.deepEqual(calls, [
      ['free_roam_activate_map', { p_map_id: rows[1][1].id }],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
