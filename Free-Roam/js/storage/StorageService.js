import { settings } from '../config/settings.js';
import { cleanAssetName } from '../utils/text.js';
import { resolveGithubAsset } from '../assets/GithubAssets.js';
import { normalizePixelAvatarConfig } from '../avatars/PixelAvatarRenderer.js';

export class StorageService {
  constructor(client, userId) { this.client = client; this.userId = userId; }

  async activeMap() {
    const { data: setting, error: settingError } = await this.client.from('free_roam_settings').select('active_map_id').eq('id', true).maybeSingle();
    if (settingError) throw settingError;
    if (!setting?.active_map_id) return null;
    const { data: map, error } = await this.client.from('free_roam_maps').select('*').eq('id', setting.active_map_id).maybeSingle();
    if (error) throw error;
    return map?.enabled ? map : null;
  }

  async signedUrl(bucket, path) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, settings.assets.signedUrlSeconds);
    if (error || !data?.signedUrl) throw error || new Error('URL Storage non disponibile.');
    return data.signedUrl;
  }

  async listMyAvatars() {
    const { data, error } = await this.client.from('free_roam_avatars').select('id,name,storage_path,created_at').eq('owner_id', this.userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async avatarById(id) {
    const { data, error } = await this.client.from('free_roam_avatars').select('id,name,storage_path,asset_url').eq('id', id).maybeSingle();
    if (error || !data) throw error || new Error('Avatar pubblicato non trovato.');
    return data;
  }

  async loadAvatarConfig() {
    if (!this.client || !this.userId) return null;
    const { data, error } = await this.client.auth.getUser();
    if (error) throw error;
    return data.user?.user_metadata?.free_roam_avatar_config || null;
  }

  async saveAvatarConfig(config) {
    if (!this.client || !this.userId) return normalizePixelAvatarConfig(config);
    const normalized = normalizePixelAvatarConfig(config);
    const { error } = await this.client.auth.updateUser({
      data: { free_roam_avatar_config: normalized },
    });
    if (error) throw error;
    return normalized;
  }

  async publishAvatar(releaseUrl, name, onStage = () => {}) {
    onStage('Verifica avatar su GitHub Pages…');
    const asset = await resolveGithubAsset(releaseUrl, 'avatar');
    const id = crypto.randomUUID();
    onStage('Salvataggio avatar…');
    const { data, error } = await this.client.from('free_roam_avatars').insert({
      id,
      owner_id: this.userId,
      name: cleanAssetName(name, 40) || asset.fileName.replace(/\.glb$/i, ''),
      storage_path: null,
      asset_url: asset.assetUrl,
      file_size: asset.fileSize,
    }).select('id,name,asset_url').single();
    if (error) throw error;
    return data;
  }

  async uploadMap(releaseUrl, name, onStage = () => {}) {
    onStage('Verifica mappa su GitHub Pages…');
    const asset = await resolveGithubAsset(releaseUrl, 'map');
    const id = crypto.randomUUID();
    onStage('Salvataggio metadati…');
    const { data, error } = await this.client.from('free_roam_maps').insert({
      id,
      uploaded_by: this.userId,
      name: cleanAssetName(name) || asset.fileName,
      file_name: asset.fileName,
      storage_path: null,
      asset_url: asset.assetUrl,
      file_size: asset.fileSize,
      spawn: settings.world.defaultSpawn,
    }).select('*').single();
    if (error) throw error;
    onStage('Attivazione mappa…');
    await this.activateMap(data.id);
    return data;
  }

  async activateMap(id) {
    const { error } = await this.client.rpc('free_roam_activate_map', { p_map_id: id });
    if (error) throw error;
  }
}
