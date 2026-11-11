import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import {
  getGmailConnection,
  updateGmailSyncStatus,
  ingestGmailMessage,
} from '@/lib/db';
import {
  listGmailMessages,
  getGmailMessageDetails,
  listGmailHistory,
  getGmailProfile,
} from '@/lib/gmail-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    const { connection, decryptedAccessToken, needsReconnect } = await getGmailConnection(tenantId);

    if (needsReconnect) {
      await updateGmailSyncStatus(tenantId, {
        status: 'needs_reconnect',
        error: 'Google authorization revoked. Reconnection required.',
      });
      return NextResponse.json(
        {
          error: 'Google account authorization has been revoked or expired. Please reconnect in Settings > Connections.',
          needs_reconnect: true,
        },
        { status: 400 }
      );
    }

    if (!connection || !decryptedAccessToken) {
      return NextResponse.json(
        { error: 'No Gmail account connected for this business. Please connect Gmail in Settings.' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const importRecentHistory = body.import_recent_history === true;

    // Mark status as syncing
    await updateGmailSyncStatus(tenantId, { status: 'syncing' });

    let newMessagesCount = 0;
    let syncedCount = 0;
    let latestHistoryId = connection.history_id || null;

    try {
      const connectedEmail = connection.google_email.toLowerCase();

      if (!connection.initial_sync_completed || importRecentHistory || !connection.history_id) {
        // Initial sync or explicit recent history import (bounded to last 7 days or after connection date, max 20 messages)
        const daysBack = importRecentHistory ? 7 : 2;
        const sinceEpoch = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);
        const query = `after:${sinceEpoch}`;

        const listResult = await listGmailMessages(decryptedAccessToken, {
          query,
          maxResults: 20,
        });

        for (const item of listResult.messages) {
          syncedCount++;
          const details = await getGmailMessageDetails(decryptedAccessToken, item.id);
          if (!details) continue;

          // Skip messages sent from this Gmail account itself to avoid self-reply loop
          if (details.senderEmail.toLowerCase() === connectedEmail) {
            continue;
          }

          const ingestion = await ingestGmailMessage(tenantId, details);
          if (ingestion.isNew) {
            newMessagesCount++;
          }
        }

        // Fetch fresh history cursor
        try {
          const profile = await getGmailProfile(decryptedAccessToken);
          latestHistoryId = profile.historyId || latestHistoryId;
        } catch {
          // ignore
        }

        await updateGmailSyncStatus(tenantId, {
          status: 'idle',
          historyId: latestHistoryId || undefined,
          initialSyncCompleted: true,
          error: null,
        });
      } else {
        // Incremental sync using Gmail history API
        const historyResult = await listGmailHistory(decryptedAccessToken, connection.history_id);

        if (historyResult.expired) {
          // Expired historyId recovery: query messages received in last 2 days without losing messages
          const sinceEpoch = Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000);
          const listResult = await listGmailMessages(decryptedAccessToken, {
            query: `after:${sinceEpoch}`,
            maxResults: 25,
          });

          for (const item of listResult.messages) {
            syncedCount++;
            const details = await getGmailMessageDetails(decryptedAccessToken, item.id);
            if (!details) continue;
            if (details.senderEmail.toLowerCase() === connectedEmail) continue;

            const ingestion = await ingestGmailMessage(tenantId, details);
            if (ingestion.isNew) newMessagesCount++;
          }

          const profile = await getGmailProfile(decryptedAccessToken);
          latestHistoryId = profile.historyId || latestHistoryId;
        } else {
          latestHistoryId = historyResult.historyId;
          const messageIdsToFetch = new Set<string>();

          for (const h of historyResult.history) {
            if (h.messagesAdded) {
              for (const added of h.messagesAdded) {
                if (added.message?.id) {
                  messageIdsToFetch.add(added.message.id);
                }
              }
            }
          }

          for (const msgId of Array.from(messageIdsToFetch)) {
            syncedCount++;
            const details = await getGmailMessageDetails(decryptedAccessToken, msgId);
            if (!details) continue;
            if (details.senderEmail.toLowerCase() === connectedEmail) continue;

            const ingestion = await ingestGmailMessage(tenantId, details);
            if (ingestion.isNew) newMessagesCount++;
          }
        }

        await updateGmailSyncStatus(tenantId, {
          status: 'idle',
          historyId: latestHistoryId || undefined,
          error: null,
        });
      }

      return NextResponse.json({
        success: true,
        tenant_id: tenantId,
        synced_count: syncedCount,
        new_messages_count: newMessagesCount,
        history_id: latestHistoryId,
        last_synced_at: new Date().toISOString(),
      });
    } catch (syncError: unknown) {
      console.error('[Gmail Sync Error]', syncError);
      const errMessage = syncError instanceof Error ? syncError.message : 'Sync failed';
      await updateGmailSyncStatus(tenantId, {
        status: 'error',
        error: errMessage,
      });

      return NextResponse.json(
        {
          error: `Gmail sync encountered an error: ${errMessage}`,
          status: 'error',
        },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Sync request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
