import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { query } from '@/lib/db';
import { getSocialBrandSettings, createSocialPost, createSocialGenerationJob } from '@/lib/social-db';
import { runSocialGenerationPipeline } from '@/lib/social-generator';

export const dynamic = 'force-dynamic';
function getUtcDateForLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const tz = timezone || 'UTC';
  if (tz === 'UTC') {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  }
  try {
    const dateUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const invDate = new Date(dateUtc.toLocaleString('en-US', { timeZone: tz }));
    const diff = dateUtc.getTime() - invDate.getTime();
    return new Date(dateUtc.getTime() + diff);
  } catch {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  }
}

/**
 * Calculates recurring slot timestamps based on timezone, days of week, and times.
 */
function calculateRecurringSlots(
  timezone: string = 'UTC',
  postingDays: number[] = [1, 3, 5],
  postingTimes: string[] = ['10:00'],
  referenceDate: Date = new Date()
): { dueSlot: Date | null; nextSlot: Date } {
  const days = Array.isArray(postingDays) && postingDays.length > 0 ? postingDays : [1, 3, 5];
  const times = Array.isArray(postingTimes) && postingTimes.length > 0 ? postingTimes : ['10:00'];
  const tz = timezone || 'UTC';

  const candidateSlots: Date[] = [];
  const nowMs = referenceDate.getTime();

  // Look back 2 hours and forward 7 days to find due or upcoming matching slots
  for (let dayOffset = -1; dayOffset <= 7; dayOffset++) {
    const baseDate = new Date(nowMs + dayOffset * 86400000);

    const dayOfWeek = baseDate.getUTCDay();
    if (!days.includes(dayOfWeek)) {
      continue;
    }

    for (const timeStr of times) {
      const [hStr, mStr] = timeStr.split(':');
      const hour = parseInt(hStr || '10', 10);
      const min = parseInt(mStr || '0', 10);

      const year = baseDate.getUTCFullYear();
      const month = baseDate.getUTCMonth() + 1;
      const day = baseDate.getUTCDate();
      const slotDate = getUtcDateForLocalTime(year, month, day, hour, min, tz);

      candidateSlots.push(slotDate);
    }
  }

  candidateSlots.sort((a, b) => a.getTime() - b.getTime());

  // A slot is "due" if its timestamp is <= NOW and it fell within the last 4 hours
  const dueSlot = candidateSlots
    .filter((s) => s.getTime() <= nowMs && nowMs - s.getTime() <= 4 * 3600000)
    .pop() || null;

  // Next slot is the first slot strictly after NOW (upcoming slot)
  const nextSlot = candidateSlots.find((s) => s.getTime() > nowMs) || new Date(nowMs + 24 * 3600000);

  return { dueSlot, nextSlot };
}

export async function POST(request: NextRequest) {
  try {
    const auth = verifyOperatorOrCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Unauthorized operator' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const targetTenant = body.tenant_id;
    const forceDueNow = Boolean(body.force_due_now);

    // Find active tenants
    let tenantsQuery = `
      SELECT b.tenant_id, s.automation_mode, s.timezone, s.posting_days, s.posting_times,
             s.monthly_generations_used, s.monthly_generation_limit
      FROM iao.businesses b
      JOIN iao.social_brand_settings s ON s.tenant_id = b.tenant_id
      WHERE s.is_automation_paused = false
    `;
    const params: any[] = [];
    if (targetTenant) {
      params.push(targetTenant);
      tenantsQuery += ` AND b.tenant_id = $1`;
    }

    const activeTenants = await query<any>(tenantsQuery, params);
    const preparedPosts: any[] = [];

    for (const t of activeTenants) {
      if (t.monthly_generations_used >= t.monthly_generation_limit) {
        continue;
      }

      const { dueSlot, nextSlot } = calculateRecurringSlots(
        t.timezone,
        t.posting_days,
        t.posting_times,
        new Date()
      );

      // Determine slot to prepare: Autopilot picks upcoming slot so preparation happens before publishing deadline
      const targetSlot = forceDueNow ? (dueSlot || new Date()) : nextSlot;
      const slotDateIso = targetSlot.toISOString();
      const slotKey = `slot_${t.tenant_id}_${slotDateIso.slice(0, 16)}`; // Minute granularity de-duplication

      // Check if this tenant already has a post prepared for this exact slot
      const existingSlotPosts = await query<any>(
        `SELECT id, status FROM iao.social_posts
         WHERE tenant_id = $1 AND (slot_key = $2 OR scheduled_at = $3)
         LIMIT 1`,
        [t.tenant_id, slotKey, targetSlot]
      );

      if (existingSlotPosts.length > 0) {
        // Slot already fulfilled; do not duplicate
        continue;
      }

      try {
        const isPastOrDue = targetSlot.getTime() <= Date.now();
        const genJob = await createSocialGenerationJob(
          t.tenant_id,
          {
            save_as_post: true,
            scheduled_at: targetSlot.toISOString(),
          },
          `autopilot_${slotKey}`,
          'n8n_autopilot'
        );

        const completedJob = await runSocialGenerationPipeline(genJob.id);

        if (completedJob.post_id) {
          // Update slot_key on created post to maintain minute granularity de-duplication
          await query(
            `UPDATE iao.social_posts SET slot_key = $1 WHERE id = $2`,
            [slotKey, completedJob.post_id]
          );

          preparedPosts.push({
            tenant_id: t.tenant_id,
            post_id: completedJob.post_id,
            job_id: completedJob.id,
            slot_key: slotKey,
            scheduled_at: slotDateIso,
            is_due_now: isPastOrDue,
            status: completedJob.status,
            content_angle: completedJob.selected_concept?.content_angle,
          });
        }
      } catch (genErr: any) {
        console.warn(`[Scheduled Gen] Tenant ${t.tenant_id} generation skipped:`, genErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      prepared_count: preparedPosts.length,
      posts: preparedPosts,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Scheduled generation failed' }, { status: 500 });
  }
}
