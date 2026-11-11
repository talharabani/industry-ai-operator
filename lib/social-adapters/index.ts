import type { SocialPlatform } from '../social-types.ts';
import type { SocialAdapter } from './types.ts';
import { FacebookAdapter } from './facebook-adapter.ts';
import { InstagramAdapter } from './instagram-adapter.ts';
import { TikTokAdapter } from './tiktok-adapter.ts';

const adapters: Record<SocialPlatform, SocialAdapter> = {
  facebook: new FacebookAdapter(),
  instagram: new InstagramAdapter(),
  tiktok: new TikTokAdapter(),
};

export function getSocialAdapter(platform: SocialPlatform): SocialAdapter {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`Unsupported social platform: ${platform}`);
  }
  return adapter;
}

export function getAllSocialAdapters(): Record<SocialPlatform, SocialAdapter> {
  return adapters;
}

export * from './types.ts';
export * from './facebook-adapter.ts';
export * from './instagram-adapter.ts';
export * from './tiktok-adapter.ts';
