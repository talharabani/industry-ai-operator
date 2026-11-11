'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Inbox,
  Send,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  Mail,
  Phone,
  Search,
  RefreshCw,
  Edit3,
  Check,
  X,
  MessageSquare,
  Loader2,
  ArrowLeft,
  Store,
  AlertTriangle,
  RotateCcw,
  Package,
  Truck,
  History,
  UserCheck,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import {
  ConversationRecord,
  MessageRecord,
  ConversationChannel,
  ConversationStatus,
  OrderIssueRecord,
  OrderIssueEventRecord,
  OrderIssueStatus,
} from '@/lib/types';
import { AppLayout } from '@/components/AppLayout';
import { RecordExecutionModal } from '@/components/RecordExecutionModal';

function InboxContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlParamId = searchParams?.get('id') || null;
  const urlParamSelected = searchParams?.get('selected') || null;
  const rawTargetId = (urlParamId || urlParamSelected || '').trim() || null;

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(rawTargetId);
  const [selectedConv, setSelectedConv] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);

  // Linked Order Issue state
  const [linkedIssue, setLinkedIssue] = useState<OrderIssueRecord | null>(null);
  const [issueTimeline, setIssueTimeline] = useState<OrderIssueEventRecord[]>([]);
  const [loadingIssue, setLoadingIssue] = useState(false);
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [updatingIssueStatus, setUpdatingIssueStatus] = useState(false);
  const [executingTask, setExecutingTask] = useState<{
    issueId: string;
    taskId: string;
    taskTitle: string;
    actionType?: string;
    actionDetails?: any;
    customerName?: string;
    orderRef?: string;
  } | null>(null);

  const [filter, setFilter] = useState<'all' | 'needs_attention' | 'replied'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // Stale fetch protection ref
  const activeFetchRef = React.useRef<string | null>(null);

  // Mobile view mode: 'list' | 'thread'
  const [mobileView, setMobileView] = useState<'list' | 'thread'>(rawTargetId ? 'thread' : 'list');

  // Drafting & Composing state
  const [manualReply, setManualReply] = useState('');
  const [generatingDraft, setGeneratingDraft] = useState(false);

  // Edit message in-line
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Active tenant and session
  const [tenantId, setTenantId] = useState('demo-store');
  const [unreadCount, setUnreadCount] = useState(0);

  // 1. Support legacy ?selected= query param: Normalize URL to ?id= and remove ?selected=
  useEffect(() => {
    if (typeof window !== 'undefined' && searchParams?.has('selected')) {
      const currentUrl = new URL(window.location.href);
      const target = currentUrl.searchParams.get('selected') || currentUrl.searchParams.get('id');
      currentUrl.searchParams.delete('selected');
      if (target) {
        currentUrl.searchParams.set('id', target);
      }
      window.history.replaceState({}, '', currentUrl.toString());
    }
  }, [searchParams]);

  // 2. Sync selected conversation ID when URL query parameter changes (direct link, navigation, or back/forward)
  useEffect(() => {
    if (rawTargetId) {
      setSelectedConvId(rawTargetId);
      setMobileView('thread');
    }
  }, [rawTargetId]);

  // 3. Listen to browser popstate (back/forward history navigation)
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const navId = (params.get('id') || params.get('selected') || '').trim() || null;
      if (navId) {
        setSelectedConvId(navId);
        setMobileView('thread');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Fetch thread messages with stale response protection and outside-list merging
  const fetchThread = useCallback(async (convId: string) => {
    if (!convId) return;
    activeFetchRef.current = convId;
    setLoadingThread(true);
    setThreadError(null);

    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(convId)}`, { cache: 'no-store' });
      // Stale response guard: if user selected another thread while this fetch was in-flight, discard result
      if (activeFetchRef.current !== convId) return;

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 404) {
          throw new Error(`Conversation not found. The requested thread (${convId}) does not exist or has been removed.`);
        }
        throw new Error(errData.error || `Failed to load conversation (${res.status})`);
      }
      const data = await res.json();
      // Stale response guard
      if (activeFetchRef.current !== convId) return;

      const loadedConv: ConversationRecord | null = data.conversation || null;
      setSelectedConv(loadedConv);
      setMessages(data.messages || []);

      // If this conversation was not in the current list (e.g. outside filter or search), merge it into list
      if (loadedConv) {
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === loadedConv.id);
          if (exists) {
            return prev.map((c) => (c.id === loadedConv.id ? { ...c, ...loadedConv, unread: false } : c));
          } else {
            return [loadedConv, ...prev];
          }
        });
      }
    } catch (err: unknown) {
      if (activeFetchRef.current !== convId) return;
      const msg = err instanceof Error ? err.message : 'Failed to load thread messages';
      console.error('[Fetch thread error]', msg);
      setThreadError(msg);
      setSelectedConv(null);
      setMessages([]);
    } finally {
      if (activeFetchRef.current === convId) {
        setLoadingThread(false);
      }
    }
  }, []);

  // Fetch linked order issue and timeline events
  const fetchLinkedIssue = useCallback(async (convId: string) => {
    if (!convId) {
      setLinkedIssue(null);
      setIssueTimeline([]);
      return;
    }
    try {
      setLoadingIssue(true);
      const res = await fetch(`/api/order-issues?conversation_id=${encodeURIComponent(convId)}`, { cache: 'no-store' });
      if (!res.ok) {
        setLinkedIssue(null);
        setIssueTimeline([]);
        return;
      }
      const data = await res.json();
      const issue: OrderIssueRecord | null = data.issues?.[0] || null;
      setLinkedIssue(issue);

      if (issue) {
        const detailRes = await fetch(`/api/order-issues/${issue.id}`, { cache: 'no-store' });
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          setIssueTimeline(detailData.events || []);
        }
      } else {
        setIssueTimeline([]);
      }
    } catch (err) {
      console.error('[Fetch linked issue error]', err);
      setLinkedIssue(null);
      setIssueTimeline([]);
    } finally {
      setLoadingIssue(false);
    }
  }, []);

  // Fetch conversation list
  const fetchConversations = useCallback(async (selectId?: string) => {
    try {
      setLoadingList(true);
      const params = new URLSearchParams();
      if (filter === 'needs_attention') {
        params.set('status', 'pending_approval');
      } else if (filter === 'replied') {
        params.set('status', 'resolved');
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/inbox?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load conversations');
      const data = await res.json();

      const convList: ConversationRecord[] = data.conversations || [];
      setConversations(convList);
      setUnreadCount(data.unread_count || 0);
      if (data.tenant_id) setTenantId(data.tenant_id);

      // Select conversation: Honor explicit URL target ID or current selection, NEVER overwrite explicit ID
      setSelectedConvId((currentSelected) => {
        const targetId = selectId || currentSelected || rawTargetId;
        if (targetId) {
          return targetId;
        }
        return convList.length > 0 ? convList[0].id : null;
      });
    } catch (err) {
      console.error('[Fetch conversations error]', err);
    } finally {
      setLoadingList(false);
    }
  }, [filter, searchQuery, rawTargetId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (selectedConvId) {
      fetchThread(selectedConvId);
      fetchLinkedIssue(selectedConvId);
      // Keep URL search params in sync to preserve selection across refresh
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.get('id') !== selectedConvId || url.searchParams.has('selected')) {
          url.searchParams.delete('selected');
          url.searchParams.set('id', selectedConvId);
          window.history.replaceState({}, '', url.toString());
        }
      }
    } else {
      setSelectedConv(null);
      setMessages([]);
      setLinkedIssue(null);
      setIssueTimeline([]);
    }
  }, [selectedConvId, fetchThread, fetchLinkedIssue]);

  const handleSelectConversation = (id: string) => {
    if (id === selectedConvId && selectedConv) {
      setMobileView('thread');
      return;
    }
    setSelectedConvId(id);
    setMobileView('thread');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('selected');
      url.searchParams.set('id', id);
      window.history.pushState({}, '', url.toString());
    }
  };

  // Handle AI draft generation
  const handleGenerateDraft = async () => {
    if (!selectedConvId) return;
    setGeneratingDraft(true);
    setFeedbackNotice(null);

    try {
      const res = await fetch(`/api/inbox/${selectedConvId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate AI draft');

      setFeedbackNotice({
        type: 'success',
        text: 'AI reply drafted based on store policies. Review and approve before sending.',
      });
      await fetchThread(selectedConvId);
      await fetchConversations(selectedConvId);
    } catch (err: unknown) {
      setFeedbackNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Draft generation failed',
      });
    } finally {
      setGeneratingDraft(false);
    }
  };

  // Handle manual reply submission
  const handleSendManualReply = async () => {
    if (!selectedConvId || !manualReply.trim()) return;
    setActionLoading('manual_reply');
    setFeedbackNotice(null);

    try {
      const res = await fetch(`/api/inbox/${selectedConvId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: manualReply.trim(),
          is_approved: true, // Manual direct reply from owner
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create reply');

      setManualReply('');
      setFeedbackNotice({
        type: 'success',
        text: 'Reply recorded and added to thread.',
      });
      await fetchThread(selectedConvId);
      await fetchConversations(selectedConvId);
    } catch (err: unknown) {
      setFeedbackNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Reply creation failed',
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle draft approval
  const handleApproveMessage = async (msgId: string, decision: 'approved' | 'rejected') => {
    if (!selectedConvId) return;
    setActionLoading(`approve_${msgId}`);
    setFeedbackNotice(null);

    try {
      const res = await fetch(`/api/inbox/${selectedConvId}/messages/${msgId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval failed');

      if (decision === 'approved') {
        // Automatically dispatch upon approval
        await handleSendMessage(msgId);
      } else {
        setFeedbackNotice({
          type: 'info',
          text: 'Draft rejected.',
        });
        await fetchThread(selectedConvId);
      }
    } catch (err: unknown) {
      setFeedbackNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to process approval',
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle message sending (email dispatch / simulated demo)
  const handleSendMessage = async (msgId: string) => {
    if (!selectedConvId) return;
    setActionLoading(`send_${msgId}`);
    setFeedbackNotice(null);

    try {
      const res = await fetch(`/api/inbox/${selectedConvId}/messages/${msgId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dispatch failed');

      setFeedbackNotice({
        type: data.is_simulated ? 'info' : 'success',
        text: data.notice || (data.is_simulated ? 'Sent in Simulation Demo mode.' : 'Sent to customer via Gmail.'),
      });
      await fetchThread(selectedConvId);
      await fetchConversations(selectedConvId);
    } catch (err: unknown) {
      setFeedbackNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Message dispatch failed',
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle editing message body
  const handleSaveMessageEdit = async (msgId: string) => {
    if (!selectedConvId || !editingText.trim()) return;
    setActionLoading(`edit_${msgId}`);

    try {
      const res = await fetch(`/api/inbox/${selectedConvId}/messages/${msgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editingText.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save changes');

      setEditingMessageId(null);
      setEditingText('');
      setFeedbackNotice({
        type: 'info',
        text: 'Draft updated. Review and approve to send.',
      });
      await fetchThread(selectedConvId);
    } catch (err: unknown) {
      setFeedbackNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Edit failed',
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle order issue status update
  const handleUpdateIssueStatus = async (newStatus: OrderIssueStatus) => {
    if (!linkedIssue) return;
    setUpdatingIssueStatus(true);
    setFeedbackNotice(null);

    try {
      const res = await fetch(`/api/order-issues/${linkedIssue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          actor_type: 'owner',
          summary: `Status manually updated to ${newStatus} from Inbox`,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update issue status');

      setFeedbackNotice({
        type: 'success',
        text: `Order issue status updated to "${newStatus.replace('_', ' ')}".`,
      });

      if (selectedConvId) {
        await fetchLinkedIssue(selectedConvId);
      }
    } catch (err: unknown) {
      setFeedbackNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update issue status',
      });
    } finally {
      setUpdatingIssueStatus(false);
    }
  };

  // Handle status update
  const handleStatusChange = async (newStatus: ConversationStatus) => {
    if (!selectedConvId) return;
    try {
      await fetch(`/api/inbox/${selectedConvId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchThread(selectedConvId);
      await fetchConversations(selectedConvId);
    } catch (err) {
      console.error('Failed to change status:', err);
    }
  };

  const formatIssueType = (type: string) => {
    switch (type) {
      case 'delivery_delay':
        return 'Delivery Delay';
      case 'not_received':
        return 'Parcel Not Received';
      case 'damaged_item':
        return 'Damaged Item';
      case 'wrong_item':
        return 'Wrong Item Sent';
      case 'refund_request':
        return 'Refund Request';
      case 'exchange_request':
        return 'Exchange Request';
      case 'cancellation_request':
        return 'Cancellation Request';
      default:
        return 'General Order Issue';
    }
  };

  const getIssueStatusBadge = (status: OrderIssueStatus) => {
    switch (status) {
      case 'open':
        return { label: 'Open', bg: 'bg-slate-100 text-slate-700 border-slate-300' };
      case 'investigating':
        return { label: 'Investigating', bg: 'bg-blue-100 text-blue-800 border-blue-300' };
      case 'awaiting_customer':
        return { label: 'Awaiting Customer', bg: 'bg-amber-100 text-amber-800 border-amber-300' };
      case 'awaiting_owner':
        return { label: 'Awaiting Owner', bg: 'bg-purple-100 text-purple-800 border-purple-300' };
      case 'action_pending':
        return { label: 'Approved — awaiting execution', bg: 'bg-violet-100 text-violet-800 border-violet-300 font-bold' };
      case 'resolved':
        return { label: 'Resolved', bg: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'closed':
        return { label: 'Closed', bg: 'bg-slate-100 text-slate-500 border-slate-300' };
      default:
        return { label: status, bg: 'bg-slate-100 text-slate-700 border-slate-300' };
    }
  };

  const formatTimestamp = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <AppLayout
      onRefresh={() => {
        fetchConversations(selectedConvId || undefined);
        if (selectedConvId) fetchThread(selectedConvId);
      }}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden h-[calc(100vh-8.5rem)] min-h-[580px] flex flex-col">
        {/* Top Feedback Notice */}
        {feedbackNotice && (
          <div
            className={`px-4 py-2.5 text-xs font-medium flex items-center justify-between gap-3 border-b ${
              feedbackNotice.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : feedbackNotice.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-indigo-50 text-indigo-800 border-indigo-200'
            }`}
          >
            <span>{feedbackNotice.text}</span>
            <button
              onClick={() => setFeedbackNotice(null)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* LEFT PANE: Conversation List */}
          <div
            className={`w-full md:w-80 lg:w-96 border-r border-slate-200 flex flex-col bg-slate-50/50 shrink-0 ${
              mobileView === 'thread' ? 'hidden md:flex' : 'flex'
            }`}
          >
            {/* Search & Filters */}
            <div className="p-3.5 border-b border-slate-200 bg-white space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search messages, names, emails..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900"
                />
              </div>

              {/* 3 Simple Filters: All, Needs attention, Replied */}
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`flex-1 py-1 px-2 text-center rounded-lg font-medium transition-colors cursor-pointer ${
                    filter === 'all'
                      ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('needs_attention')}
                  className={`flex-1 py-1 px-2 text-center rounded-lg font-medium transition-colors cursor-pointer ${
                    filter === 'needs_attention'
                      ? 'bg-amber-600 text-white font-semibold shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Needs Attention
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('replied')}
                  className={`flex-1 py-1 px-2 text-center rounded-lg font-medium transition-colors cursor-pointer ${
                    filter === 'replied'
                      ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Replied
                </button>
              </div>
            </div>

            {/* Conversation Items */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loadingList && conversations.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                  <span>Loading conversations...</span>
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-8 text-center space-y-2 text-slate-500 text-xs">
                  <Inbox className="w-8 h-8 mx-auto text-slate-400" />
                  <p className="font-semibold text-slate-700">No conversations found</p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Incoming emails and customer inquiries will appear here automatically.
                  </p>
                </div>
              ) : (
                conversations.map((conv) => {
                  const isSelected = selectedConvId === conv.id;
                  const isPending = conv.status === 'pending_approval';

                  return (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv.id)}
                      className={`p-3.5 text-left cursor-pointer transition-colors relative border-l-4 ${
                        isSelected
                          ? 'bg-white border-l-indigo-600 shadow-xs'
                          : 'hover:bg-slate-100/70 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {conv.unread && (
                            <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
                          )}
                          <span
                            className={`text-xs font-bold truncate ${
                              conv.unread ? 'text-slate-900' : 'text-slate-700'
                            }`}
                          >
                            {conv.customer_name}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {formatTimestamp(conv.last_message_at)}
                        </span>
                      </div>

                      <div className="text-xs font-medium text-slate-800 truncate mb-1">
                        {conv.subject || 'Customer Inquiry'}
                      </div>

                      <div className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed mb-2">
                        {conv.last_message_body || 'No message content available.'}
                      </div>

                      <div className="flex items-center justify-between gap-1 text-[10px]">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                          {conv.channel === 'gmail' ? 'Gmail' : 'Hosted Form'}
                        </span>
                        {isPending ? (
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold border border-amber-200">
                            Approval Needed
                          </span>
                        ) : conv.status === 'resolved' ? (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-medium">
                            Replied
                          </span>
                        ) : conv.status === 'ignored' ? (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-medium">
                            Ignored (Notification)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                            Open
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT PANE: Chat / Thread View */}
          <div
            className={`flex-1 flex flex-col bg-white overflow-hidden ${
              mobileView === 'list' ? 'hidden md:flex' : 'flex'
            }`}
          >
            {loadingThread && !selectedConv ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
                <div className="text-sm font-semibold text-slate-700">Loading Conversation...</div>
                <p className="text-xs text-slate-400 max-w-sm">
                  Fetching messages and approval details from the store database.
                </p>
              </div>
            ) : threadError && !selectedConv ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="text-sm font-semibold text-slate-900">Failed to Load Conversation</div>
                <p className="text-xs text-rose-600 max-w-sm font-medium">{threadError}</p>
                {selectedConvId && (
                  <button
                    type="button"
                    onClick={() => fetchThread(selectedConvId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Loading</span>
                  </button>
                )}
              </div>
            ) : selectedConv ? (
              <>
                {/* Thread Header */}
                <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => setMobileView('list')}
                      className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-slate-100 text-slate-600"
                      aria-label="Back to conversations"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-bold text-slate-900 truncate">
                          {selectedConv.customer_name}
                        </h2>
                        <span className="text-xs text-slate-500 font-normal truncate">
                          ({selectedConv.customer_email})
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 truncate font-medium">
                        Subject: {selectedConv.subject || 'Customer Inquiry'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {selectedConv.status !== 'resolved' ? (
                      <button
                        type="button"
                        onClick={() => handleStatusChange('resolved')}
                        className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors cursor-pointer"
                      >
                        Mark Replied
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStatusChange('open')}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>

                {/* Linked Order Issue Resolution Banner */}
                {linkedIssue && (
                  <div className="bg-slate-50/90 border-b border-slate-200 px-4 py-3 shrink-0 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {linkedIssue.issue_type.includes('delivery') || linkedIssue.issue_type.includes('received') ? (
                            <Truck className="w-3.5 h-3.5" />
                          ) : linkedIssue.issue_type.includes('refund') || linkedIssue.issue_type.includes('exchange') ? (
                            <RotateCcw className="w-3.5 h-3.5" />
                          ) : (
                            <Package className="w-3.5 h-3.5" />
                          )}
                          <span>{formatIssueType(linkedIssue.issue_type)}</span>
                        </span>

                        {/* Lifecycle Status */}
                        {(() => {
                          const badge = getIssueStatusBadge(linkedIssue.status);
                          return (
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${badge.bg}`}>
                              {badge.label}
                            </span>
                          );
                        })()}

                        {/* Verified Order badge */}
                        {linkedIssue.order_id && !linkedIssue.evidence?.privacy_blocked ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Order #{linkedIssue.order_id} Verified</span>
                          </span>
                        ) : linkedIssue.evidence?.privacy_blocked ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            <ShieldCheck className="w-3 h-3 text-amber-600" />
                            <span>Order Ref (Email Mismatch - Ownership Blocked)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            <AlertCircle className="w-3 h-3 text-amber-600" />
                            <span>Missing Order Details</span>
                          </span>
                        )}

                        {/* Fulfillment / Carrier tracking tag */}
                        {linkedIssue.evidence?.tracking_number ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-200/70 text-slate-700">
                            {linkedIssue.evidence.carrier || 'Carrier'}: {linkedIssue.evidence.tracking_number}
                          </span>
                        ) : linkedIssue.evidence?.fulfillment_status === 'unfulfilled' ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">
                            Unfulfilled in warehouse
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowTimelineModal(true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5 text-slate-500" />
                          <span>Audit Trail ({issueTimeline.length})</span>
                        </button>

                        {linkedIssue.status !== 'resolved' && linkedIssue.status !== 'closed' ? (
                          <>
                            {linkedIssue.status !== 'awaiting_owner' && (
                              <button
                                type="button"
                                disabled={updatingIssueStatus}
                                onClick={() => handleUpdateIssueStatus('awaiting_owner')}
                                className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                              >
                                Escalate to Owner
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={updatingIssueStatus}
                              onClick={() => handleUpdateIssueStatus('resolved')}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                            >
                              Resolve Issue
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={updatingIssueStatus}
                            onClick={() => handleUpdateIssueStatus('investigating')}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Reopen Case
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pt-1 border-t border-slate-200/60">
                      <div className="flex items-center gap-1.5 truncate max-w-xl">
                        <span className="font-semibold text-slate-700">Next Action:</span>
                        <span className="truncate text-slate-600">{linkedIssue.next_action || 'None scheduled'}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-500">
                          Responsible:{' '}
                          <strong className="text-slate-700">
                            {linkedIssue.responsible_party === 'owner'
                              ? 'Merchant Owner'
                              : linkedIssue.responsible_party === 'ai_operator'
                              ? 'AI Operator'
                              : 'Customer'}
                          </strong>
                        </span>
                        {linkedIssue.evidence?.investigation_notes && (
                          <span
                            className="text-[11px] text-slate-500 italic max-w-xs truncate"
                            title={linkedIssue.evidence.investigation_notes}
                          >
                            • Note: {linkedIssue.evidence.investigation_notes}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Owner Action & Manual Execution Tasks */}
                    {linkedIssue.evidence?.owner_tasks && linkedIssue.evidence.owner_tasks.length > 0 && (
                      <div className="pt-2 border-t border-slate-200/60 space-y-2">
                        {linkedIssue.evidence.owner_tasks.map((task) => {
                          const isPendingExecution = task.status === 'pending';
                          return (
                            <div
                              key={task.id}
                              className={`p-2.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
                                isPendingExecution
                                  ? 'bg-violet-50/60 border-violet-200 text-violet-950'
                                  : 'bg-white border-slate-200 text-slate-700'
                              }`}
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  {isPendingExecution ? (
                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-violet-100 text-violet-800 border border-violet-300">
                                      Approved — awaiting execution
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      {task.completion_label || 'Owner-reported completion'}
                                    </span>
                                  )}

                                  {task.action_details?.amount && (
                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      Refund: {task.action_details.amount} {task.action_details.currency || 'USD'}
                                    </span>
                                  )}

                                  <span className="font-semibold text-slate-900">{task.title}</span>
                                </div>

                                {task.status === 'completed' && (
                                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                                    {task.execution_reference && (
                                      <span>Evidence/Ref: <strong>{task.execution_reference}</strong></span>
                                    )}
                                    {task.completed_by && (
                                      <span>• Recorded by: {task.completed_by}</span>
                                    )}
                                    {task.completed_at && (
                                      <span>• {formatTimestamp(task.completed_at)}</span>
                                    )}
                                  </div>
                                )}
                              </div>

                              {isPendingExecution && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExecutingTask({
                                      issueId: linkedIssue.id,
                                      taskId: task.id,
                                      taskTitle: task.title,
                                      actionType: task.action_type,
                                      actionDetails: task.action_details,
                                      customerName: linkedIssue.customer_name,
                                      orderRef: linkedIssue.order_id || undefined,
                                    })
                                  }
                                  className="px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
                                >
                                  Record Manual Execution
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Messages Stream */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/40">
                  {loadingThread ? (
                    <div className="p-12 text-center text-xs text-slate-400 space-y-2">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                      <span>Loading conversation history...</span>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isCustomer = msg.sender_type === 'customer';
                      const isAiDraft = msg.sender_type === 'ai_draft';
                      const isEditing = editingMessageId === msg.id;
                      const isPendingApproval = msg.approval_status === 'pending_approval';
                      const isDispatched = ['sent', 'provider_accepted', 'simulated_demo'].includes(msg.status);
                      const isAutoDispatched = Boolean(msg.metadata?.auto_dispatched);
                      const isSendFailed = msg.status === 'failed';

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${
                            isCustomer ? 'items-start' : 'items-end'
                          }`}
                        >
                          {/* Sender meta */}
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1 px-1">
                            <span className="font-semibold text-slate-700">
                              {isCustomer
                                ? `${msg.sender_name} (Customer)`
                                : isAiDraft
                                ? 'AI Draft'
                                : `${msg.sender_name} (Owner/Assistant)`}
                            </span>
                            <span>•</span>
                            <span>{formatTimestamp(msg.created_at)}</span>

                            {/* Clear Message State Badges */}
                            {isAutoDispatched && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                                Sent Automatically
                              </span>
                            )}
                            {msg.status === 'simulated_demo' && !isAutoDispatched && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                Demo simulation
                              </span>
                            )}
                            {msg.status === 'provider_accepted' && !isAutoDispatched && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                Sent via Gmail
                              </span>
                            )}
                            {isSendFailed && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                Send Failed
                              </span>
                            )}
                          </div>

                          {/* Message Bubble */}
                          <div
                            className={`max-w-xl p-4 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                              isCustomer
                                ? 'bg-white border border-slate-200 text-slate-900 shadow-xs'
                                : isPendingApproval
                                ? 'bg-amber-50/90 border-2 border-amber-300 text-amber-950 shadow-xs'
                                : isSendFailed
                                ? 'bg-rose-50 border border-rose-300 text-rose-950'
                                : isAutoDispatched
                                ? 'bg-emerald-50/80 border border-emerald-200 text-slate-900'
                                : 'bg-indigo-600 text-white shadow-xs'
                            }`}
                          >
                            {isEditing ? (
                              <div className="space-y-3">
                                <textarea
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  rows={4}
                                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingMessageId(null)}
                                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveMessageEdit(msg.id)}
                                    disabled={actionLoading === `edit_${msg.id}`}
                                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-semibold shadow-xs cursor-pointer"
                                  >
                                    Save Changes
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap">{msg.body}</div>
                            )}

                            {/* Pending Approval Action Controls (ONLY for unapproved drafts) */}
                            {isPendingApproval && !isDispatched && !isEditing && (
                              <div className="mt-4 pt-3 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                                  <span>Approval Required</span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageId(msg.id);
                                      setEditingText(msg.body);
                                    }}
                                    className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                                  >
                                    <Edit3 className="w-3 h-3 inline mr-1" />
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleApproveMessage(msg.id, 'rejected')}
                                    disabled={actionLoading === `approve_${msg.id}`}
                                    className="px-2.5 py-1 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleApproveMessage(msg.id, 'approved')}
                                    disabled={actionLoading === `approve_${msg.id}` || actionLoading === `send_${msg.id}`}
                                    className="px-3 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Approve & Send</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Reply Composer Bottom Bar */}
                <div className="p-3 sm:p-4 bg-white border-t border-slate-200 space-y-2.5 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">Write a Reply</span>
                    <button
                      type="button"
                      onClick={handleGenerateDraft}
                      disabled={generatingDraft}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      <span>{generatingDraft ? 'Drafting AI reply...' : 'Draft AI Reply'}</span>
                    </button>
                  </div>

                  <div className="flex items-end gap-2">
                    <textarea
                      value={manualReply}
                      onChange={(e) => setManualReply(e.target.value)}
                      placeholder="Type your response to the customer..."
                      rows={2}
                      className="flex-1 p-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 resize-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          handleSendManualReply();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSendManualReply}
                      disabled={!manualReply.trim() || actionLoading === 'manual_reply'}
                      className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5 h-full"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Send</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div className="text-sm font-semibold text-slate-700">No Conversation Selected</div>
                <p className="text-xs text-slate-400 max-w-sm">
                  Select a customer thread from the left to view messages, draft responses, and authorize pending actions.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline & Audit Trail Modal */}
      {showTimelineModal && linkedIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Audit Trail • {formatIssueType(linkedIssue.issue_type)}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {linkedIssue.order_id ? `Order #${linkedIssue.order_id}` : 'Unlinked Order'} • {linkedIssue.customer_name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTimelineModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - Chronological Events */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 bg-slate-50/30">
              {issueTimeline.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No chronological events recorded yet.
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {issueTimeline.map((ev) => {
                    const actorBadge =
                      ev.actor_type === 'ai_operator'
                        ? { label: 'AI Operator', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
                        : ev.actor_type === 'owner'
                        ? { label: 'Store Owner', color: 'bg-purple-50 text-purple-700 border-purple-200' }
                        : ev.actor_type === 'customer'
                        ? { label: 'Customer', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                        : { label: 'System', color: 'bg-slate-100 text-slate-700 border-slate-200' };

                    return (
                      <div key={ev.id} className="relative group">
                        {/* Timeline node dot */}
                        <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-white border-2 border-indigo-600 shadow-2xs" />
                        
                        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${actorBadge.color}`}>
                                {actorBadge.label}
                              </span>
                              <span className="font-bold text-slate-900 capitalize">
                                {ev.event_type.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {formatTimestamp(ev.created_at)}
                            </span>
                          </div>

                          {ev.summary && (
                            <p className="text-xs text-slate-700 leading-relaxed">{ev.summary}</p>
                          )}

                          {/* State transition diff */}
                          {(ev.from_status || ev.to_status) && (
                            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-slate-50 px-2 py-1 rounded-md border border-slate-200 text-slate-600">
                              <span>{ev.from_status || 'initial'}</span>
                              <span>→</span>
                              <strong className="text-slate-900">{ev.to_status}</strong>
                            </div>
                          )}

                          {/* Event details snapshot */}
                          {ev.details && Object.keys(ev.details).length > 0 && (
                            <details className="text-[11px] text-slate-500 pt-1">
                              <summary className="cursor-pointer font-medium hover:text-slate-700">
                                Event payload details
                              </summary>
                              <pre className="mt-1 p-2 bg-slate-50 rounded-lg text-[10px] overflow-x-auto text-slate-700 font-mono">
                                {JSON.stringify(ev.details, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50/50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTimelineModal(false)}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Manual Execution Modal */}
      {executingTask && (
        <RecordExecutionModal
          isOpen={true}
          issueId={executingTask.issueId}
          taskId={executingTask.taskId}
          taskTitle={executingTask.taskTitle}
          actionType={executingTask.actionType}
          actionDetails={executingTask.actionDetails}
          customerName={executingTask.customerName}
          orderRef={executingTask.orderRef}
          onClose={() => setExecutingTask(null)}
          onSuccess={() => {
            setExecutingTask(null);
            if (selectedConvId) {
              fetchLinkedIssue(selectedConvId);
              fetchThread(selectedConvId);
            }
          }}
        />
      )}
    </AppLayout>
  );
}

export default function InboxPage() {
  return (
    <React.Suspense fallback={<div className="p-12 text-center text-xs text-slate-400">Loading inbox...</div>}>
      <InboxContent />
    </React.Suspense>
  );
}
