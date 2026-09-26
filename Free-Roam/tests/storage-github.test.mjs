import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../js/storage/StorageService.js';

const avatarRelease = 'https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/';
const hfMap = 'https://huggingface.co/buckets/Tony272009/Mappa/resolve/Quartiere_Chiesa_Dettagliato.glb';

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: (name) => normalized[String(name).toLowerCase()] ?? null };
}

test('avatar resta su Pages mentre la mappa salva URL Hugging Face nei metadata', async () => {
  const originalFetch = globalThis.fetch;
  const rows = [];
  const calls = [];

  globalThis.fetch = async (url) => {
    if (url.includes('/releases/tags/free-roam-assets')) {
      return {
        ok: true,
        status: 200,
        headers: headers(),
        json: async () => ({ assets: [
          {
            name: 'eroe.glb',
            size: 1024,
            state: 'uploaded',
          },
        ] }),
      };
    }

    if (url === hfMap) {
      return {
        ok: true,
        status: 200,
        headers: headers({ 'content-length': 816976060 }),
      };
    }

    return { ok: true, status: 200, headers: headers() };
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
    await service.uploadMap(hfMap, 'Mascalucia');

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(([table]) => table), ['free_roam_avatars', 'free_roam_maps']);

    assert.equal(rows[0][1].storage_path, null);
    assert.match(rows[1][1].storage_path, /^external\/huggingface\/[0-9a-f-]{36}\/Quartiere_Chiesa_Dettagliato[.]glb$/i);

    assert.equal(
      rows[0][1].asset_url,
      'https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/eroe.glb',
    );
    assert.equal('asset_url' in rows[1][1], false);

    assert.equal(rows[0][1].file_size, 1024);
    assert.equal(rows[1][1].file_size, 50 * 1024 * 1024);
    assert.equal(rows[1][1].metadata.source, 'huggingface-bucket');
    assert.equal(rows[1][1].metadata.asset_url, hfMap);
    assert.equal(rows[1][1].metadata.original_file_size, 816976060);

    assert.deepEqual(calls, [
      ['free_roam_activate_map', { p_map_id: rows[1][1].id }],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
