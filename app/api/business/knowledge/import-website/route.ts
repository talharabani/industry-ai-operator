import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getBusiness, updateServicesKnowledge } from '@/lib/db';
import { safeFetch } from '@/lib/ssrf-protection';
import { ExtractedFactItem } from '@/lib/types';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function cleanHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const { url, tenant_id } = body;
    const targetTenant = tenant_id ? String(tenant_id).trim() : session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    if (authCheck.role === 'member') {
      return NextResponse.json({ error: 'Only owners and admins can import website knowledge.' }, { status: 403 });
    }

    if (!url || typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: 'Website URL is required.' }, { status: 400 });
    }

    const cleanUrl = url.trim();

    // 1. SSRF-Safe Outbound Fetch with bounded retrieval (max 200KB, 5s timeout)
    let pageText = '';
    try {
      const res = await safeFetch(
        cleanUrl,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; IndustryAiOperatorBot/1.0)',
            Accept: 'text/html,text/plain',
          },
        },
        {
          timeoutMs: 5000,
          maxRedirects: 2,
        }
      );

      if (!res.ok) {
        return NextResponse.json(
          { error: `Website returned HTTP status ${res.status} ${res.statusText}` },
          { status: 400 }
        );
      }

      const rawHtml = await res.text();
      // Bounded limit: 200,000 characters maximum
      pageText = cleanHtmlToText(rawHtml.slice(0, 200000));
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Failed to retrieve website';
      return NextResponse.json({ error: `Safe fetch failed: ${msg}` }, { status: 400 });
    }

    if (!pageText || pageText.length < 20) {
      return NextResponse.json(
        { error: 'Website did not contain sufficient extractable plain text content.' },
        { status: 400 }
      );
    }

    // 2. Deterministic Fact Extraction (Treating website text strictly as untrusted data, never instructions)
    const candidateFacts: ExtractedFactItem[] = [];
    const now = new Date().toISOString();

    // A. Hours of operation extraction
    const hoursMatch = pageText.match(
      /(?:hours|opening hours|business hours|timing|schedule)[:\s]+([^.]{10,120})/i
    );
    if (hoursMatch) {
      candidateFacts.push({
        id: `fact_hours_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        source_url: cleanUrl,
        fact_type: 'hours',
        raw_text: hoursMatch[0].trim(),
        extracted_data: { raw_schedule: hoursMatch[1].trim() },
        approval_status: 'pending_review',
        created_at: now,
      });
    }

    // B. Service Areas extraction
    const areasMatch = pageText.match(
      /(?:service area|areas served|coverage|serving|locations)[:\s]+([^.]{10,150})/i
    );
    if (areasMatch) {
      candidateFacts.push({
        id: `fact_area_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        source_url: cleanUrl,
        fact_type: 'service_area',
        raw_text: areasMatch[0].trim(),
        extracted_data: { coverage: areasMatch[1].trim() },
        approval_status: 'pending_review',
        created_at: now,
      });
    }

    // C. Candidate Services extraction (looking for service headings / phrases)
    const servicePhrases = pageText.match(
      /(?:services include|we offer|our services|specializing in)[:\s]+([^.]{15,250})/i
    );
    if (servicePhrases) {
      const rawList = servicePhrases[1].trim();
      const items = rawList.split(/,|;|•|\band\b/).map((s) => s.trim()).filter((s) => s.length >= 3 && s.length <= 60);

      items.slice(0, 5).forEach((item) => {
        candidateFacts.push({
          id: `fact_srv_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          source_url: cleanUrl,
          fact_type: 'service',
          raw_text: item,
          extracted_data: {
            name: item,
            price_type: 'quote_required', // Never invent prices!
          },
          approval_status: 'pending_review',
          created_at: now,
        });
      });
    }

    // D. FAQ extraction (Q & A patterns)
    const faqMatches = Array.from(pageText.matchAll(/([A-Z][^?]{10,90}\?)\s*([^.]{15,200}\.)/g));
    faqMatches.slice(0, 3).forEach((m) => {
      candidateFacts.push({
        id: `fact_faq_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        source_url: cleanUrl,
        fact_type: 'faq',
        raw_text: `${m[1]} ${m[2]}`,
        extracted_data: {
          question: m[1].trim(),
          answer: m[2].trim(),
        },
        approval_status: 'pending_review',
        created_at: now,
      });
    });

    // Save extracted facts to business knowledge with 'pending_review' state
    const business = await getBusiness(authCheck.tenantId);
    const existingFacts = business?.settings?.knowledge?.extracted_facts || [];
    const mergedFacts = [...existingFacts, ...candidateFacts];

    await updateServicesKnowledge(authCheck.tenantId, { extracted_facts: mergedFacts });

    return NextResponse.json({
      success: true,
      source_url: cleanUrl,
      extracted_facts: candidateFacts,
      count: candidateFacts.length,
      message: `${candidateFacts.length} candidate facts extracted. Review and approve facts before they are utilized in responses.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Website import failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
