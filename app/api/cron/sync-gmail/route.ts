import { NextRequest, NextResponse } from 'next/server';
import {
  listActiveGmailTenants,
  getGmailConnection,
  updateGmailSyncStatus,
  ingestGmailMessage,
  syncPendingConversationCases,
} from '@/lib/db';
import {
  listGmailMessages,
  getGmailMessageDetails,
  listGmailHistory,
  getGmailProfile,
} from '@/lib/gmail-service';
import { verifyOperatorOrCronAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function performSyncForTenant(tenantId: string): Promise<{ synced: number; newMsgs: number; status: string }> {
  const { connection, decryptedAccessToken, needsReconnect } = await getGmailConnection(tenantId);
  if (needsReconnect || !connection || !decryptedAccessToken) {
    return { synced: 0, newMsgs: 0, status: needsReconnect ? 'needs_reconnect' : 'not_connected' };
  }

  await updateGmailSyncStatus(tenantId, { status: 'syncing' });
  let newMessagesCount = 0;
  let syncedCount = 0;
  let latestHistoryId = connection.history_id || null;
  const connectedEmail = connection.google_email.toLowerCase();

  try {
    if (!connection.initial_sync_completed || !connection.history_id) {
      const sinceEpoch = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
      let pageToken: string | undefined = undefined;
      let fetchedTotal = 0;

      do {
        const listResult = await listGmailMessages(decryptedAccessToken, {
          query: `after:${sinceEpoch}`,
          maxResults: 50,
          pageToken,
        });

        for (const item of listResult.messages) {
          try {
            syncedCount++;
            const details = await getGmailMessageDetails(decryptedAccessToken, item.id);
            if (!details) continue; // Skip deleted messages
            if (details.senderEmail.toLowerCase() === connectedEmail) continue;

            const ingestion = await ingestGmailMessage(tenantId, details);
            if (ingestion.isNew) newMessagesCount++;
          } catch (itemErr) {
            console.warn(`[Gmail Sync non-fatal message error for ${item.id}]`, itemErr);
          }
        }

        pageToken = listResult.nextPageToken;
        fetchedTotal += listResult.messages.length;
      } while (pageToken && fetchedTotal < 100);

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
      const historyResult = await listGmailHistory(decryptedAccessToken, connection.history_id);
      if (historyResult.expired) {
        const sinceEpoch = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
        let pageToken: string | undefined = undefined;
        let fetchedTotal = 0;

        do {
          const listResult = await listGmailMessages(decryptedAccessToken, {
            query: `after:${sinceEpoch}`,
            maxResults: 50,
            pageToken,
          });

          for (const item of listResult.messages) {
            try {
              syncedCount++;
              const details = await getGmailMessageDetails(decryptedAccessToken, item.id);
              if (!details) continue;
              if (details.senderEmail.toLowerCase() === connectedEmail) continue;

              const ingestion = await ingestGmailMessage(tenantId, details);
              if (ingestion.isNew) newMessagesCount++;
            } catch (itemErr) {
              console.warn(`[Gmail Sync non-fatal message error for ${item.id}]`, itemErr);
            }
          }

          pageToken = listResult.nextPageToken;
          fetchedTotal += listResult.messages.length;
        } while (pageToken && fetchedTotal < 100);

        const profile = await getGmailProfile(decryptedAccessToken);
        latestHistoryId = profile.historyId || latestHistoryId;
      } else {
        latestHistoryId = historyResult.historyId;
        const messageIds = new Set<string>();
        for (const h of historyResult.history) {
          if (h.messagesAdded) {
            for (const a of h.messagesAdded) {
              if (a.message?.id) messageIds.add(a.message.id);
            }
          }
          if (h.messages) {
            for (const m of h.messages) {
              if (m.id) messageIds.add(m.id);
            }
          }
          if (h.labelsAdded) {
            for (const l of h.labelsAdded) {
              if (l.message?.id) messageIds.add(l.message.id);
            }
          }
        }

        for (const msgId of Array.from(messageIds)) {
          try {
            syncedCount++;
            const details = await getGmailMessageDetails(decryptedAccessToken, msgId);
            if (!details) continue; // Skip deleted message
            if (details.senderEmail.toLowerCase() === connectedEmail) continue;

            const ingestion = await ingestGmailMessage(tenantId, details);
            if (ingestion.isNew) newMessagesCount++;
          } catch (msgErr) {
            console.warn(`[Gmail Sync non-fatal msg error for ${msgId}]`, msgErr);
          }
        }
      }

      await updateGmailSyncStatus(tenantId, {
        status: 'idle',
        historyId: latestHistoryId || undefined,
        error: null,
      });
    }

    // Ensure all pending drafts are synchronized with iao.cases
    await syncPendingConversationCases(tenantId);

    return { synced: syncedCount, newMsgs: newMessagesCount, status: 'ok' };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Sync failed';
    await updateGmailSyncStatus(tenantId, { status: 'error', error: errorMsg });
    return { synced: syncedCount, newMsgs: newMessagesCount, status: `error: ${errorMsg}` };
  }
}

export async function GET(request: NextRequest) {
  return handleSync(request);
}

export async function POST(request: NextRequest) {
  return handleSync(request);
}

async function handleSync(request: NextRequest) {
  const auth = verifyOperatorOrCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized: Invalid operator key or cron secret.' },
      { status: 401 }
    );
  }

  const tenants = await listActiveGmailTenants();
  const results: Record<string, unknown> = {};

  for (const tenantId of tenants) {
    const res = await performSyncForTenant(tenantId);
    results[tenantId] = res;
  }

  return NextResponse.json({
    success: true,
    tenants_synced: tenants.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
