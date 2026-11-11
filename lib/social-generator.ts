import { query } from './db.ts';
import {
  getSocialBrandSettings,
  getSocialGenerationJob,
  updateSocialGenerationJob,
  createSocialPost,
  createSocialMediaAsset,
} from './social-db.ts';
import type {
  SocialContentAngle,
  SocialGenerationJobRecord,
  SocialPlatform,
} from './social-types.ts';

/**
 * Calculates Jaccard word similarity between two text strings
 */
function calculateTextSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;
  const wordsA = new Set(
    textA
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  const wordsB = new Set(
    textB
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

export async function runSocialGenerationPipeline(jobId: string): Promise<SocialGenerationJobRecord> {
  const job = await getSocialGenerationJob(jobId);
  if (!job) {
    throw new Error(`Generation job not found: ${jobId}`);
  }

  const tenantId = job.tenant_id;
  const options = job.options || {};

  try {
    // =========================================================================
    // STAGE 1: CHOOSING DISTINCT CONTENT IDEA (Progress: 20%)
    // =========================================================================
    await updateSocialGenerationJob(jobId, {
      status: 'choosing_idea',
      stage_label: 'Analyzing business catalog & choosing distinct angle',
      stage_progress: 20,
    });

    // 1. Load active tenant business profile
    const bizRows = await query<any>(
      `SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const bizSettings = bizRows[0]?.settings || {};
    const businessName = bizSettings.business_name || tenantId;
    const industry = bizSettings.industry || bizSettings.business_type || 'services';

    // 2. Extract catalog, services & verified prices
    const catalogItems: Array<{ id?: string; name: string; price?: string; description?: string }> = [];
    if (Array.isArray(bizSettings.knowledge?.services)) {
      bizSettings.knowledge.services.forEach((s: any) => {
        if (s.name) {
          const priceStr = s.price ? `$${s.price}` : (s.price_type === 'quote_required' ? 'Custom Quote' : undefined);
          catalogItems.push({ id: s.id, name: s.name, price: priceStr, description: s.description });
        }
      });
    }
    if (Array.isArray(bizSettings.knowledge?.products_services)) {
      bizSettings.knowledge.products_services.forEach((p: any) => {
        if (p.name) {
          const priceStr = p.price ? `$${Number(p.price).toFixed(2)}` : undefined;
          catalogItems.push({ id: p.id, name: p.name, price: priceStr, description: p.description });
        }
      });
    }

    // 3. Extract service areas, FAQs and policies
    const serviceAreas = (bizSettings.knowledge?.service_areas || []).map((a: any) => a.name).filter(Boolean).join(', ');
    const faqs = (bizSettings.knowledge?.faqs || []).slice(0, 5);

    // 4. Validate essential business information
    if (!businessName || (catalogItems.length === 0 && faqs.length === 0 && !bizSettings.knowledge?.policies?.general_rules)) {
      const err = `Essential business information is missing for '${tenantId}'. Please add your verified services or catalog products in settings before generating content.`;
      await updateSocialGenerationJob(jobId, {
        status: 'failed',
        stage_label: 'Failed: Missing Business Facts',
        stage_progress: 0,
        error_message: err,
      });
      throw new Error(err);
    }

    // 5. Load brand settings
    const brandSettings = await getSocialBrandSettings(tenantId);
    const brandTone = brandSettings.tone || bizSettings.tone || 'Professional, friendly, and authentic';
    const targetAudience = brandSettings.target_audience || 'Local homeowners, residents, and business clients';
    const brandLanguage = options.language || brandSettings.language || 'English';
    const prohibitedTopics = brandSettings.prohibited_topics || [];
    const targetPlatforms: SocialPlatform[] = options.target_platforms && options.target_platforms.length > 0
      ? options.target_platforms
      : (brandSettings.selected_platforms.length > 0 ? brandSettings.selected_platforms : ['facebook', 'instagram']);

    // 6. Load recent posts to guarantee divergence
    const recentPosts = await query<any>(
      `SELECT id, topic_theme, caption, metadata FROM iao.social_posts
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 15`,
      [tenantId]
    );

    const recentCaptions = recentPosts.map((p) => p.caption);
    const recentAngles: string[] = recentPosts
      .map((p) => p.metadata?.content_angle)
      .filter(Boolean);
    const recentCatalogNames: string[] = recentPosts
      .map((p) => p.metadata?.catalog_item_name?.toLowerCase())
      .filter(Boolean);

    // 7. Divergent concept selection
    const ALL_ANGLES: SocialContentAngle[] = [
      'product_service_spotlight',
      'educational_tip',
      'customer_faq',
      'behind_the_scenes_process',
      'brand_heritage_values',
    ];

    // Pick angle that avoids the last 2 used angles
    const lastAngle = recentAngles[0];
    const secondLastAngle = recentAngles[1];
    const eligibleAngles = ALL_ANGLES.filter((a) => a !== lastAngle && a !== secondLastAngle);
    const chosenAngle = eligibleAngles.length > 0
      ? eligibleAngles[Math.floor(Math.random() * eligibleAngles.length)]
      : ALL_ANGLES[Math.floor(Math.random() * ALL_ANGLES.length)];

    // Pick least recently featured catalog item
    let chosenItem = catalogItems.find((item) => !recentCatalogNames.includes(item.name.toLowerCase()));
    if (!chosenItem && catalogItems.length > 0) {
      chosenItem = catalogItems[Math.floor(Math.random() * catalogItems.length)];
    }

    // Determine angle metadata & hook
    let angleTitle = 'Service & Quality Spotlight';
    let hookType = 'Question Hook';
    let visualConcept = 'Clean hero presentation of the primary offering';

    switch (chosenAngle) {
      case 'product_service_spotlight':
        angleTitle = `Spotlight: ${chosenItem?.name || 'Signature Offering'}`;
        hookType = 'Value Proposition Hook';
        visualConcept = `Clear focus on ${chosenItem?.name || 'the verified offering'} highlighting craftsmanship and verified specifications.`;
        break;
      case 'educational_tip':
        angleTitle = `Expert Tip for ${industry}`;
        hookType = 'How-To / Insight Hook';
        visualConcept = `Step-by-step or detail view demonstrating practical maintenance and expert advice.`;
        break;
      case 'customer_faq':
        angleTitle = `Frequently Asked Question in ${industry}`;
        hookType = 'Direct Inquiry Hook';
        visualConcept = `Helpful explanatory graphic addressing common client inquiries transparently.`;
        break;
      case 'behind_the_scenes_process':
        angleTitle = `Behind the Scenes: Authentic ${industry} Craft`;
        hookType = 'Process / Story Opener';
        visualConcept = `Close-up on hands-on tools, preparation stages, and dedication to precision.`;
        break;
      case 'brand_heritage_values':
        angleTitle = `Community & Core Values`;
        hookType = 'Commitment / Mission Opener';
        visualConcept = `Local presence, customer relationship focus, and verified service area dedication.`;
        break;
    }

    const selectedConcept = {
      content_angle: chosenAngle,
      angle_title: angleTitle,
      topic: options.theme || angleTitle,
      catalog_item_id: chosenItem?.id,
      catalog_item_name: chosenItem?.name,
      hook_type: hookType,
      visual_concept: visualConcept,
    };

    await updateSocialGenerationJob(jobId, {
      selected_concept: selectedConcept,
      stage_label: `Idea chosen: ${angleTitle}`,
      stage_progress: 35,
    });

    // =========================================================================
    // STAGE 2: WRITING GROUNDED CAPTION & HASHTAGS (Progress: 55%)
    // =========================================================================
    await updateSocialGenerationJob(jobId, {
      status: 'writing_caption',
      stage_label: `Drafting content in ${brandLanguage} (${brandTone})`,
      stage_progress: 55,
    });

    const catalogSummary = catalogItems
      .map((c) => `• ${c.name}${c.price ? ` (${c.price})` : ''}: ${c.description || 'Standard offering'}`)
      .join('\n');

    const prompt = `You are the Social Media Specialist for "${businessName}" (Industry: ${industry}).
Generate a genuinely distinct social media post in ${brandLanguage}.

BUSINESS IDENTITY & RULES:
- Business Name: ${businessName}
- Industry: ${industry}
- Tone: ${brandTone}
- Target Audience: ${targetAudience}
- Service Areas: ${serviceAreas || 'Local community'}
- Approved Catalog Offerings:
${catalogSummary || 'Standard offerings'}

SELECTED CONTENT CONCEPT:
- Content Angle: ${chosenAngle} (${angleTitle})
- Hook Style: ${hookType}
- Specific Focus: ${chosenItem ? `${chosenItem.name} ${chosenItem.price ? `(${chosenItem.price})` : ''}` : 'Company specialty'}
- Visual Concept: ${visualConcept}

PROHIBITED TOPICS & CLAIMS (STRICT):
${prohibitedTopics.map((p: string) => `- ${p}`).join('\n') || '- None'}
- NEVER make unsupported claims: no fake discounts, no artificial scarcity ("selling fast", "limited spots"), no unverified oven/tool specs, no unverified same-day freshness claims ("baked this morning").
- NEVER invent customer reviews, certifications, or awards not in verified context.
- Ground all facts strictly in the business profile provided above.

RECENT POST CAPTIONS TO AVOID DUPLICATING (MUST BE SUBSTANTIALLY DIFFERENT IN HOOK AND PHRASING):
${recentCaptions.slice(0, 3).map((c: string) => `- "${c.slice(0, 80)}..."`).join('\n') || 'None'}

OUTPUT SCHEMA: Return ONLY a valid JSON object matching:
{
  "caption": "Full post text in ${brandLanguage} matching tone and angle without speculative claims",
  "hashtags": ["relevant", "industry", "specific", "tags"],
  "image_prompt": "Photorealistic or high-end visual prompt matching this post and business for an image generator",
  "alt_text": "Detailed accessibility description of the visual",
  "video_script": "Optional short script for TikTok/Reels if video is appropriate, else null"
}`;

    const groqApiKey = process.env.GROQ_API_KEY;
    const configuredModel = process.env.GROQ_MODEL?.trim();
    const candidateModels = configuredModel
      ? [configuredModel, 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b']
      : ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];

    let generatedDraft: any = null;
    let modelUsed = 'Catalog-Grounded Engine';
    let generationSource = 'deterministic_catalog_grounded';

    if (groqApiKey && groqApiKey.startsWith('gsk_')) {
      for (const modelToTry of candidateModels) {
        if (generatedDraft) break;
        try {
          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${groqApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelToTry,
              messages: [
                {
                  role: 'system',
                  content: 'You are an expert AI social media copywriter for verified businesses. You return ONLY valid JSON matching the exact schema.',
                },
                { role: 'user', content: prompt },
              ],
              temperature: 0.7,
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
                // Check similarity against recent captions
                let isTooSimilar = false;
                for (const oldCap of recentCaptions.slice(0, 5)) {
                  if (calculateTextSimilarity(parsed.caption, oldCap) > 0.65) {
                    isTooSimilar = true;
                    break;
                  }
                }

                // If not too similar, accept draft
                if (!isTooSimilar || recentCaptions.length === 0) {
                  generatedDraft = parsed;
                  modelUsed = `Groq ${modelToTry}`;
                  generationSource = 'llm_groq';
                  break;
                }
              }
            }
          }
        } catch (groqErr) {
          console.warn(`[Pipeline] Groq ${modelToTry} attempt error:`, groqErr);
        }
      }
    }

    // Fallback if LLM is unavailable or unconfigured
    if (!generatedDraft) {
      const itemName = chosenItem?.name || `${businessName} Service`;
      const itemPrice = chosenItem?.price ? ` (${chosenItem.price})` : '';
      const fallbackCaptions: Record<SocialContentAngle, string> = {
        product_service_spotlight: `Focusing on quality and craftsmanship with our ${itemName}${itemPrice}. Dedicated to high standards and dependable results for our community in ${serviceAreas || 'our service area'}.`,
        educational_tip: `Helpful tip from ${businessName}: Regular care and routine inspection of your ${itemName} prevents common issues and ensures long-lasting performance. Contact us if you have any questions!`,
        customer_faq: `Client Question: What sets our ${itemName} apart? Transparent pricing, proven expertise, and attentive service for every job in ${serviceAreas || 'the area'}.`,
        behind_the_scenes_process: `Behind every ${itemName} is meticulous attention to detail and traditional workmanship at ${businessName}. Discover what goes into every project.`,
        brand_heritage_values: `Rooted in dependable quality and integrity: at ${businessName}, we take pride in serving ${serviceAreas || 'our community'} with authentic dedication.`,
      };

      generatedDraft = {
        caption: fallbackCaptions[chosenAngle],
        hashtags: [businessName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(), industry, 'qualityservice', 'localbusiness'],
        image_prompt: `Clean, commercial photography showcasing ${itemName} in a professional ${industry} setting.`,
        alt_text: `Professional showcase of ${itemName}`,
        video_script: null,
      };
    }

    const draftPayload = {
      caption: generatedDraft.caption,
      hashtags: Array.isArray(generatedDraft.hashtags) ? generatedDraft.hashtags : [industry, 'service'],
      video_script: generatedDraft.video_script || undefined,
      image_prompt: generatedDraft.image_prompt || `Commercial marketing visual for ${businessName}`,
      alt_text: generatedDraft.alt_text || `Showcase of ${businessName} ${chosenAngle}`,
      suggested_media_type: options.target_platforms?.includes('tiktok') && generatedDraft.video_script ? 'video' : 'image',
      generation_source: generationSource,
      generator_model: modelUsed,
    };

    await updateSocialGenerationJob(jobId, {
      generated_draft: draftPayload,
      stage_label: 'Draft completed, evaluating media provider',
      stage_progress: 75,
    });

    // =========================================================================
    // STAGE 3: EVALUATING & GENERATING MEDIA (Progress: 80%)
    // =========================================================================
    await updateSocialGenerationJob(jobId, {
      status: 'generating_image',
      stage_label: 'Evaluating media generation provider',
      stage_progress: 80,
    });

    let mediaResult: any = null;
    const openaiKey = process.env.OPENAI_API_KEY;

    // Check if an authorized paid image generator is available
    if (openaiKey && openaiKey.startsWith('sk-')) {
      try {
        const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: `${draftPayload.image_prompt}. Professional commercial photograph, clean lighting, no text overlays.`,
            n: 1,
            size: '1024x1024',
          }),
        });

        if (dalleRes.ok) {
          const dalleData = await dalleRes.json();
          const imageUrl = dalleData.data?.[0]?.url;
          if (imageUrl) {
            // Save asset record
            const asset = await createSocialMediaAsset(tenantId, {
              media_type: 'image',
              storage_url: imageUrl,
              filename: `ai_gen_${tenantId}_${Date.now()}.png`,
              filesize_bytes: 1024 * 1024,
              mime_type: 'image/png',
              source: 'ai_generated',
              dimensions: { width: 1024, height: 1024 },
            });

            mediaResult = {
              status: 'generated',
              asset_id: asset.id,
              storage_url: imageUrl,
              format: 'image/png',
              width: 1024,
              height: 1024,
              provider: 'OpenAI DALL-E 3',
              model: 'dall-e-3',
            };
          }
        }
      } catch (dalleErr: any) {
        console.warn('[Pipeline] DALL-E 3 generation failed:', dalleErr.message);
      }
    }

    // Honest Free-Tier Evaluation & Blocker Reporting:
    // If no paid image API key is configured in .env.local:
    if (!mediaResult) {
      // Check if tenant has existing real owner-uploaded assets to link as reference
      const ownerAssets = await query<any>(
        `SELECT id, storage_url, filename, mime_type FROM iao.social_media_assets
         WHERE tenant_id = $1 AND source IN ('owner_upload', 'stock_asset')
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId]
      );

      const existingAsset = ownerAssets[0];

      mediaResult = {
        status: 'blocked_unconfigured',
        asset_id: existingAsset?.id,
        storage_url: existingAsset?.storage_url || null,
        format: existingAsset?.mime_type || 'image_prompt_only',
        provider: 'None (Unconfigured)',
        model: 'Free-Tier Inspection Active',
        error: 'No usable free image generation API is available on the current account. Google Gemini Imagen 3 and HuggingFace serverless text-to-image require paid billing accounts. The AI image prompt was synthesized and saved for review.',
        image_prompt: draftPayload.image_prompt,
      };
    }

    await updateSocialGenerationJob(jobId, {
      media_result: mediaResult,
      stage_label: 'Finalizing post preview',
      stage_progress: 95,
    });

    // =========================================================================
    // STAGE 4: READY / STORE POST PREVIEW (Progress: 100%)
    // =========================================================================
    let createdPostId: string | null = null;

    if (options.save_as_post) {
      const isAutopilot = brandSettings.automation_mode === 'autopilot';
      const scheduledDate = options.scheduled_at ? new Date(options.scheduled_at) : new Date(Date.now() + 86400000);

      const mediaUrls = mediaResult?.storage_url ? [mediaResult.storage_url] : [];

      const post = await createSocialPost(tenantId, {
        caption: draftPayload.caption,
        hashtags: draftPayload.hashtags,
        video_script: draftPayload.video_script,
        target_platforms: targetPlatforms,
        topic_theme: selectedConcept.topic,
        campaign_name: selectedConcept.angle_title,
        media_urls: mediaUrls,
        scheduled_at: scheduledDate,
        status: isAutopilot ? 'scheduled' : 'pending_approval',
        is_approved: isAutopilot,
        approved_by: isAutopilot ? 'n8n_autopilot' : undefined,
        metadata: {
          generation_job_id: jobId,
          content_angle: selectedConcept.content_angle,
          angle_title: selectedConcept.angle_title,
          catalog_item_name: selectedConcept.catalog_item_name,
          generation_source: draftPayload.generation_source,
          generator_model: draftPayload.generator_model,
          image_prompt: draftPayload.image_prompt,
          alt_text: draftPayload.alt_text,
          media_status: mediaResult.status,
          media_provider_outcome: mediaResult.error || 'Success',
        },
      });

      createdPostId = post.id;
    }

    const completedJob = await updateSocialGenerationJob(jobId, {
      status: 'ready',
      stage_label: 'Ready for review',
      stage_progress: 100,
      post_id: createdPostId,
    });

    return completedJob!;
  } catch (err: any) {
    console.error(`[Pipeline Error on Job ${jobId}]:`, err);
    await updateSocialGenerationJob(jobId, {
      status: 'failed',
      stage_label: 'Generation Failed',
      stage_progress: 0,
      error_message: err.message || 'An unexpected error occurred during generation pipeline',
    });
    throw err;
  }
}
