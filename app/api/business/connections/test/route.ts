import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getBusiness, updateBusinessSettings, recordAuditLog } from '@/lib/db';
import { ConnectionStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    const body = await request.json().catch(() => ({}));
    const { channel } = body;

    const business = await getBusiness(tenantId);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const currentSettings = business.settings;
    const now = new Date().toISOString();

    if (channel === 'website') {
      const type = body.type || currentSettings.connections?.website?.type || 'shopify';
      const storeUrl = body.store_url || currentSettings.connections?.website?.store_url || '';
      const apiKey = body.api_key || body.access_token || '';

      if (type === 'no_website') {
        // Hosted inquiry form verification: Native hosted form is hosted on platform
        const hostedEnabled = body.hosted_inquiry_enabled !== false;
        const status: ConnectionStatus = hostedEnabled ? 'connected' : 'not_connected';

        currentSettings.connections.website = {
          type: 'no_website',
          status,
          hosted_inquiry_enabled: hostedEnabled,
          last_tested: now,
          is_verified: hostedEnabled,
        };

        await updateBusinessSettings(tenantId, currentSettings);
        await recordAuditLog(tenantId, 'connection_tested', { channel: 'website', type: 'no_website', status });

        return NextResponse.json({
          success: hostedEnabled,
          status,
          is_verified: hostedEnabled,
          message: hostedEnabled
            ? 'Hosted Inquiry Portal active and verified for direct customer intake.'
            : 'Hosted Inquiry Form is currently disabled.',
          last_tested: now,
        });
      }

      if (!storeUrl || !storeUrl.startsWith('http')) {
        currentSettings.connections.website = {
          type: type as any,
          status: 'not_connected',
          store_url: storeUrl,
          hosted_inquiry_enabled: currentSettings.connections?.website?.hosted_inquiry_enabled ?? true,
          last_tested: now,
          is_verified: false,
        };
        await updateBusinessSettings(tenantId, currentSettings);

        return NextResponse.json({
          success: false,
          status: 'not_connected',
          is_verified: false,
          error: 'Please enter a valid store URL (e.g. https://your-store.myshopify.com).',
        }, { status: 400 });
      }

      // If an authenticated API key is provided, perform live API test
      if (apiKey && apiKey.length > 10) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const testUrl = `${storeUrl.replace(/\/+$/, '')}/admin/api/2024-01/shop.json`;
          const res = await fetch(testUrl, {
            method: 'GET',
            headers: { 'X-Shopify-Access-Token': apiKey },
            signal: controller.signal,
          }).catch(() => null);
          clearTimeout(timeoutId);

          if (res && res.status === 200) {
            currentSettings.connections.website = {
              type: type as any,
              status: 'connected',
              store_url: storeUrl,
              hosted_inquiry_enabled: currentSettings.connections?.website?.hosted_inquiry_enabled ?? true,
              last_tested: now,
              is_verified: true,
            };
            await updateBusinessSettings(tenantId, currentSettings);
            return NextResponse.json({
              success: true,
              status: 'connected',
              is_verified: true,
              message: 'Authenticated store connection successfully verified with live API token.',
              last_tested: now,
            });
          }
        } catch {
          // Handled below
        }
      }

      // Valid URL without API token is NOT verified live (Requirement 1)
      const status: ConnectionStatus = 'demo_simulated';
      currentSettings.connections.website = {
        type: type as any,
        status,
        store_url: storeUrl,
        hosted_inquiry_enabled: currentSettings.connections?.website?.hosted_inquiry_enabled ?? true,
        last_tested: now,
        is_verified: false,
      };

      await updateBusinessSettings(tenantId, currentSettings);
      await recordAuditLog(tenantId, 'connection_tested', { channel: 'website', store_url: storeUrl, status });

      return NextResponse.json({
        success: true,
        status: 'demo_simulated',
        is_verified: false,
        message: 'Store URL recorded in Demo / Simulated mode. Live verified connection requires authenticated API token credentials.',
        last_tested: now,
      });
    }

    if (channel === 'email') {
      const provider = body.provider || currentSettings.connections?.email?.provider || 'resend';
      const senderEmail = body.sender_email || currentSettings.connections?.email?.sender_email || '';
      const apiKey = body.api_key || process.env.RESEND_API_KEY || '';

      const validEmail = Boolean(senderEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail));
      if (!validEmail) {
        currentSettings.connections.email = {
          mode: currentSettings.connections.email?.mode || 'demo',
          provider: provider as any,
          status: 'not_connected',
          sender_email: senderEmail,
          last_tested: now,
          is_verified: false,
        };
        await updateBusinessSettings(tenantId, currentSettings);

        return NextResponse.json({
          success: false,
          status: 'not_connected',
          is_verified: false,
          error: 'Please provide a valid sender email address.',
        }, { status: 400 });
      }

      // Check for live Resend API key
      if (apiKey && apiKey.startsWith('re_')) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const res = await fetch('https://api.resend.com/api-keys', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: controller.signal,
          }).catch(() => null);
          clearTimeout(timeoutId);

          if (res && res.status === 200) {
            currentSettings.connections.email = {
              mode: 'live',
              provider: 'resend',
              status: 'connected',
              sender_email: senderEmail,
              last_tested: now,
              is_verified: true,
            };
            await updateBusinessSettings(tenantId, currentSettings);
            return NextResponse.json({
              success: true,
              status: 'connected',
              is_verified: true,
              message: `Live Resend email connection verified for ${senderEmail}.`,
              last_tested: now,
            });
          } else {
            currentSettings.connections.email = {
              mode: 'live',
              provider: 'resend',
              status: 'error',
              sender_email: senderEmail,
              last_tested: now,
              is_verified: false,
            };
            await updateBusinessSettings(tenantId, currentSettings);
            return NextResponse.json({
              success: false,
              status: 'error',
              is_verified: false,
              error: 'Resend API authentication failed. Check API Key credentials.',
            }, { status: 401 });
          }
        } catch (err) {
          console.warn('[Email test error]', err);
        }
      }

      // No live API key configured -> Demo / Simulated mode (Requirement 1 & 6)
      const status: ConnectionStatus = 'demo_simulated';
      currentSettings.connections.email = {
        mode: 'demo',
        provider: provider as any,
        status,
        sender_email: senderEmail,
        last_tested: now,
        is_verified: false,
      };

      await updateBusinessSettings(tenantId, currentSettings);
      await recordAuditLog(tenantId, 'connection_tested', { channel: 'email', sender_email: senderEmail, status });

      return NextResponse.json({
        success: true,
        status: 'demo_simulated',
        is_verified: false,
        message: `Email configured in Demo / Simulated mode for ${senderEmail}. Dispatches will be tracked as simulated demo.`,
        last_tested: now,
      });
    }

    if (channel === 'whatsapp') {
      currentSettings.connections.whatsapp = {
        provider: 'none',
        status: 'not_implemented',
        last_tested: now,
        is_verified: false,
      };
      await updateBusinessSettings(tenantId, currentSettings);

      return NextResponse.json({
        success: false,
        status: 'not_implemented',
        is_verified: false,
        message: 'WhatsApp Cloud API connector is marked "Not implemented" in this release.',
      });
    }

    return NextResponse.json({ error: 'Invalid connection channel specified.' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
