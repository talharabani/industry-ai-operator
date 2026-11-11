import { query } from '../db.ts';
import { createSocialMediaAsset } from '../social-db.ts';
import type { MediaProviderStatus, SocialMediaAssetRecord } from '../social-types.ts';

/**
 * Validates external and local media generation providers honestly.
 */
export function getMediaProviderStatuses(): MediaProviderStatus[] {
  const openaiKey = process.env.OPENAI_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;

  return [
    {
      id: 'branded_card_generator',
      name: 'Local Branded Card & Showcase Engine',
      type: 'image',
      is_configured: true,
      is_ready: true,
      missing_keys: [],
      setup_guide: {
        title: 'Local Dynamic Branded Card Engine',
        description: 'Generates crisp, branded visual showcase cards directly from your business catalog, brand colors, and verified services. Free, zero external dependency, and immediate.',
        required_env: [],
        steps: ['Ready to generate on-demand from your approved catalog.'],
      },
    },
    {
      id: 'owner_upload',
      name: 'Direct Asset Upload',
      type: 'image',
      is_configured: true,
      is_ready: true,
      missing_keys: [],
      setup_guide: {
        title: 'Owner Media Upload',
        description: 'Upload your own high-resolution photography, product banners, and recorded MP4 videos directly showing your verified products.',
        required_env: [],
        steps: ['Upload verified assets in Brand & Content Settings or attach direct URLs in Post Editor.'],
      },
    },
    {
      id: 'stock_library',
      name: 'Curated Stock Imagery Library',
      type: 'image',
      is_configured: true,
      is_ready: true,
      missing_keys: [],
      setup_guide: {
        title: 'Curated Commercial Stock Imagery',
        description: 'Licensed royalty-free photography used strictly for illustrative marketing. Must be clearly tagged as stock imagery (does not depict client actual product).',
        required_env: [],
        steps: ['Ready for illustrative social campaigns.'],
      },
    },
    {
      id: 'openai_dalle',
      name: 'OpenAI DALL-E 3 Image Engine',
      type: 'image',
      is_configured: Boolean(openaiKey && openaiKey.startsWith('sk-')),
      is_ready: Boolean(openaiKey && openaiKey.startsWith('sk-')),
      missing_keys: openaiKey ? [] : ['OPENAI_API_KEY'],
      setup_guide: {
        title: 'OpenAI DALL-E 3 Setup',
        description: 'Synthesizes photorealistic or stylized marketing visuals using DALL-E 3 API.',
        doc_url: 'https://platform.openai.com/docs/guides/images',
        required_env: ['OPENAI_API_KEY'],
        steps: [
          'Create an API Key at platform.openai.com/api-keys.',
          'Add OPENAI_API_KEY="sk-..." to .env.local.',
          'Verify credit balance on OpenAI account.',
        ],
      },
    },
    {
      id: 'replicate_video',
      name: 'Replicate Short-Form AI Video Engine',
      type: 'video',
      is_configured: Boolean(replicateToken && replicateToken.startsWith('r8_')),
      is_ready: Boolean(replicateToken && replicateToken.startsWith('r8_')),
      missing_keys: replicateToken ? [] : ['REPLICATE_API_TOKEN'],
      setup_guide: {
        title: 'Replicate AI Video Synthesis Setup',
        description: 'Generates 5-10s video clips from text/image prompts for TikTok and Instagram Reels.',
        doc_url: 'https://replicate.com/docs/get-started',
        required_env: ['REPLICATE_API_TOKEN'],
        steps: [
          'Obtain API token from replicate.com/account/api-tokens.',
          'Add REPLICATE_API_TOKEN="r8_..." to .env.local.',
          'Ensure model access approval for text-to-video endpoints.',
        ],
      },
    },
  ];
}

/**
 * Deterministically generates a branded vector/SVG social media card
 * grounded in the tenant's actual verified services, business name, and brand identity.
 */
export async function generateBrandedSocialCard(
  tenantId: string,
  options: {
    headline?: string;
    subtext?: string;
    theme?: string;
    aspectRatio?: 'square' | 'vertical'; // square for IG/FB (1080x1080), vertical for TikTok/Reels (1080x1920)
  }
): Promise<SocialMediaAssetRecord> {
  // Load business context
  const bizRows = await query<any>(
    `SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  const bizSettings = bizRows[0]?.settings || {};
  const businessName = bizSettings.business_name || tenantId;
  const industry = bizSettings.industry || 'services';

  // Get primary offering
  let offeringName = 'Professional Service & Support';
  let offeringPrice = '';
  if (Array.isArray(bizSettings.knowledge?.services) && bizSettings.knowledge.services.length > 0) {
    const s = bizSettings.knowledge.services[0];
    offeringName = s.name;
    offeringPrice = s.price ? `Starting at $${s.price}` : (s.price_type === 'quote_required' ? 'Custom Quote Available' : '');
  } else if (Array.isArray(bizSettings.knowledge?.products_services) && bizSettings.knowledge.products_services.length > 0) {
    const p = bizSettings.knowledge.products_services[0];
    offeringName = p.name;
    offeringPrice = p.price ? `$${p.price}` : '';
  }

  const headline = options.headline || offeringName;
  const subtext = options.subtext || (bizSettings.knowledge?.service_areas?.[0]?.name ? `Proudly Serving ${bizSettings.knowledge.service_areas[0].name}` : 'Dependable Quality & Service');
  const theme = options.theme || 'Featured Highlight';

  const isVertical = options.aspectRatio === 'vertical';
  const width = 1080;
  const height = isVertical ? 1920 : 1080;

  // Modern high-contrast aesthetic with gradient accents
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="50%" stop-color="#1e1b4b" />
        <stop offset="100%" stop-color="#0f172a" />
      </linearGradient>
      <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#6366f1" />
        <stop offset="50%" stop-color="#8b5cf6" />
        <stop offset="100%" stop-color="#ec4899" />
      </linearGradient>
      <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.1" />
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0.03" />
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.5" />
      </filter>
    </defs>

    <!-- Background -->
    <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

    <!-- Ambient glowing orb -->
    <circle cx="${width * 0.85}" cy="${height * 0.2}" r="${width * 0.4}" fill="#6366f1" opacity="0.18" />
    <circle cx="${width * 0.15}" cy="${height * 0.8}" r="${width * 0.35}" fill="#ec4899" opacity="0.14" />

    <!-- Grid Accents -->
    <g stroke="#ffffff" stroke-opacity="0.04" stroke-width="1">
      <line x1="0" y1="${height * 0.25}" x2="${width}" y2="${height * 0.25}" />
      <line x1="0" y1="${height * 0.5}" x2="${width}" y2="${height * 0.5}" />
      <line x1="0" y1="${height * 0.75}" x2="${width}" y2="${height * 0.75}" />
      <line x1="${width * 0.25}" y1="0" x2="${width * 0.25}" y2="${height}" />
      <line x1="${width * 0.5}" y1="0" x2="${width * 0.5}" y2="${height}" />
      <line x1="${width * 0.75}" y1="0" x2="${width * 0.75}" y2="${height}" />
    </g>

    <!-- Content Glass Container -->
    <g transform="translate(100, ${isVertical ? 420 : 160})">
      <rect width="880" height="${isVertical ? 1080 : 760}" rx="36" fill="url(#cardGrad)" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2" filter="url(#shadow)" />

      <!-- Brand Header -->
      <g transform="translate(60, 70)">
        <rect width="48" height="48" rx="12" fill="url(#accentGrad)" />
        <path d="M16 24 L22 30 L32 18" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        <text x="64" y="32" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="700" fill="#ffffff" letter-spacing="0.5">
          ${escapeXml(businessName.toUpperCase())}
        </text>
        <rect x="64" y="44" width="120" height="20" rx="10" fill="#6366f1" fill-opacity="0.25" />
        <text x="124" y="58" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#a5b4fc" letter-spacing="1">
          ${escapeXml(industry.toUpperCase())}
        </text>
      </g>

      <!-- Category / Theme Tag -->
      <g transform="translate(60, 190)">
        <rect width="180" height="38" rx="19" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.15" />
        <text x="90" y="24" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#e0e7ff">
          ${escapeXml(theme)}
        </text>
      </g>

      <!-- Main Headline -->
      <text x="60" y="310" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="52" font-weight="800" fill="#ffffff" width="760">
        <tspan x="60" dy="0">${escapeXml(headline.slice(0, 36))}</tspan>
        ${headline.length > 36 ? `<tspan x="60" dy="68">${escapeXml(headline.slice(36, 75))}</tspan>` : ''}
      </text>

      <!-- Subtext / Description -->
      <text x="60" y="${headline.length > 36 ? 480 : 420}" font-family="system-ui, sans-serif" font-size="24" font-weight="400" fill="#cbd5e1" width="760">
        ${escapeXml(subtext.slice(0, 90))}
      </text>

      <!-- Pricing / Offer Badge -->
      ${offeringPrice ? `
      <g transform="translate(60, ${headline.length > 36 ? 560 : 500})">
        <rect width="320" height="64" rx="20" fill="url(#accentGrad)" />
        <text x="160" y="40" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#ffffff">
          ${escapeXml(offeringPrice)}
        </text>
      </g>
      ` : ''}

      <!-- Bottom Verified Footer -->
      <g transform="translate(60, ${isVertical ? 960 : 660})">
        <line x1="0" y1="0" x2="760" y2="0" stroke="#ffffff" stroke-opacity="0.1" />
        <circle cx="16" cy="35" r="12" fill="#10b981" />
        <path d="M12 35 L15 38 L21 31" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
        <text x="38" y="40" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#94a3b8">
          ${industry === 'retail' ? 'Artisan Bakery Heritage • Baked Fresh Daily' : (industry === 'ecommerce' ? 'Verified Catalog Offering • Quality Guaranteed' : 'Official Business Operator • Verified Service')}
        </text>
      </g>
    </g>
  </svg>`;

  function escapeXml(unsafe: string) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  // Base64 Data URI for immediate reliable browser and platform preview without cloud upload dependencies
  const base64Svg = Buffer.from(svg).toString('base64');
  const dataUri = `data:image/svg+xml;base64,${base64Svg}`;
  const filename = `brand_card_${tenantId}_${Date.now()}.svg`;

  const asset = await createSocialMediaAsset(tenantId, {
    media_type: 'image',
    storage_url: dataUri,
    filename,
    filesize_bytes: Buffer.byteLength(svg),
    mime_type: 'image/svg+xml',
    source: 'branded_card_template',
    dimensions: { width, height },
  });

  return asset;
}
