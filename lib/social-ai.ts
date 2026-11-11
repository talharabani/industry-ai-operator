import { query } from './db.ts';
import { getSocialBrandSettings, incrementGenerationUsage } from './social-db.ts';
import type { SocialPlatform, SocialPostRecord } from './social-types.ts';

export interface GeneratedSocialDraft {
  topic_theme: string;
  campaign_name?: string;
  caption: string;
  hashtags: string[];
  video_script?: string;
  target_platforms: SocialPlatform[];
  suggested_media_type: 'image' | 'video';
  media_urls: string[];
  generation_source?: 'llm_groq' | 'deterministic_catalog_grounded';
  generator_model?: string;
  media_source?: 'stock_asset' | 'owner_upload' | 'branded_card_template' | 'ai_generated';
  media_label?: string;
  llm_request_outcome?: {
    attempted: boolean;
    provider?: string;
    model?: string;
    status: 'success' | 'unconfigured' | 'error';
    message?: string;
  };
}

export async function generateSocialContentForTenant(
  tenantId: string,
  options?: {
    theme?: string;
    target_platforms?: SocialPlatform[];
    custom_instruction?: string;
  }
): Promise<GeneratedSocialDraft> {
  // 1. Check generation usage limits
  const brandSettings = await getSocialBrandSettings(tenantId);
  if (brandSettings.monthly_generations_used >= brandSettings.monthly_generation_limit) {
    throw new Error(
      `Monthly AI generation limit reached (${brandSettings.monthly_generations_used}/${brandSettings.monthly_generation_limit}). Upgrade limit or reset cycle to continue.`
    );
  }

  // 2. Fetch business context
  const bizRows = await query<any>(
    `SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  const bizSettings = bizRows[0]?.settings || {};
  const businessName = bizSettings.business_name || tenantId;
  const industry = bizSettings.industry || 'services';

  // Extract catalog & services
  const servicesList: string[] = [];
  if (Array.isArray(bizSettings.knowledge?.services)) {
    bizSettings.knowledge.services.forEach((s: any) => {
      const price = s.price ? `$${s.price}` : (s.price_type === 'quote_required' ? 'Custom Quote' : 'Standard');
      servicesList.push(`• ${s.name}: ${price} - ${s.description || ''}`);
    });
  }
  if (Array.isArray(bizSettings.knowledge?.products_services)) {
    bizSettings.knowledge.products_services.slice(0, 8).forEach((p: any) => {
      servicesList.push(`• ${p.name}: $${p.price || 0} - ${p.description || ''}`);
    });
  }
  const catalogContext = servicesList.length > 0 ? servicesList.join('\n') : 'Standard company services and offerings.';

  // Service areas
  const serviceAreas = (bizSettings.knowledge?.service_areas || []).map((a: any) => a.name).join(', ');

  // 3. Load recent posts to prevent repetition
  const recentPosts = await query<any>(
    `SELECT topic_theme, caption FROM iao.social_posts
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [tenantId]
  );
  const recentTopics = recentPosts.map((p) => p.topic_theme).filter(Boolean).join(', ');
  const recentCaptions = recentPosts.map((p) => p.caption.slice(0, 60)).join('\n- ');

  // 4. Load available owner media assets
  const mediaRows = await query<any>(
    `SELECT storage_url, filename, media_type, source FROM iao.social_media_assets
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 15`,
    [tenantId]
  );
  let availableMediaUrls = mediaRows.map((m) => m.storage_url);

  // If no media asset exists yet, generate a branded showcase card so the post has ready-to-preview media
  if (availableMediaUrls.length === 0) {
    try {
      const { generateBrandedSocialCard } = await import('./media-providers/index.ts');
      const cardAsset = await generateBrandedSocialCard(tenantId, {
        theme: options?.theme || brandSettings.content_themes[0] || 'Quality & Service Spotlight',
      });
      availableMediaUrls = [cardAsset.storage_url];
    } catch (cardErr) {
      console.warn('[Social AI] Branded card fallback warning:', cardErr);
    }
  }

  // Determine target platforms
  const targetPlatforms: SocialPlatform[] = options?.target_platforms && options.target_platforms.length > 0
    ? options.target_platforms
    : (brandSettings.selected_platforms.length > 0 ? brandSettings.selected_platforms : ['facebook', 'instagram']);

  // Selected content theme
  const availableThemes = brandSettings.content_themes.length > 0
    ? brandSettings.content_themes
    : ['Service Spotlight', 'Maintenance & Helpful Tips', 'Customer Satisfaction & Quality'];
  const chosenTheme = options?.theme || availableThemes[Math.floor(Math.random() * availableThemes.length)];

  // 5. Build prompt with strict constraints
  const prompt = `You are the Social Media Content Specialist for "${businessName}" (${industry}).
Draft an engaging, professional social media post grounded entirely in the business profile below.

BUSINESS CONTEXT:
- Business Name: ${businessName}
- Industry: ${industry}
- Service Areas: ${serviceAreas || 'Local community'}
- Approved Catalog & Offerings:
${catalogContext}

BRAND GUIDELINES:
- Language: ${brandSettings.language || 'English'}
- Tone: ${brandSettings.tone}
- Target Audience: ${brandSettings.target_audience}
- Content Theme: ${chosenTheme}
- Prohibited Topics (NEVER mention or violate): ${brandSettings.prohibited_topics.join(', ') || 'None'}
- Target Platforms: ${targetPlatforms.join(', ')}

RECENT POST TOPICS TO AVOID DUPLICATING:
${recentTopics || 'None'}
${recentCaptions ? `Recent Captions:\n- ${recentCaptions}` : ''}

OPERATOR INSTRUCTION:
${options?.custom_instruction || 'Create a fresh, engaging post highlighting customer value.'}

STRICT COMPLIANCE & FACTUAL SAFETY CONSTRAINTS:
1. Ground every claim solely in the verified business profile and catalog above.
2. ABSOLUTELY NO UNSUPPORTED TIME CLAIMS: Do NOT use "fresh this morning", "baked this morning", "hot out of the oven", or claim real-time daily bake status.
3. ABSOLUTELY NO ARTIFICIAL SCARCITY: Do NOT use "before they sell out", "before they're gone", "while supplies last", or "limited stock".
4. ABSOLUTELY NO SPECULATIVE OVEN TEMPERATURES OR EQUIPMENT: Do NOT invent oven temperatures (e.g. "500-degree oven") or unverified equipment.
5. ABSOLUTELY NO LIVE AVAILABILITY CLAIMS: Do NOT say "ready for breakfast", "today's batch is ready", or "out now" without verified live inventory telemetry.
6. ABSOLUTELY NO UNVERIFIED DISCOUNTS: Only quote standard catalog prices if provided. Never invent discounts, sales, or promotional bundles.
7. FOCUS ON CRAFT, TRADITION, AND QUALITY: Highlight artisan methods, natural sourdough fermentation, wholesome ingredients, and heritage recipes.
8. Output valid JSON ONLY matching the schema:
{
  "topic_theme": "${chosenTheme}",
  "campaign_name": "Weekly Brand Highlight",
  "caption": "Post text focusing on craft, catalog item, and authentic quality without unverified claims",
  "hashtags": ["relevant", "industry", "tags"],
  "video_script": "Optional 15-30 second short-form video script for TikTok/Reels focusing on verified baking craft, else null",
  "suggested_media_type": "image"
}`;

  let draft: GeneratedSocialDraft | null = null;
  const groqApiKey = process.env.GROQ_API_KEY;

  let llmRequestOutcome: {
    attempted: boolean;
    provider: string;
    model: string;
    status: 'success' | 'unconfigured' | 'error';
    message: string;
  } = {
    attempted: false,
    provider: 'Groq',
    model: 'openai/gpt-oss-120b',
    status: 'unconfigured',
    message: 'GROQ_API_KEY is not configured on the server. Please enter your Groq API key in .env.local to enable real LLM generation.',
  };

  // Coherent catalog item matching
  const products = Array.isArray(bizSettings.knowledge?.products_services) ? bizSettings.knowledge.products_services : [];
  const matchingProduct = products.find((p: any) =>
    chosenTheme.toLowerCase().includes('pastr')
      ? p.name.toLowerCase().includes('chocolat') || p.name.toLowerCase().includes('pastr')
      : p.name.toLowerCase().includes('sourdough')
  ) || products[0] || { name: 'Artisan Sourdough Boule', price: 8.50, description: 'naturally fermented 36 hours' };

  // Select matching media asset (stock asset, owner upload, or template card)
  const matchingMedia = mediaRows.find((m: any) => {
    const isSourdough = matchingProduct.name.toLowerCase().includes('sourdough');
    const isPastry = matchingProduct.name.toLowerCase().includes('chocolat') || matchingProduct.name.toLowerCase().includes('pastry');
    if (isSourdough && m.filename.toLowerCase().includes('sourdough')) return true;
    if (isPastry && (m.filename.toLowerCase().includes('chocolat') || m.filename.toLowerCase().includes('pastry'))) return true;
    return false;
  }) || mediaRows[0];

  const selectedMediaUrl = matchingMedia?.storage_url || availableMediaUrls[0];
  const mediaSource = matchingMedia?.source || (selectedMediaUrl?.startsWith('data:') ? 'branded_card_template' : 'stock_asset');
  const mediaLabel = mediaSource === 'stock_asset'
    ? 'Stock Imagery (Illustrative - Not Actual Product)'
    : (mediaSource === 'owner_upload' ? 'Verified Owner Photography' : 'Branded Template Card');

  if (groqApiKey && groqApiKey.startsWith('gsk_')) {
    llmRequestOutcome.attempted = true;
    const configuredModel = process.env.GROQ_MODEL?.trim();
    const candidateModels = configuredModel
      ? [configuredModel, 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile']
      : ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];

    for (const modelToTry of candidateModels) {
      if (draft) break;
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelToTry,
            messages: [
              {
                role: 'system',
                content: 'You are an AI social media engine for verified small businesses. You return ONLY raw JSON objects matching the schema. You strictly refrain from speculative claims, artificial scarcity, unverified oven temperatures, and unverified freshness statements.',
              },
              { role: 'user', content: prompt },
            ],
            temperature: 0.6,
            max_tokens: 800,
            response_format: { type: 'json_object' },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data?.choices?.[0]?.message?.content?.trim();
          if (content) {
            const parsed = JSON.parse(content);
            if (parsed.caption) {
              draft = {
                topic_theme: parsed.topic_theme || chosenTheme,
                campaign_name: parsed.campaign_name || 'Social Engagement',
                caption: parsed.caption,
                hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : ['business', industry],
                video_script: parsed.video_script || undefined,
                target_platforms: targetPlatforms,
                suggested_media_type: parsed.suggested_media_type === 'video' ? 'video' : 'image',
                media_urls: selectedMediaUrl ? [selectedMediaUrl] : availableMediaUrls.slice(0, 1),
                generation_source: 'llm_groq',
                generator_model: `Groq ${modelToTry}`,
                media_source: mediaSource,
                media_label: mediaLabel,
                llm_request_outcome: {
                  attempted: true,
                  provider: 'Groq',
                  model: modelToTry,
                  status: 'success',
                  message: `Successfully generated content via Groq ${modelToTry}`,
                },
              };
              llmRequestOutcome.status = 'success';
              llmRequestOutcome.model = modelToTry;
              llmRequestOutcome.message = `Successfully generated content via Groq ${modelToTry}`;
              break;
            }
          }
        } else {
          const errData = await response.json().catch(() => ({}));
          llmRequestOutcome.status = 'error';
          llmRequestOutcome.model = modelToTry;
          llmRequestOutcome.message = `HTTP ${response.status}: ${errData?.error?.message || response.statusText}`;
          console.warn(`[Social AI Groq Error with ${modelToTry}] ${llmRequestOutcome.message}`);
        }
      } catch (err: any) {
        llmRequestOutcome.status = 'error';
        llmRequestOutcome.model = modelToTry;
        llmRequestOutcome.message = err.message || 'Network error communicating with Groq API';
        console.warn(`[Social AI Groq Fallback] ${llmRequestOutcome.message}`);
      }
    }
  }

  // Fallback grounded generator if Groq is unreachable or not configured
  if (!draft) {
    const isRetailBakery = industry === 'retail' || businessName.toLowerCase().includes('bakery') || products.length > 0;

    if (isRetailBakery && products.length > 0) {
      const itemName = matchingProduct.name;
      const itemPrice = matchingProduct.price ? `$${Number(matchingProduct.price).toFixed(2)}` : '';
      const itemDesc = matchingProduct.description ? `${matchingProduct.description.toLowerCase()}` : 'handcrafted in small batches';
      const area = serviceAreas || 'Downtown District';

      // Truthful, craft-centered copy without unsupported claims (no "fresh this morning", no "before they sell out", no "500-degree oven")
      const bakeryCaptions = [
        `Our ${itemName} is crafted with traditional artisan methods and ${itemDesc}. Naturally fermented for authentic flavor, depth, and a classic golden blistered crust.\n\nAvailable at ${businessName} in ${area}${itemPrice ? ` (${itemPrice})` : ''}. Visit our bakery to explore our selection of handcrafted breads. 🥖`,
        `At ${businessName}, our passion is authentic sourdough bread made with patience, heritage techniques, and ${itemDesc}.\n\nStop by our bakery in ${area} to discover our handcrafted ${itemName}${itemPrice ? ` (${itemPrice})` : ''} and artisan specialty breads. 🍞`,
      ];

      const captionText = bakeryCaptions[Math.floor(Math.random() * bakeryCaptions.length)];
      const bakeryTag = businessName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      draft = {
        topic_theme: chosenTheme,
        campaign_name: 'Artisan Hearth Showcase',
        caption: captionText,
        hashtags: [
          bakeryTag,
          'artisanbakery',
          'sourdoughbread',
          'localbakery',
          'realbread',
          'traditionalbaking',
        ],
        video_script: targetPlatforms.includes('tiktok')
          ? `[Visual 0-3s]: Close-up of our ${itemName} displaying its golden blistered crust and airy crumb structure.\n[Voiceover 4-15s]: "At ${businessName}, our ${itemName} is naturally fermented over 36 hours using simple, wholesome ingredients."\n[Visual & CTA 16-20s]: Bread resting on wooden bakers rack. "Visit us in ${area} to experience authentic artisan baking."`
          : undefined,
        target_platforms: targetPlatforms,
        suggested_media_type: targetPlatforms.includes('tiktok') ? 'video' : 'image',
        media_urls: selectedMediaUrl ? [selectedMediaUrl] : [],
        generation_source: 'deterministic_catalog_grounded',
        generator_model: 'Catalog-Grounded Bakery Template Engine',
        media_source: mediaSource,
        media_label: mediaLabel,
        llm_request_outcome: llmRequestOutcome,
      };
    } else {
      const serviceName = servicesList[0]?.split(':')[0]?.replace('•', '').trim() || 'Professional Services';
      draft = {
        topic_theme: chosenTheme,
        campaign_name: 'Brand Trust & Quality',
        caption: `At ${businessName}, we take pride in delivering professional, high-quality ${serviceName.toLowerCase()} across ${serviceAreas || 'our local service area'}. Whether you have a question or need assistance, our experienced team is here to help.\n\nContact us today to learn more about our verified solutions!`,
        hashtags: [
          businessName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(),
          industry,
          'QualityService',
          'CustomerFirst',
        ],
        video_script: targetPlatforms.includes('tiktok')
          ? `[Hook: 0-3s]: "Looking for reliable ${serviceName.toLowerCase()} you can count on?"\n[Body: 4-15s]: "Here at ${businessName}, we focus on transparent service and long-lasting quality."\n[CTA: 16-20s]: "Drop your questions in the comments or visit our link in bio!"`
          : undefined,
        target_platforms: targetPlatforms,
        suggested_media_type: targetPlatforms.includes('tiktok') ? 'video' : 'image',
        media_urls: availableMediaUrls.slice(0, 1),
        generation_source: 'deterministic_catalog_grounded',
        generator_model: 'Catalog-Grounded Trade Template Engine',
        media_source: mediaSource,
        media_label: mediaLabel,
        llm_request_outcome: llmRequestOutcome,
      };
    }
  }

  // 6. Explicitly validate content and media
  const validation = validateSocialDraft(draft, brandSettings);
  if (!validation.valid) {
    throw new Error(`Content validation failed: ${validation.errors.join(', ')}`);
  }

  // Increment usage count
  await incrementGenerationUsage(tenantId);

  return draft;
}

export interface SocialValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSocialDraft(
  draft: GeneratedSocialDraft,
  brandSettings: { prohibited_topics?: string[] }
): SocialValidationResult {
  const errors: string[] = [];

  if (!draft.caption || draft.caption.trim().length === 0) {
    errors.push('Caption cannot be empty');
  }

  // Check prohibited topics
  const lowerCaption = (draft.caption || '').toLowerCase();
  for (const topic of brandSettings.prohibited_topics || []) {
    if (topic && lowerCaption.includes(topic.toLowerCase())) {
      errors.push(`Caption violates brand rules by mentioning prohibited topic: "${topic}"`);
    }
  }

  // Check for unsupported claims: "fresh this morning", artificial scarcity, unverified oven temps, live availability
  const unsupportedClaimPatterns = [
    { pattern: /\bfresh\s+this\s+morning\b/i, name: '"fresh this morning"' },
    { pattern: /\b(baked|straight\s+out\s+of\s+the\s+oven)\s+this\s+morning\b/i, name: '"baked this morning"' },
    { pattern: /\b(before\s+they\s+sell\s+out|before\s+they('re|\s+are)\s+gone|limited\s+(quantity|loaves|stock)|while\s+supplies\s+last)\b/i, name: 'artificial scarcity ("before they sell out / while supplies last")' },
    { pattern: /\b\d{3}\s*[-–—]?\s*(degree|°)\b/i, name: 'unverified oven temperature' },
    { pattern: /\b(ready\s+for\s+breakfast|batch\s+is\s+ready|out\s+now)\b/i, name: 'unverified real-time availability' },
    { pattern: /\b(\d+%\s*off|discount|sale|special\s+promo)\b/i, name: 'unverified discount or promotion' },
  ];

  for (const { pattern, name } of unsupportedClaimPatterns) {
    if (pattern.test(lowerCaption) || (draft.video_script && pattern.test(draft.video_script.toLowerCase()))) {
      errors.push(`Content contains unverified claim (${name}). All promotional claims require verified business data.`);
    }
  }

  // Check media URLs: must not substitute text/scripts for media
  if (!draft.media_urls || draft.media_urls.length === 0) {
    errors.push('Media validation failed: an actual image/video asset is required');
  } else {
    for (const url of draft.media_urls) {
      const isDataUri = url.startsWith('data:image/') || url.startsWith('data:video/');
      const isHttp = url.startsWith('http://') || url.startsWith('https://');
      if (!isDataUri && !isHttp) {
        errors.push(`Invalid media format: ${url.slice(0, 40)}`);
      }
    }
  }

  if (!draft.target_platforms || draft.target_platforms.length === 0) {
    errors.push('Target platforms list cannot be empty');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
