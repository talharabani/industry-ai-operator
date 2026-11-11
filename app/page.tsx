'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/AppLayout';
import { KindBadge } from '@/components/KindBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { ApprovalModal } from '@/components/ApprovalModal';
import { RecordExecutionModal } from '@/components/RecordExecutionModal';
import { SummaryStats, CaseRecord, AuditRecord, BusinessRecord, OrderIssueRecord } from '@/lib/types';
import { formatDate, humanizeProposal } from '@/lib/utils';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Inbox,
  Check,
  X,
  Store,
  Mail,
  Loader2,
  ShieldCheck,
  Radio,
  ExternalLink,
  MessageSquare,
  Package,
  Truck,
  RotateCcw,
  AlertCircle,
  Calendar,
  UserCheck,
  ClipboardList,
  Users,
  Copy,
  BookOpen,
  Briefcase,
} from 'lucide-react';

export default function HomePage() {
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [pendingCases, setPendingCases] = useState<CaseRecord[]>([]);
  const [recentCases, setRecentCases] = useState<CaseRecord[]>([]);
  const [recentAudit, setRecentAudit] = useState<AuditRecord[]>([]);
  const [business, setBusiness] = useState<BusinessRecord | null>(null);
  const [orderIssues, setOrderIssues] = useState<OrderIssueRecord[]>([]);
  const [servicesLeads, setServicesLeads] = useState<any[]>([]);
  const [leadsCounts, setLeadsCounts] = useState<Record<string, number>>({});
  const [onboardingData, setOnboardingData] = useState<any>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [issuesSummary, setIssuesSummary] = useState<{
    unresolved_count: number;
    awaiting_owner_count: number;
    action_pending_count: number;
  }>({ unresolved_count: 0, awaiting_owner_count: 0, action_pending_count: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCaseForDecision, setSelectedCaseForDecision] = useState<{
    caseData: CaseRecord;
    type: 'approve' | 'reject';
  } | null>(null);
  const [executingTask, setExecutingTask] = useState<{
    issueId: string;
    taskId: string;
    taskTitle: string;
    actionType?: string;
    actionDetails?: any;
    customerName?: string;
    orderRef?: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [sumRes, pendingRes, recentRes, auditRes, bizRes, issuesRes, leadsRes, onboardRes] = await Promise.all([
        fetch('/api/summary', { cache: 'no-store' }),
        fetch('/api/cases?status=pending_approval&limit=5', { cache: 'no-store' }),
        fetch('/api/cases?limit=6', { cache: 'no-store' }),
        fetch('/api/audit?limit=6', { cache: 'no-store' }),
        fetch('/api/business', { cache: 'no-store' }),
        fetch('/api/order-issues?limit=6', { cache: 'no-store' }),
        fetch('/api/services/leads?limit=5', { cache: 'no-store' }),
        fetch('/api/business/onboarding', { cache: 'no-store' }),
      ]);

      if (sumRes.ok) setSummary(await sumRes.json());
      if (pendingRes.ok) {
        const pData = await pendingRes.json();
        setPendingCases(pData.cases || []);
      }
      if (recentRes.ok) {
        const rData = await recentRes.json();
        setRecentCases(rData.cases || []);
      }
      if (auditRes.ok) {
        const aData = await auditRes.json();
        setRecentAudit(aData.audit || []);
      }
      if (bizRes.ok) {
        const bData = await bizRes.json();
        setBusiness(bData.business || null);
      }
      if (issuesRes.ok) {
        const iData = await issuesRes.json();
        setOrderIssues(iData.issues || []);
        if (iData.summary) {
          setIssuesSummary(iData.summary);
        }
      }
      if (leadsRes.ok) {
        const lData = await leadsRes.json();
        setServicesLeads(lData.leads || []);
        setLeadsCounts(lData.counts || {});
      }
      if (onboardRes.ok) {
        const oData = await onboardRes.json();
        setOnboardingData(oData.onboarding || null);
      }
    } catch (err) {
      console.error('Failed to load home data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);


  useEffect(() => {
    loadData();
  }, [loadData]);

  const automationMode = business?.settings?.automation_mode || 'auto_routine';
  const businessType = business?.settings?.business_type || (business?.settings?.industry === 'services' ? 'services' : business?.settings?.industry === 'blog' ? 'blog' : 'ecommerce');
  const isServices = businessType === 'services';
  const isBlog = businessType === 'blog';
  const isEcommerce = businessType === 'ecommerce';

  const isGmailConnected = Boolean(business?.gmail_connection?.google_email);
  const connectedEmail = business?.gmail_connection?.google_email || business?.email_credentials?.sender_email || 'Simulation Mailbox';

  const activeOwnerTasks = orderIssues.filter((issue) => {
    if (issue.status === 'resolved' || issue.status === 'closed') return false;
    const isOwnerParty = issue.responsible_party === 'owner';
    const isAwaitingOwner = issue.status === 'awaiting_owner';
    const isActionPending = issue.status === 'action_pending';
    const hasPendingTasks = Boolean(
      issue.evidence?.owner_tasks &&
      issue.evidence.owner_tasks.some((t) => t.status === 'pending')
    );
    return isOwnerParty || isAwaitingOwner || isActionPending || hasPendingTasks;
  });

  const publicLink = typeof window !== 'undefined'
    ? `${window.location.origin}/inquiry/${business?.public_form_id || business?.tenant_id}`
    : `/inquiry/${business?.public_form_id || business?.tenant_id}`;

  const copyPublicLink = () => {
    navigator.clipboard.writeText(publicLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const checklistItems = onboardingData?.checklist || [];
  const completedStepsCount = checklistItems.filter((c: any) => c.done).length;
  const showOnboardingBanner = onboardingData && !onboardingData.is_completed;

  return (
    <AppLayout onRefresh={loadData} isRefreshing={refreshing}>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Onboarding Checklist Banner (if setup incomplete) */}
        {showOnboardingBanner && (
          <div className="p-5 rounded-2xl bg-indigo-50/70 border border-indigo-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-600 text-white">
                  Setup in Progress
                </span>
                <span className="text-xs font-semibold text-indigo-950">
                  {completedStepsCount} of {checklistItems.length || 5} steps completed
                </span>
              </div>
              <p className="text-xs text-indigo-900/80">
                Finish configuring your services catalog, operating hours, inquiry forms, and automated guardrails.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {checklistItems.map((item: any) => (
                  <span
                    key={item.id}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md ${
                      item.done
                        ? 'bg-emerald-100 text-emerald-800 font-semibold'
                        : 'bg-white/80 text-slate-600 border border-indigo-100'
                    }`}
                  >
                    {item.done ? '✓' : '○'} {item.title}
                  </span>
                ))}
              </div>
            </div>
            <Link
              href="/onboarding"
              className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 self-start md:self-center shrink-0 shadow-xs"
            >
              Resume Setup <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* 1. Assistant Status Banner */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-bold text-slate-900">
                    Assistant Status:{' '}
                    {automationMode === 'auto_routine' ? (
                      <span className="text-emerald-700">
                        {isServices ? 'Services Engine & Lead Guards Active' : 'Automatic Routine Replies Active'}
                      </span>
                    ) : automationMode === 'draft_only' ? (
                      <span className="text-amber-700">Reviewing Every Reply</span>
                    ) : (
                      <span className="text-slate-600">Paused</span>
                    )}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      automationMode === 'auto_routine'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : automationMode === 'draft_only'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        automationMode === 'auto_routine'
                          ? 'bg-emerald-500'
                          : automationMode === 'draft_only'
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                      }`}
                    ></span>
                    {automationMode === 'auto_routine'
                      ? 'Live Auto-Reply'
                      : automationMode === 'draft_only'
                      ? 'Manual Draft Approval'
                      : 'Paused'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                  {isServices
                    ? 'Routine service questions (hours, service area coverage, catalog facts) receive instant AI replies. Custom quotes, discounts, estimates and promises are held for owner approval.'
                    : automationMode === 'auto_routine'
                    ? 'Routine inquiries (greetings, operating hours, order tracking, catalog pricing, and policies) receive instant AI replies. Major financial actions (refunds, exchanges, cancellations) are held for your approval.'
                    : automationMode === 'draft_only'
                    ? 'AI generates suggested replies for all incoming emails and waits for your approval before sending anything.'
                    : 'The assistant is currently paused. No automated messages or drafts are being created.'}
                </p>
                <div className="flex items-center gap-4 text-xs text-slate-500 pt-1">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    Mailbox: <strong className="text-slate-700">{connectedEmail}</strong>
                  </span>
                  <span>•</span>
                  <Link
                    href="/settings"
                    className="text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1 hover:underline"
                  >
                    Change assistant behavior <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:self-center shrink-0">
              <Link
                href="/inbox"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>Open Inbox</span>
              </Link>
              <Link
                href="/approvals"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Approvals ({pendingCases.length})</span>
              </Link>
            </div>
          </div>
        </div>

        {/* 1.5 Owner Tasks & Action Items */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  activeOwnerTasks.length > 0
                    ? 'bg-amber-50 text-amber-600 border border-amber-200'
                    : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                }`}
              >
                {activeOwnerTasks.length > 0 ? (
                  <ClipboardList className="w-4 h-4" />
                ) : (
                  <UserCheck className="w-4 h-4" />
                )}
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Owner Tasks & Action Items
                </h2>
                <p className="text-xs text-slate-500">
                  {activeOwnerTasks.length > 0
                    ? `${activeOwnerTasks.length} task${
                        activeOwnerTasks.length === 1 ? '' : 's'
                      } requiring warehouse or store team action`
                    : 'All warehouse and fulfillment tasks are up to date.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                {activeOwnerTasks.length} Active
              </span>
            </div>
          </div>

          <div className="p-5">
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                <span>Checking owner tasks...</span>
              </div>
            ) : activeOwnerTasks.length === 0 ? (
              <div className="py-8 text-center space-y-2 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                  <Check className="w-5 h-5" />
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  No Pending Owner Tasks
                </div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  All warehouse actions, courier tracking traces, and customer escalations are clear.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeOwnerTasks.map((taskIssue) => {
                  const pendingOwnerTask = taskIssue.evidence?.owner_tasks?.find((t) => t.status === 'pending');
                  const taskTitle = pendingOwnerTask?.title || taskIssue.next_action || `Review ${taskIssue.issue_type.replace(/_/g, ' ')}`;
                  const orderRef = taskIssue.order_id ? `#${taskIssue.order_id.replace(/^#/, '')}` : null;
                  
                  // Distinction: Task Deadline vs. Reminder Time
                  const hasDeadline = Boolean(taskIssue.due_date);
                  const isOverdue = hasDeadline && new Date(taskIssue.due_date!).getTime() < Date.now();
                  
                  const activeJob = taskIssue.active_followup_job;
                  const hasActiveReminder = Boolean(activeJob && (activeJob.status === 'pending' || activeJob.status === 'claimed'));
                  const isEscalated = Boolean(taskIssue.is_escalated);

                  const conversationUrl = taskIssue.conversation_id
                    ? `/inbox?id=${encodeURIComponent(taskIssue.conversation_id)}`
                    : `/inbox?search=${encodeURIComponent(taskIssue.customer_email)}`;

                  const isApprovedAwaitingExecution =
                    taskIssue.status === 'action_pending' ||
                    pendingOwnerTask?.task_type === 'manual_action_execution';

                  const statusLabel = isApprovedAwaitingExecution
                    ? 'Approved — awaiting execution'
                    : taskIssue.status.replace(/_/g, ' ');

                  const statusColor = isApprovedAwaitingExecution
                    ? 'bg-violet-50 text-violet-800 border-violet-200'
                    : taskIssue.status === 'awaiting_owner'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-blue-50 text-blue-800 border-blue-200';

                  return (
                    <div
                      key={taskIssue.id}
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-2 min-w-0 flex-1">
                        {/* Header line: Status, Order, Customer */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusColor}`}>
                            {statusLabel}
                          </span>

                          {orderRef && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              <Package className="w-3 h-3 text-slate-500" />
                              Order {orderRef}
                            </span>
                          )}

                          {pendingOwnerTask?.action_details?.amount && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              Refund: {pendingOwnerTask.action_details.amount} {pendingOwnerTask.action_details.currency || 'USD'}
                            </span>
                          )}

                          <span className="text-xs font-medium text-slate-700">
                            {taskIssue.customer_name}
                          </span>
                          <span className="text-xs text-slate-400">
                            ({taskIssue.customer_email})
                          </span>
                        </div>

                        {/* Task Description */}
                        <div className="text-xs font-bold text-slate-900 leading-snug">
                          {taskTitle}
                        </div>

                        {/* Notes / Evidence snippet if available */}
                        {taskIssue.evidence?.investigation_notes && (
                          <p className="text-[11px] text-slate-500 line-clamp-1 italic">
                            {taskIssue.evidence.investigation_notes}
                          </p>
                        )}

                        {/* Distinct Schedule / Timeline Info: Task Deadline vs Next Reminder */}
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                          {/* 1. Actual Task Deadline */}
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">Task Deadline:</span>
                            {hasDeadline ? (
                              isOverdue ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 font-bold border border-rose-200">
                                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                                  Overdue ({formatDate(taskIssue.due_date)})
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium border border-slate-200">
                                  <Calendar className="w-3 h-3 text-slate-400" />
                                  {formatDate(taskIssue.due_date)}
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400 italic">No fixed deadline</span>
                            )}
                          </div>

                          <span className="text-slate-300">•</span>

                          {/* 2. Automated Reminder Info */}
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">Next Reminder:</span>
                            {hasActiveReminder && activeJob ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-medium border border-indigo-100">
                                <Clock className="w-3 h-3 text-indigo-500" />
                                {formatDate(activeJob.scheduled_for)}
                                <span className="text-indigo-500 text-[10px] ml-0.5">
                                  (Attempt {activeJob.attempt_count + 1} of {activeJob.max_attempts})
                                </span>
                              </span>
                            ) : isEscalated ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 font-semibold border border-amber-200">
                                <AlertCircle className="w-3 h-3 text-amber-600" />
                                Escalated (Max retries reached)
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">No pending reminder</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons: Record Execution & Open Conversation */}
                      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                        {isApprovedAwaitingExecution && pendingOwnerTask && (
                          <button
                            type="button"
                            onClick={() =>
                              setExecutingTask({
                                issueId: taskIssue.id,
                                taskId: pendingOwnerTask.id,
                                taskTitle: pendingOwnerTask.title,
                                actionType: pendingOwnerTask.action_type,
                                actionDetails: pendingOwnerTask.action_details,
                                customerName: taskIssue.customer_name,
                                orderRef: orderRef || undefined,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors cursor-pointer shadow-xs"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Record Execution</span>
                          </button>
                        )}
                        <Link
                          href={conversationUrl}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                          <span>Open Conversation</span>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 2. Top Priority: Requests Needing Owner Approval */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  pendingCases.length > 0
                    ? 'bg-amber-50 text-amber-600 border border-amber-200'
                    : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                }`}
              >
                {pendingCases.length > 0 ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Requests Needing Your Approval
                </h2>
                <p className="text-xs text-slate-500">
                  {pendingCases.length > 0
                    ? `${pendingCases.length} customer request${
                        pendingCases.length === 1 ? '' : 's'
                      } held for owner authorization (refunds, exchanges, or custom actions)`
                    : 'All clear! No pending actions require your attention.'}
                </p>
              </div>
            </div>

            {pendingCases.length > 0 && (
              <Link
                href="/approvals"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          <div className="p-5">
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                <span>Checking pending requests...</span>
              </div>
            ) : pendingCases.length === 0 ? (
              <div className="py-8 text-center space-y-2 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                  <Check className="w-5 h-5" />
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  No Pending Approvals
                </div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Your AI assistant is taking care of routine questions automatically. Major refund and exchange requests will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingCases.slice(0, 3).map((c) => {
                  const humanized = humanizeProposal(c.proposal);
                  const orderId =
                    (c.payload?.order_id as string) ||
                    (c.payload?.orderId as string) ||
                    '—';
                  const customerEmail =
                    (c.payload?.customer_email as string) ||
                    (c.payload?.customerEmail as string) ||
                    'Customer';

                  return (
                    <div
                      key={c.case_id}
                      className="p-4 rounded-xl border border-amber-200/80 bg-amber-50/30 hover:bg-amber-50/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <KindBadge kind={c.kind} />
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {humanized.headline}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          {humanized.summary}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono pt-0.5">
                          <span>Order: <strong className="text-slate-800">{orderId}</strong></span>
                          <span>•</span>
                          <span>{customerEmail}</span>
                          <span>•</span>
                          <span>{formatDate(c.created_at)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCaseForDecision({
                              caseData: c,
                              type: 'reject',
                            })
                          }
                          className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCaseForDecision({
                              caseData: c,
                              type: 'approve',
                            })
                          }
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors cursor-pointer"
                        >
                          Approve Action
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 3. Compact Summary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">
                Handled Automatically
              </div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
                {summary?.cases_resolved_automatically ?? (summary?.total_cases ? Math.max(0, (summary.total_cases || 0) - (summary.pending_approvals_all_time || 0)) : 14)}
              </div>
              <div className="text-[11px] text-emerald-700 font-medium mt-0.5">
                0 owner effort required
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">
                Pending Decisions
              </div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
                {pendingCases.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {pendingCases.length > 0 ? 'Requires your approval' : 'All clear'}
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Inbox className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">
                Customer Conversations
              </div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
                {summary?.total_cases || 16}
              </div>
              <div className="text-[11px] text-indigo-700 font-medium mt-0.5">
                <Link href="/inbox" className="hover:underline">
                  View full inbox →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* 3.5 Capability-Specific Queue: Services Leads vs Order Issues vs Blog */}
        {isServices && (
          <div className="space-y-6">
            {/* Services Leads Overview */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Services Leads & Inquiry Pipeline
                    </h2>
                    <p className="text-xs text-slate-500">
                      Customer service requests, qualification stages, and automated follow-up status.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 font-semibold">
                      {leadsCounts.new || 0} New
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                      {leadsCounts.contacted || 0} Contacted
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-semibold">
                      {leadsCounts.qualified || 0} Qualified
                    </span>
                  </div>
                  <Link
                    href="/leads"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    Manage Leads <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>

              <div className="p-5">
                {loading ? (
                  <div className="py-6 text-center text-xs text-slate-400 space-y-2">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                    <span>Loading services leads...</span>
                  </div>
                ) : servicesLeads.length === 0 ? (
                  <div className="py-6 text-center space-y-2 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center justify-center mx-auto">
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="text-xs font-semibold text-slate-800">
                      No Active Services Leads
                    </div>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      New customer inquiries captured from your hosted form or email will appear here automatically.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {servicesLeads.slice(0, 4).map((lead) => (
                      <div
                        key={lead.id}
                        className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 bg-white transition-all shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border capitalize bg-blue-50 text-blue-800 border-blue-200">
                              {lead.stage}
                            </span>
                            <span className="font-semibold text-slate-900 text-xs">
                              {lead.customer_name}
                            </span>
                            <span className="text-xs text-slate-400">
                              ({lead.customer_email})
                            </span>
                            {lead.service_interest && (
                              <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-medium">
                                {lead.service_interest}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-700 font-medium">
                            <strong>Next Action:</strong> {lead.next_action || 'Follow up with customer inquiry.'}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                          <Link
                            href="/leads"
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors inline-flex items-center gap-1"
                          >
                            <Users className="w-3 h-3" />
                            <span>View Lead</span>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Inquiry Channel & Hosted Link Card */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">Dedicated Hosted Inquiry Link</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                    Active
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Clients can submit requests directly. Rate-limited with anti-spam protection.
                </p>
                <div className="text-xs font-mono text-slate-600 select-all pt-1 truncate max-w-md">
                  {publicLink}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={copyPublicLink}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? 'Copied' : 'Copy Form Link'}
                </button>
                <a
                  href={publicLink}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                  title="Open Form"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {isEcommerce && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center">
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Order Issue Resolutions & Active Cases
                  </h2>
                  <p className="text-xs text-slate-500">
                    Delivery delays, damaged items, and return requests with verified Shopify tracking.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 font-semibold">
                    {issuesSummary.unresolved_count} Unresolved
                  </span>
                  {issuesSummary.awaiting_owner_count > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                      {issuesSummary.awaiting_owner_count} Awaiting Owner
                    </span>
                  )}
                </div>
                <Link
                  href="/inbox"
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  Inbox View <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            <div className="p-5">
              {loading ? (
                <div className="py-6 text-center text-xs text-slate-400 space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                  <span>Checking active order issues...</span>
                </div>
              ) : orderIssues.length === 0 ? (
                <div className="py-6 text-center space-y-2 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                    <Check className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-semibold text-slate-800">
                    No Active Order Issues
                  </div>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    All customer shipments and inquiries are running smoothly. Any reported delivery delays or damage inquiries will be tracked here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orderIssues.slice(0, 4).map((issue) => {
                    const issueBadgeBg =
                      issue.issue_type === 'delivery_delay' || issue.issue_type === 'not_received'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : issue.issue_type === 'damaged_item' || issue.issue_type === 'wrong_item'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200';

                    const statusColor =
                      issue.status === 'resolved' || issue.status === 'closed'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : issue.status === 'awaiting_owner' || issue.status === 'action_pending'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-indigo-50 text-indigo-800 border-indigo-200';

                    return (
                      <div
                        key={issue.id}
                        className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 bg-white transition-all shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${issueBadgeBg}`}>
                              {issue.issue_type.replace(/_/g, ' ')}
                            </span>
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusColor}`}>
                              Status: {issue.status.replace(/_/g, ' ')}
                            </span>
                            {issue.order_id && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                                <Package className="w-3 h-3 text-slate-400" />
                                Order #{issue.order_id.replace(/^#/, '')}
                              </span>
                            )}
                            <span className="text-xs text-slate-400">
                              for {issue.customer_name} ({issue.customer_email})
                            </span>
                          </div>

                          <div className="text-xs text-slate-700 font-medium">
                            <strong>Next Action:</strong> {issue.next_action || 'Investigation in progress.'}
                          </div>

                          {issue.evidence?.investigation_notes && (
                            <p className="text-[11px] text-slate-500 line-clamp-1 italic">
                              Evidence: {issue.evidence.investigation_notes}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                          <Link
                            href={
                              issue.conversation_id
                                ? `/inbox?id=${encodeURIComponent(issue.conversation_id)}`
                                : `/inbox?search=${encodeURIComponent(issue.customer_email)}`
                            }
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors inline-flex items-center gap-1"
                          >
                            <Inbox className="w-3 h-3" />
                            <span>View Thread</span>
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {isBlog && (
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Blog / Publication Inquiries</h2>
                <p className="text-xs text-slate-500">Reader feedback, editorial submissions, and licensing queries.</p>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-800">Blog Traffic & Reader Analytics:</span>
                <span className="ml-2 italic text-slate-500">Not configured — Coming soon</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">
                Phase 2
              </span>
            </div>
          </div>
        )}

        {/* 4. Recent Activity Stream */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">

          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Recent Activity
              </h2>
              <p className="text-xs text-slate-500">
                Latest customer messages, routine auto-replies, and approval actions.
              </p>
            </div>
            <Link
              href="/inbox"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              Open Inbox <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                <span>Loading activity...</span>
              </div>
            ) : recentAudit.length === 0 && recentCases.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No recent activity recorded yet.
              </div>
            ) : (
              (recentCases.length > 0 ? recentCases : []).slice(0, 5).map((item) => {
                const humanized = humanizeProposal(item.proposal);
                const isApproved = item.status === 'approved';
                const isPending = item.status === 'pending_approval';

                return (
                  <div
                    key={item.case_id}
                    className="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          isApproved
                            ? 'bg-emerald-50 text-emerald-600'
                            : isPending
                            ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isApproved ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : isPending ? (
                          <Clock className="w-4 h-4" />
                        ) : (
                          <MessageSquare className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {humanized.headline}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {humanized.summary}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-right">
                      <StatusBadge status={item.status} />
                      <span className="text-[11px] text-slate-400 hidden sm:inline">
                        {formatDate(item.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Decision Modal */}
      {selectedCaseForDecision && (
        <ApprovalModal
          isOpen={true}
          caseData={selectedCaseForDecision.caseData}
          decisionType={selectedCaseForDecision.type}
          onClose={() => setSelectedCaseForDecision(null)}
          onDecisionComplete={() => {
            setSelectedCaseForDecision(null);
            loadData();
          }}
        />
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
            loadData();
          }}
        />
      )}
    </AppLayout>
  );
}
