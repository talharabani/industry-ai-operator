import { NextRequest, NextResponse } from 'next/server';
import { getBusiness, getBusinessByPublicFormId, createInquiryConversation } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. IP & Rate Limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous-client';
    const rateLimitKey = `inquiry:${ip}`;
    const rateCheck = checkRateLimit(rateLimitKey, 10, 600 * 1000);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many submissions. Please wait ${rateCheck.resetInSeconds} seconds before submitting again.`,
          retryAfter: rateCheck.resetInSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.resetInSeconds),
          },
        }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      tenant_id,
      public_form_id,
      customer_name,
      customer_email,
      customer_phone,
      service_interest,
      budget_range,
      location,
      subject,
      message,
      honeypot, // Anti-spam trap field
    } = body;

    // 2. Anti-spam check: If honeypot is filled, silently ignore
    if (honeypot && String(honeypot).trim().length > 0) {
      return NextResponse.json(
        { success: true, message: 'Inquiry received' },
        { status: 200 }
      );
    }

    // 3. Resolve & Verify Business Server-Side (supports opaque form ID or tenant identifier)
    const identifier = public_form_id || tenant_id;
    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      return NextResponse.json(
        { error: 'Valid business identifier or form ID is required.' },
        { status: 400 }
      );
    }

    // Attempt lookup by opaque public form id first, then fallback to tenant_id
    let business = await getBusinessByPublicFormId(identifier.trim());
    if (!business) {
      business = await getBusiness(identifier.trim());
    }

    if (!business) {
      return NextResponse.json(
        { error: 'Business portal not found or inactive.' },
        { status: 404 }
      );
    }

    // Check if hosted inquiry is enabled for this business
    const hostedEnabled = business.settings?.connections?.website?.hosted_inquiry_enabled !== false;
    if (!hostedEnabled) {
      return NextResponse.json(
        { error: 'This business has temporarily disabled public hosted inquiries.' },
        { status: 403 }
      );
    }

    // 4. Input Validation
    const name = typeof customer_name === 'string' ? customer_name.trim() : '';
    const email = typeof customer_email === 'string' ? customer_email.trim() : '';
    const phone = typeof customer_phone === 'string' ? customer_phone.trim() : null;
    const msgBody = typeof message === 'string' ? message.trim() : '';
    const msgSubject = typeof subject === 'string' && subject.trim() ? subject.trim() : null;
    const srvInterest = typeof service_interest === 'string' && service_interest.trim() ? service_interest.trim() : null;
    const bgtRange = typeof budget_range === 'string' && budget_range.trim() ? budget_range.trim() : null;
    const loc = typeof location === 'string' && location.trim() ? location.trim() : null;

    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: 'Please provide a valid full name.' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please provide a valid email address.' },
        { status: 400 }
      );
    }

    if (!msgBody || msgBody.length < 5) {
      return NextResponse.json(
        { error: 'Please enter inquiry details (at least 5 characters).' },
        { status: 400 }
      );
    }

    // 5. Persist to Unified Inbox and Create/Update Services Lead
    const result = await createInquiryConversation(business.tenant_id, {
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      channel: 'hosted_inquiry',
      subject: msgSubject || (srvInterest ? `Inquiry regarding ${srvInterest}` : null),
      message_body: msgBody,
      service_interest: srvInterest,
      budget_range: bgtRange,
      location: loc,
    });

    return NextResponse.json({
      success: true,
      reference_id: result.conversation.id,
      conversation_id: result.conversation.id,
      lead_id: result.leadId,
      business_name: business.settings.business_name,
      message: 'Inquiry successfully submitted. Our team will review and respond promptly.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to submit inquiry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
