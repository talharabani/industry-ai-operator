import type { SocialPlatform } from '../social-types.ts';

export interface MediaValidationResult {
  valid: boolean;
  error_code?: string;
  error_message?: string;
  is_data_uri?: boolean;
  is_svg?: boolean;
  is_inaccessible?: boolean;
  media_type?: 'none' | 'image' | 'video' | 'unsupported';
}

/**
 * Validates media against real platform ingestion requirements (Facebook, Instagram, TikTok).
 * This runs in both live and simulation modes so operators receive honest format verification
 * before live publishing.
 */
export function validateMediaForPlatform(
  platform: SocialPlatform,
  mediaUrls?: string[]
): MediaValidationResult {
  const urls = mediaUrls || [];
  const primaryUrl = urls[0];

  // 1. Mandatory media checks
  if (!primaryUrl) {
    if (platform === 'instagram') {
      return {
        valid: false,
        error_code: 'MEDIA_REQUIRED',
        error_message: 'Instagram Graph API strictly requires an image or video asset. Text-only posts are not supported on Instagram.',
        media_type: 'none',
      };
    }
    if (platform === 'tiktok') {
      return {
        valid: false,
        error_code: 'MEDIA_REQUIRED',
        error_message: 'TikTok Content Posting API strictly requires a video asset (or photo album mode). Text-only posts are not supported on TikTok.',
        media_type: 'none',
      };
    }
    // Facebook supports text-only status updates to Page Feed
    return {
      valid: true,
      media_type: 'none',
    };
  }

  // 2. Reject data URIs and SVG formats across all live platforms
  const isDataUri = primaryUrl.startsWith('data:');
  const isSvg = isDataUri
    ? primaryUrl.startsWith('data:image/svg+xml')
    : primaryUrl.toLowerCase().split('?')[0].endsWith('.svg');

  if (isDataUri || isSvg) {
    if (platform === 'instagram') {
      return {
        valid: false,
        error_code: 'UNSUPPORTED_MEDIA_FORMAT',
        error_message: 'Instagram Graph API does not support SVG files or base64 data URIs. Live publishing requires publicly accessible HTTP/HTTPS URLs pointing to JPEG, PNG, or MP4 files.',
        is_data_uri: isDataUri,
        is_svg: isSvg,
        media_type: 'unsupported',
      };
    }
    if (platform === 'tiktok') {
      return {
        valid: false,
        error_code: 'UNSUPPORTED_MEDIA_FORMAT',
        error_message: 'TikTok Content Posting API does not support SVG files or base64 data URIs. Live publishing requires hosted MP4/WebM videos or JPEG/PNG photo series.',
        is_data_uri: isDataUri,
        is_svg: isSvg,
        media_type: 'unsupported',
      };
    }
    if (platform === 'facebook') {
      return {
        valid: false,
        error_code: 'UNSUPPORTED_MEDIA_FORMAT',
        error_message: 'Facebook Graph API Photos endpoint rejects SVG files and base64 data URIs. Publicly accessible HTTP/HTTPS URLs (JPEG, PNG, GIF) are required.',
        is_data_uri: isDataUri,
        is_svg: isSvg,
        media_type: 'unsupported',
      };
    }
  }

  // 3. Reject inaccessible or private URLs (localhost, internal Docker networks, private IPs)
  try {
    const parsed = new URL(primaryUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        error_code: 'INACCESSIBLE_MEDIA_URL',
        error_message: `Media URL scheme "${parsed.protocol}" cannot be ingested by external social network webhooks. Must use HTTP/HTTPS.`,
        is_inaccessible: true,
        media_type: 'unsupported',
      };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.')
    ) {
      return {
        valid: false,
        error_code: 'INACCESSIBLE_MEDIA_URL',
        error_message: `Media URL points to private host "${hostname}". Social network ingestion servers cannot fetch assets from localhost or internal networks. A public CDN or cloud storage URL is required.`,
        is_inaccessible: true,
        media_type: 'unsupported',
      };
    }
  } catch (err) {
    return {
      valid: false,
      error_code: 'INVALID_MEDIA_URL',
      error_message: 'Media URL is not a well-formed URL.',
      is_inaccessible: true,
      media_type: 'unsupported',
    };
  }

  // 4. Platform format mapping
  const isVideo = Boolean(primaryUrl.match(/\.(mp4|mov|webm)(\?.*)?$/i));
  return {
    valid: true,
    media_type: isVideo ? 'video' : 'image',
  };
}
