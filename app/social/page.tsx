'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Share2,
  Calendar,
  Settings as SettingsIcon,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  Eye,
  Plus,
  RefreshCw,
  Pause,
  Play,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Video,
  Image as ImageIcon,
  HelpCircle,
  Layers,
  Lock,
  Unlock,
  Info,
  Check,
  ShieldAlert,
} from 'lucide-react';

function FacebookIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function InstagramIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}
import type {
  SocialPlatform,
  SocialBrandSettings,
  SocialConnectionRecord,
  SocialPostRecord,
  SocialPublishingJobRecord,
  SocialDashboardSummary,
  SocialGenerationJobRecord,
} from '@/lib/social-types';

export default function SocialMediaDashboard() {
  const [activeTab, setActiveTab] = useState<'calendar' | 'accounts' | 'settings' | 'editor' | 'activity'>('calendar');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SocialDashboardSummary | null>(null);
  const [settings, setSettings] = useState<SocialBrandSettings | null>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [posts, setPosts] = useState<SocialPostRecord[]>([]);
  const [jobs, setJobs] = useState<SocialPublishingJobRecord[]>([]);
  const [selectedPost, setSelectedPost] = useState<SocialPostRecord | null>(null);

  // Editor form state
  const [editorCaption, setEditorCaption] = useState('');
  const [editorHashtags, setEditorHashtags] = useState('');
  const [editorPlatforms, setEditorPlatforms] = useState<SocialPlatform[]>(['facebook', 'instagram']);
  const [editorMediaUrl, setEditorMediaUrl] = useState('');
  const [editorVideoScript, setEditorVideoScript] = useState('');
  const [editorScheduledAt, setEditorScheduledAt] = useState('');
  const [editorTheme, setEditorTheme] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [activeJob, setActiveJob] = useState<SocialGenerationJobRecord | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Active workspace / tenant
  const [currentTenant, setCurrentTenant] = useState<string>('');

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMessage({ text, type });
    setTimeout(() => setActionMessage(null), 5000);
  };

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Load Summary
      const summaryRes = await fetch('/api/social/summary');
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data.summary);
        if (data.tenant_id) setCurrentTenant(data.tenant_id);
      }

      // 2. Load Settings
      const settingsRes = await fetch('/api/social/settings');
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data.settings);
      }

      // 3. Load Connections
      const connRes = await fetch('/api/social/connections');
      if (connRes.ok) {
        const data = await connRes.json();
        setConnections(data.platforms || []);
      }

      // 4. Load Posts
      const postsRes = await fetch('/api/social/posts?limit=50');
      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts || []);
      }

      // 5. Load Publishing Jobs
      const jobsRes = await fetch('/api/social/jobs?limit=50');
      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
      }
    } catch (err: any) {
      console.error('Failed to load social dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Load activity / jobs when clicking activity tab
  useEffect(() => {
    if (activeTab === 'activity') {
      fetch('/api/social/jobs?limit=50')
        .then((res) => res.json())
        .then((data) => {
          if (data.jobs) setJobs(data.jobs);
        })
        .catch(console.error);
    }
  }, [activeTab]);

  // Generate Branded Card on-demand
  const handleGenerateBrandedCard = async () => {
    setIsGeneratingCard(true);
    try {
      const res = await fetch('/api/social/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_branded_card',
          headline: 'Verified Commercial & Residential Excellence',
          subtext: 'Licensed Specialists • On-Demand Service',
          aspectRatio: 'square',
        }),
      });
      const data = await res.json();
      if (res.ok && data.asset) {
        setEditorMediaUrl(data.asset.storage_url);
        showNotification('Generated high-resolution branded social card!');
        setActiveTab('editor');
      } else {
        showNotification(data.error || 'Failed to generate branded asset', 'error');
      }
    } catch (err: any) {
      showNotification(err.message || 'Generation network error', 'error');
    } finally {
      setIsGeneratingCard(false);
    }
  };

  // Handle toggle pause / resume automation
  const handleTogglePause = async () => {
    if (!settings) return;
    const newPauseState = !settings.is_automation_paused;
    try {
      const res = await fetch('/api/social/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_automation_paused: newPauseState }),
      });
      if (res.ok) {
        setSettings({ ...settings, is_automation_paused: newPauseState });
        showNotification(
          newPauseState
            ? 'Social Media Autopilot paused. Upcoming posts will not be published.'
            : 'Social Media Autopilot resumed.'
        );
        loadDashboardData();
      }
    } catch {
      showNotification('Failed to update pause state', 'error');
    }
  };

  // Handle saving brand settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      const res = await fetch('/api/social/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        showNotification('Brand & Content settings saved successfully.');
        loadDashboardData();
      } else {
        const err = await res.json();
        showNotification(err.error || 'Failed to save settings', 'error');
      }
    } catch {
      showNotification('Network error saving settings', 'error');
    }
  };

  // Poll a running generation job until complete or failed
  const pollGenerationJob = useCallback((jobId: string, saveAsPost: boolean) => {
    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/social/generate/jobs/${jobId}`);
        if (!res.ok) {
          clearInterval(pollTimer);
          setIsGeneratingAi(false);
          return;
        }

        const data = await res.json();
        const job: SocialGenerationJobRecord = data.job;
        if (!job) return;

        setActiveJob(job);

        if (job.status === 'ready') {
          clearInterval(pollTimer);
          setIsGeneratingAi(false);

          if (job.generated_draft) {
            setEditorCaption(job.generated_draft.caption || '');
            setEditorHashtags((job.generated_draft.hashtags || []).join(', '));
            if (job.generated_draft.video_script) setEditorVideoScript(job.generated_draft.video_script);
            if (job.media_result?.storage_url) setEditorMediaUrl(job.media_result.storage_url);
            if (job.selected_concept?.topic) setEditorTheme(job.selected_concept.topic);
          }

          showNotification(`AI Post ready! Angle: ${job.selected_concept?.angle_title || 'Spotlight'}`);
          if (saveAsPost) loadDashboardData();
        } else if (job.status === 'failed') {
          clearInterval(pollTimer);
          setIsGeneratingAi(false);
          showNotification(job.error_message || 'Content generation failed', 'error');
        }
      } catch (err: any) {
        console.warn('[Social Polling] Poll error:', err);
      }
    }, 1000);
  }, [loadDashboardData]);

  // AI Content Generator - triggers persistent n8n job
  const handleTriggerAiGenerate = async (saveAsPost: boolean = false) => {
    if (isGeneratingAi) return; // Prevent double-clicks

    setIsGeneratingAi(true);
    setActiveTab('editor');

    // Create unique client idempotency key per intentional generation click
    const idempotencyKey = `ik_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const res = await fetch('/api/social/generate/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          save_as_post: saveAsPost,
          target_platforms: editorPlatforms,
          theme: editorTheme || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setIsGeneratingAi(false);
        showNotification(data.error || 'Failed to start generation job', 'error');
        return;
      }

      const jobId = data.job_id;
      setActiveJob({
        id: jobId,
        tenant_id: currentTenant,
        status: data.status || 'queued',
        stage_label: data.stage_label || 'Queued in orchestrator',
        stage_progress: data.stage_progress || 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Start stage polling
      pollGenerationJob(jobId, saveAsPost);
    } catch (err: any) {
      setIsGeneratingAi(false);
      showNotification(err.message || 'Network error triggering generation', 'error');
    }
  };

  // Retry an existing failed job without duplicating posts
  const handleRetryJob = async (jobId: string) => {
    setIsGeneratingAi(true);
    try {
      const res = await fetch(`/api/social/generate/jobs/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry' }),
      });

      if (!res.ok) {
        const err = await res.json();
        showNotification(err.error || 'Retry failed', 'error');
        setIsGeneratingAi(false);
        return;
      }

      showNotification('Retrying generation job...');
      pollGenerationJob(jobId, false);
    } catch {
      setIsGeneratingAi(false);
      showNotification('Network error retrying job', 'error');
    }
  };

  // Approve a post
  const handleApprovePost = async (postId: string) => {
    try {
      const res = await fetch(`/api/social/posts/${postId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        showNotification('Post approved and queued for scheduled publishing.');
        loadDashboardData();
      } else {
        const data = await res.json();
        showNotification(data.error || 'Approval failed', 'error');
      }
    } catch {
      showNotification('Approval network error', 'error');
    }
  };

  // Cancel a post
  const handleCancelPost = async (postId: string) => {
    try {
      const res = await fetch(`/api/social/posts/${postId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showNotification('Post cancelled.');
        loadDashboardData();
      } else {
        showNotification('Failed to cancel post', 'error');
      }
    } catch {
      showNotification('Cancellation network error', 'error');
    }
  };

  // Save new or edited post from Editor tab
  const handleSavePostFromEditor = async (approveImmediately: boolean = false) => {
    if (!editorCaption.trim()) {
      showNotification('Please enter a caption for the post.', 'error');
      return;
    }

    const hashtagsArr = editorHashtags
      .split(',')
      .map((h) => h.trim().replace(/^#/, ''))
      .filter(Boolean);

    try {
      if (selectedPost) {
        // Edit existing post
        const res = await fetch(`/api/social/posts/${selectedPost.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caption: editorCaption,
            hashtags: hashtagsArr,
            video_script: editorVideoScript || undefined,
            target_platforms: editorPlatforms,
            media_urls: editorMediaUrl ? [editorMediaUrl] : [],
            scheduled_at: editorScheduledAt || undefined,
          }),
        });

        if (res.ok) {
          showNotification('Post updated. (Note: material edits require re-approval).');
          setSelectedPost(null);
          loadDashboardData();
          setActiveTab('calendar');
        } else {
          const err = await res.json();
          showNotification(err.error || 'Failed to update post', 'error');
        }
      } else {
        // Create new post
        const res = await fetch('/api/social/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caption: editorCaption,
            hashtags: hashtagsArr,
            video_script: editorVideoScript || undefined,
            target_platforms: editorPlatforms,
            topic_theme: editorTheme || undefined,
            media_urls: editorMediaUrl ? [editorMediaUrl] : [],
            scheduled_at: editorScheduledAt || new Date(Date.now() + 86400000).toISOString(),
            is_approved: approveImmediately,
          }),
        });

        if (res.ok) {
          showNotification(
            approveImmediately
              ? 'Post created and scheduled for automated publishing!'
              : 'Post saved as draft for review.'
          );
          setEditorCaption('');
          setEditorHashtags('');
          setEditorVideoScript('');
          setEditorMediaUrl('');
          loadDashboardData();
          setActiveTab('calendar');
        } else {
          const err = await res.json();
          showNotification(err.error || 'Failed to create post', 'error');
        }
      }
    } catch {
      showNotification('Error saving post', 'error');
    }
  };

  // Connect Simulation Account (for testing & verification)
  const handleConnectSimulation = async (platform: SocialPlatform) => {
    try {
      const res = await fetch('/api/social/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'connect_simulation',
          platform,
          account_name: `${currentTenant || 'Business'} ${platform.toUpperCase()}`,
        }),
      });

      if (res.ok) {
        showNotification(`Simulated ${platform.toUpperCase()} account connected for verification testing.`);
        loadDashboardData();
      } else {
        showNotification('Failed to connect simulation account', 'error');
      }
    } catch {
      showNotification('Network error connecting account', 'error');
    }
  };

  // Disconnect Account
  const handleDisconnect = async (platform: SocialPlatform) => {
    try {
      const res = await fetch(`/api/social/connections?platform=${platform}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showNotification(`Disconnected ${platform.toUpperCase()} account.`);
        loadDashboardData();
      }
    } catch {
      showNotification('Failed to disconnect account', 'error');
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'facebook':
        return <FacebookIcon className="w-5 h-5 text-blue-600" />;
      case 'instagram':
        return <InstagramIcon className="w-5 h-5 text-pink-600" />;
      case 'tiktok':
        return <Video className="w-5 h-5 text-slate-800" />;
      default:
        return <Share2 className="w-5 h-5 text-indigo-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'published':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Published</span>;
      case 'simulated':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-50 text-purple-700 border border-purple-200">Simulated (Pilot)</span>;
      case 'scheduled':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">Scheduled</span>;
      case 'pending_approval':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200">Needs Review</span>;
      case 'cancelled':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600 border border-slate-200">Cancelled</span>;
      case 'failed':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200">Failed</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-50 text-slate-700 border border-slate-200">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      {/* Action Toast */}
      {actionMessage && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all ${
            actionMessage.type === 'success'
              ? 'bg-emerald-900/90 text-emerald-50 border-emerald-700 shadow-emerald-900/20'
              : 'bg-rose-900/90 text-rose-50 border-rose-700 shadow-rose-900/20'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="bg-white border-b border-slate-200/80 px-6 py-6 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/20">
                <Share2 className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  Social Media Autopilot
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Workspace: {currentTenant || 'Active'}
                  </span>
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  AI-prepared social content and background publishing orchestrated via n8n.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Status Pill & Emergency Pause */}
          <div className="flex flex-wrap items-center gap-3">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
              summary?.effective_publishing_mode === 'live'
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              {summary?.effective_publishing_mode === 'live' ? (
                <>
                  <Unlock className="w-3.5 h-3.5 text-rose-600" />
                  <span>Live Publishing Armed</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-semibold">Safe Simulation Sandbox</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Cadence:</span>
              <span className="capitalize">{settings?.automation_mode.replace('_', ' ') || 'Review Required'}</span>
              <span className="text-slate-300">|</span>
              <span className="font-semibold text-slate-900">AI Quota:</span>
              <span>
                {settings?.monthly_generations_used || 0}/{settings?.monthly_generation_limit || 30}
              </span>
            </div>

            <button
              onClick={handleTogglePause}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all border ${
                settings?.is_automation_paused
                  ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              {settings?.is_automation_paused ? (
                <>
                  <Play className="w-3.5 h-3.5" /> Resume Autopilot
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 text-amber-600" /> Pause Automation
                </>
              )}
            </button>

            <button
              onClick={() => handleTriggerAiGenerate(false)}
              disabled={isGeneratingAi}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isGeneratingAi ? 'animate-spin' : ''}`} />
              {isGeneratingAi ? 'Drafting...' : 'Generate AI Post'}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto mt-6 flex gap-2 border-b border-slate-100 pb-0 overflow-x-auto">
          {[
            { id: 'calendar', label: 'Content Calendar', icon: Calendar, badge: posts.filter(p => p.status === 'scheduled' || p.status === 'pending_approval').length },
            { id: 'editor', label: 'Post Preview & Editor', icon: Eye },
            { id: 'accounts', label: 'Connected Accounts', icon: Share2, badge: connections.filter(c => c.is_connected).length },
            { id: 'settings', label: 'Brand & Content Settings', icon: SettingsIcon },
            { id: 'activity', label: 'Publishing Activity', icon: Clock },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 -mb-px whitespace-nowrap ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-6 sm:px-8 mt-6">
        {/* ========================================================================= */}
        {/* TAB 1: CONTENT CALENDAR                                                  */}
        {/* ========================================================================= */}
        {activeTab === 'calendar' && (
          <div className="space-y-6">
            {/* Pipeline Overview Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <span className="text-xs text-slate-500 font-medium">Pending Review</span>
                <div className="text-2xl font-bold text-amber-600 mt-1">
                  {posts.filter((p) => p.status === 'pending_approval').length}
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <span className="text-xs text-slate-500 font-medium">Scheduled</span>
                <div className="text-2xl font-bold text-blue-600 mt-1">
                  {posts.filter((p) => p.status === 'scheduled').length}
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <span className="text-xs text-slate-500 font-medium">Published / Pilot</span>
                <div className="text-2xl font-bold text-emerald-600 mt-1">
                  {posts.filter((p) => p.status === 'published' || p.status === 'simulated').length}
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <span className="text-xs text-slate-500 font-medium">Active Platforms</span>
                <div className="text-2xl font-bold text-slate-800 mt-1">
                  {connections.filter((c) => c.is_connected).length} / 3
                </div>
              </div>
            </div>

            {/* Next Recurring Slot Banner */}
            <div className="bg-gradient-to-r from-indigo-50/70 via-white to-slate-50 p-4 rounded-2xl border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    Next Autopilot Slot: {settings?.posting_times?.[0] || '10:00'} ({settings?.timezone || 'UTC'})
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                      Cadence: {(settings?.posting_days || [1, 3, 5]).map(n => {
                        const labels: Record<number, string> = { 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 0: 'SUN' };
                        return labels[n] || String(n);
                      }).join(', ')}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Deterministic hourly slot keys (`auto_sched_...`) strictly prevent duplicate jobs. n8n background scheduler triggers every 15m.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-center">
                <button
                  type="button"
                  onClick={handleGenerateBrandedCard}
                  disabled={isGeneratingCard}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Sparkles className={`w-3.5 h-3.5 text-indigo-600 ${isGeneratingCard ? 'animate-spin' : ''}`} />
                  {isGeneratingCard ? 'Generating Card...' : 'Generate Branded Asset'}
                </button>
              </div>
            </div>

            {/* Posts Stream */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Upcoming & Draft Posts</h3>
                  <p className="text-xs text-slate-500">Scheduled according to your brand calendar ({settings?.timezone || 'UTC'})</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedPost(null);
                    setEditorCaption('');
                    setEditorHashtags('');
                    setActiveTab('editor');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> New Post
                </button>
              </div>

              {posts.length === 0 ? (
                <div className="p-12 text-center">
                  <Share2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <h4 className="text-sm font-semibold text-slate-700">No posts in the queue</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                    Your scheduled posts and AI drafts will appear here. Generate an AI post or create one manually.
                  </p>
                  <button
                    onClick={() => handleTriggerAiGenerate(true)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-600/20"
                  >
                    Draft First Post with AI
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {posts.map((post) => (
                    <div key={post.id} className="p-5 hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row gap-4 justify-between items-start">
                      {/* Media Thumbnail Preview */}
                      {post.media_urls && post.media_urls.length > 0 && (
                        <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 relative group">
                          <img
                            src={post.media_urls[0]}
                            alt="Media Preview"
                            className="w-full h-full object-cover"
                          />
                          {/* Media Thumbnail Overlay */}
                          <span className={`absolute bottom-0 inset-x-0 text-[8px] text-center font-bold py-0.5 text-white ${
                            post.media_urls[0].startsWith('data:image/svg')
                              ? 'bg-amber-600/90'
                              : (post.metadata?.media_source === 'owner_upload'
                                  ? 'bg-emerald-600/90'
                                  : 'bg-sky-600/90')
                          }`}>
                            {post.media_urls[0].startsWith('data:image/svg')
                              ? 'Template Card'
                              : (post.metadata?.media_source === 'owner_upload'
                                  ? 'Owner Photo'
                                  : 'Stock Imagery')}
                          </span>
                        </div>
                      )}

                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getStatusBadge(post.status)}
                          <div className="flex items-center gap-1.5 ml-1">
                            {post.target_platforms.map((p) => (
                              <span key={p} className="p-1 rounded bg-slate-100 text-slate-700" title={p}>
                                {getPlatformIcon(p)}
                              </span>
                            ))}
                          </div>
                          {post.scheduled_at && (
                            <span className="text-xs text-slate-500 flex items-center gap-1 ml-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {new Date(post.scheduled_at).toLocaleString([], {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </span>
                          )}
                          {post.topic_theme && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              Theme: {post.topic_theme}
                            </span>
                          )}

                          {/* Honest Content Origin Badge */}
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            post.metadata?.generation_source === 'llm_groq'
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                            {post.metadata?.generation_source === 'llm_groq'
                              ? 'Groq LLM (llama-3.3-70b)'
                              : 'Deterministic Template (Catalog Grounded)'}
                          </span>

                          {/* Honest Media Source Badge */}
                          {post.media_urls && post.media_urls.length > 0 && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                              post.media_urls[0].startsWith('data:image/svg')
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : (post.metadata?.media_source === 'owner_upload'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-sky-50 text-sky-700 border-sky-200')
                            }`} title={
                              post.media_urls[0].startsWith('data:image/svg')
                                ? 'Locally generated branded template'
                                : (post.metadata?.media_source === 'owner_upload'
                                    ? 'Actual business product photography uploaded by owner'
                                    : 'Illustrative stock photography; does not depict client actual product')
                            }>
                              {post.media_urls[0].startsWith('data:image/svg')
                                ? 'Branded Template Card (SVG)'
                                : (post.metadata?.media_source === 'owner_upload'
                                    ? 'Verified Owner Photography'
                                    : 'Stock Imagery (Illustrative)')}
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-slate-800 font-normal leading-relaxed whitespace-pre-line line-clamp-3">
                          {post.caption}
                        </p>

                        {post.hashtags && post.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {post.hashtags.map((h, i) => (
                              <span key={i} className="text-xs text-indigo-600 font-medium">
                                #{h}
                              </span>
                            ))}
                          </div>
                        )}

                        {post.video_script && (
                          <div className="text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200/60 text-slate-600">
                            <span className="font-semibold text-slate-800">Short Video Script:</span> {post.video_script.slice(0, 100)}...
                          </div>
                        )}
                      </div>

                      {/* Post Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        {post.status === 'pending_approval' && (
                          <button
                            onClick={() => handleApprovePost(post.id)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setSelectedPost(post);
                            setEditorCaption(post.caption);
                            setEditorHashtags(post.hashtags.join(', '));
                            setEditorPlatforms(post.target_platforms);
                            setEditorVideoScript(post.video_script || '');
                            setEditorMediaUrl(post.media_urls?.[0] || '');
                            setEditorScheduledAt(post.scheduled_at ? new Date(post.scheduled_at).toISOString().slice(0, 16) : '');
                            setActiveTab('editor');
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                          Edit / Preview
                        </button>

                        {post.status !== 'cancelled' && post.status !== 'published' && (
                          <button
                            onClick={() => handleCancelPost(post.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Cancel post"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: POST PREVIEW & EDITOR                                             */}
        {/* ========================================================================= */}
        {activeTab === 'editor' && (
          <div className="space-y-6">
            {/* Real-time Generation Job Progress Tracker */}
            {(isGeneratingAi || activeJob) && (
              <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                        activeJob?.status === 'failed'
                          ? 'bg-rose-50 text-rose-600'
                          : activeJob?.status === 'ready'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-indigo-50 text-indigo-600'
                      }`}
                    >
                      {activeJob?.status === 'failed' ? (
                        <AlertCircle className="w-4 h-4" />
                      ) : activeJob?.status === 'ready' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Sparkles className="w-4 h-4 animate-spin" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900">
                          {activeJob?.status === 'failed'
                            ? 'Generation Failed'
                            : activeJob?.status === 'ready'
                            ? 'AI Generation Complete'
                            : 'AI Content Generation in Progress'}
                        </h4>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            activeJob?.status === 'failed'
                              ? 'bg-rose-100 text-rose-700'
                              : activeJob?.status === 'ready'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}
                        >
                          {activeJob?.status || 'Processing'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {activeJob?.stage_label || 'Orchestrating grounded generation workflow through n8n...'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeJob?.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => handleRetryJob(activeJob.id)}
                        disabled={isGeneratingAi}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-sm disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                        Retry Same Job
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleTriggerAiGenerate(false)}
                      disabled={isGeneratingAi}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate Another Concept
                    </button>
                  </div>
                </div>

                {/* Progress Bar & Stage Indicators */}
                <div className="space-y-2">
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        activeJob?.status === 'failed'
                          ? 'bg-rose-500'
                          : activeJob?.status === 'ready'
                          ? 'bg-emerald-500'
                          : 'bg-gradient-to-r from-indigo-500 to-violet-600'
                      }`}
                      style={{ width: `${Math.max(activeJob?.stage_progress || 10, 5)}%` }}
                    />
                  </div>

                  {/* 5 Distinct Stages */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 text-[11px]">
                    {[
                      { key: 'queued', label: '1. Queued' },
                      { key: 'choosing_idea', label: '2. Choosing Idea' },
                      { key: 'writing_caption', label: '3. Writing Caption' },
                      { key: 'generating_image', label: '4. Evaluating Media' },
                      { key: 'ready', label: '5. Ready' },
                    ].map((st, idx) => {
                      const stagesOrder = ['queued', 'choosing_idea', 'writing_caption', 'generating_image', 'ready'];
                      const currentIdx = stagesOrder.indexOf(activeJob?.status || 'queued');
                      const isPast = currentIdx > idx || activeJob?.status === 'ready';
                      const isCurrent = stagesOrder[currentIdx] === st.key && activeJob?.status !== 'ready';
                      return (
                        <div
                          key={st.key}
                          className={`flex items-center gap-1.5 font-medium px-2 py-1 rounded-lg ${
                            isPast
                              ? 'text-emerald-700 bg-emerald-50/70'
                              : isCurrent
                              ? 'text-indigo-700 bg-indigo-50 font-bold'
                              : 'text-slate-400'
                          }`}
                        >
                          {isPast ? (
                            <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          ) : isCurrent ? (
                            <Clock className="w-3 h-3 text-indigo-600 animate-spin shrink-0" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                          )}
                          <span>{st.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Concept Metadata Badge Card */}
                {activeJob?.selected_concept && (
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md font-semibold bg-violet-100 text-violet-800 border border-violet-200 text-[11px]">
                        Angle: {activeJob.selected_concept.angle_title}
                      </span>
                      {activeJob.selected_concept.catalog_item_name && (
                        <span className="px-2 py-0.5 rounded-md font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px]">
                          Item: {activeJob.selected_concept.catalog_item_name}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-md font-semibold bg-slate-200 text-slate-700 text-[11px]">
                        Hook: {activeJob.selected_concept.hook_type}
                      </span>
                    </div>
                    <div className="text-slate-600 text-[11px] leading-relaxed">
                      <span className="font-semibold text-slate-800">Visual Concept: </span>
                      {activeJob.selected_concept.visual_concept}
                    </div>
                  </div>
                )}

                {/* Error Banner if failed */}
                {activeJob?.status === 'failed' && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Execution Error: </span>
                      {activeJob.error_message || 'An error occurred during generation pipeline execution.'}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Editor Inputs */}
              <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">
                    {selectedPost ? 'Edit Scheduled Post' : 'Compose Social Post'}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleTriggerAiGenerate(false)}
                      disabled={isGeneratingAi}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {isGeneratingAi ? 'Generating...' : '✨ Generate Another Angle'}
                    </button>
                  </div>
                </div>

              {/* Target Platforms Picker */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Publishing Destinations</label>
                <div className="flex gap-2">
                  {(['facebook', 'instagram', 'tiktok'] as SocialPlatform[]).map((p) => {
                    const isSelected = editorPlatforms.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            if (editorPlatforms.length > 1) {
                              setEditorPlatforms(editorPlatforms.filter((x) => x !== p));
                            }
                          } else {
                            setEditorPlatforms([...editorPlatforms, p]);
                          }
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {getPlatformIcon(p)}
                        <span className="capitalize">{p}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Caption */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Post Caption</label>
                <textarea
                  rows={5}
                  value={editorCaption}
                  onChange={(e) => setEditorCaption(e.target.value)}
                  placeholder="Share a helpful tip, service highlight, or community update..."
                  className="w-full text-sm p-3.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                />
              </div>

              {/* Hashtags */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Hashtags (comma-separated)</label>
                <input
                  type="text"
                  value={editorHashtags}
                  onChange={(e) => setEditorHashtags(e.target.value)}
                  placeholder="localbusiness, qualityservice, tips"
                  className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                />
              </div>

              {/* Media URL */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Media URL (Image or Video Asset)</label>
                <input
                  type="url"
                  value={editorMediaUrl}
                  onChange={(e) => setEditorMediaUrl(e.target.value)}
                  placeholder="https://example.com/assets/banner.jpg"
                  className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Note: Instagram requires an image URL; TikTok requires a hosted video file.
                </p>
              </div>

              {/* Video Script (for Reels / TikTok) */}
              {editorPlatforms.includes('tiktok') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Short-Form Video Script (TikTok / Reels)</label>
                  <textarea
                    rows={3}
                    value={editorVideoScript}
                    onChange={(e) => setEditorVideoScript(e.target.value)}
                    placeholder="[Hook]: 0-3s... [Body]: 4-15s... [CTA]: 16-20s..."
                    className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 bg-slate-50/50"
                  />
                </div>
              )}

              {/* Scheduled Time */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Schedule Publishing Time</label>
                <input
                  type="datetime-local"
                  value={editorScheduledAt}
                  onChange={(e) => setEditorScheduledAt(e.target.value)}
                  className="text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleSavePostFromEditor(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Save as Draft (Review Mode)
                </button>
                <button
                  type="button"
                  onClick={() => handleSavePostFromEditor(true)}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20"
                >
                  Approve & Schedule Post
                </button>
              </div>
            </div>

            {/* Right: Social Mockup Preview */}
            <div className="lg:col-span-5 space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Live Destination Preview</h3>

              {/* Facebook / Instagram Card Preview */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md overflow-hidden max-w-sm mx-auto">
                {/* Header */}
                <div className="p-3.5 flex items-center justify-between border-b border-slate-50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
                      {currentTenant ? currentTenant.slice(0, 2).toUpperCase() : 'IA'}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">{currentTenant || 'Your Business'}</div>
                      <div className="text-[10px] text-slate-400">Sponsored • Just now</div>
                    </div>
                  </div>
                  <Share2 className="w-4 h-4 text-slate-400" />
                </div>

                {/* Caption */}
                <div className="p-3.5 text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                  {editorCaption || 'Your post caption preview will display here in real-time...'}
                  {editorHashtags && (
                    <div className="mt-2 text-indigo-600 font-medium">
                      {editorHashtags
                        .split(',')
                        .map((h) => `#${h.trim().replace(/^#/, '')}`)
                        .join(' ')}
                    </div>
                  )}
                </div>

                {/* Media Placeholder or Image */}
                {editorMediaUrl ? (
                  <div className="aspect-video bg-slate-100 overflow-hidden flex items-center justify-center">
                    <img src={editorMediaUrl} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="aspect-video bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center text-slate-400 gap-1.5 p-4 text-center">
                    <ImageIcon className="w-7 h-7" />
                    <span className="text-[11px]">Attach an image or video URL to enhance engagement</span>
                  </div>
                )}

                {/* Mock reactions bar */}
                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="text-rose-500 font-bold">♥</span>
                    <span className="text-blue-500 font-bold">👍</span>
                    <span className="text-[11px]">24 likes</span>
                  </div>
                  <span className="text-[11px]">4 comments</span>
                </div>
              </div>

              {/* Visual Concept & Honest Media Provider Status Card */}
              {activeJob?.selected_concept && (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                      AI Visual Specification
                    </h4>
                    {activeJob.media_result?.status === 'blocked_unconfigured' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        Setup Required: Image Engine
                      </span>
                    ) : activeJob.media_result?.status === 'generated' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Generated Image
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                        Evaluating
                      </span>
                    )}
                  </div>

                  {((activeJob.media_result as any)?.reason || activeJob.media_result?.error) && (
                    <p className="text-[11px] text-amber-900 bg-amber-50/80 border border-amber-100 rounded-lg p-2.5 leading-relaxed">
                      <span className="font-semibold">Provider Audit: </span>
                      {(activeJob.media_result as any)?.reason || activeJob.media_result?.error}
                    </p>
                  )}

                  {activeJob.generated_draft?.image_prompt && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-slate-700">Synthesized Image Prompt:</span>
                      <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono leading-relaxed max-h-24 overflow-y-auto">
                        {activeJob.generated_draft.image_prompt}
                      </div>
                    </div>
                  )}

                  {activeJob.generated_draft?.alt_text && (
                    <div className="text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">Accessibility Alt Text: </span>
                      {activeJob.generated_draft.alt_text}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        {/* ========================================================================= */}
        {/* TAB 3: CONNECTED ACCOUNTS                                                */}
        {/* ========================================================================= */}
        {activeTab === 'accounts' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
              <h3 className="text-base font-bold text-slate-900">Connected Social Channels</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Connect your business accounts to publish posts automatically through n8n orchestration.
                All tokens are encrypted with AES-256-GCM on the server and never exposed to client browsers.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {connections.map((p) => {
                const platform: SocialPlatform = p.platform;
                const isConnected = p.is_connected;
                const validation = p.configuration_validation;

                return (
                  <div
                    key={platform}
                    className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 flex flex-col justify-between space-y-4"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                            {getPlatformIcon(platform)}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900 capitalize">{platform}</h4>
                            <span className="text-[10px] text-slate-400">
                              {platform === 'facebook'
                                ? 'Facebook Pages API'
                                : platform === 'instagram'
                                ? 'Instagram Business Graph'
                                : 'Content Posting API v2'}
                            </span>
                          </div>
                        </div>

                        {isConnected ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> Connected
                          </span>
                        ) : validation.is_configured ? (
                          <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                            Ready to Connect
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                            Setup Required
                          </span>
                        )}
                      </div>

                      {/* Connection Details or Setup Guide */}
                      {isConnected && p.connection ? (
                        <div className="mt-4 p-3 rounded-xl bg-slate-50 text-xs text-slate-700 space-y-1">
                          <div>
                            <span className="font-semibold">Account:</span> {p.connection.account_name}
                          </div>
                          {p.connection.account_handle && (
                            <div className="text-slate-500">{p.connection.account_handle}</div>
                          )}
                          <div className="text-[11px] text-slate-400 pt-1">
                            Destinations:{' '}
                            {p.connection.selected_destinations?.length > 0
                              ? p.connection.selected_destinations[0].name
                              : 'Default feed'}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-2 text-xs text-slate-600">
                          <p className="leading-relaxed">{validation.setup_guide?.description}</p>
                          {validation.missing_keys?.length > 0 && (
                            <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 text-amber-800 text-[11px]">
                              <span className="font-bold">Missing Keys in .env.local:</span>{' '}
                              {validation.missing_keys.join(', ')}
                            </div>
                          )}
                          {validation.setup_guide?.doc_url && (
                            <a
                              href={validation.setup_guide.doc_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1 font-semibold text-[11px] pt-1"
                            >
                              Official Provider Setup Documentation <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                      {isConnected ? (
                        <button
                          onClick={() => handleDisconnect(platform)}
                          className="w-full py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors"
                        >
                          Disconnect Account
                        </button>
                      ) : (
                        <>
                          {validation.is_configured ? (
                            <a
                              href={`/api/social/connections/oauth/${platform}`}
                              className="w-full py-2 rounded-xl text-xs font-semibold text-center bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
                            >
                              Connect Live {platform.toUpperCase()}
                            </a>
                          ) : (
                            <button
                              disabled
                              className="w-full py-2 rounded-xl text-xs font-semibold text-center bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                            >
                              OAuth Setup Incomplete
                            </button>
                          )}

                          {/* Simulation connect option for sandbox testing */}
                          <button
                            onClick={() => handleConnectSimulation(platform)}
                            className="w-full py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 border border-slate-200 transition-colors"
                          >
                            Connect Sandbox / Simulation
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: BRAND & CONTENT SETTINGS                                          */}
        {/* ========================================================================= */}
        {activeTab === 'settings' && (
          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Autopilot & Publishing Settings</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure execution mode, posting cadence, voice, and media generation providers.
                </p>
              </div>

              {/* Server-Enforced Publishing Mode */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Publishing Environment & Guardrail</span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Controls whether n8n dispatches to live social APIs or realistic test sandboxes.
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${
                    summary?.effective_publishing_mode === 'live'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}>
                    {summary?.effective_publishing_mode === 'live' ? 'Armed for Live' : 'Simulated Pilot Sandbox'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div
                    onClick={() => setSettings(settings ? { ...settings, publishing_mode: 'simulation' } : null)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      settings?.publishing_mode === 'simulation'
                        ? 'border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        Simulation Sandbox (Recommended)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      All jobs run through complete n8n orchestration and generate valid platform payloads. Safe testing with zero external API calls or accidental publishing.
                    </p>
                  </div>

                  <div
                    onClick={() => setSettings(settings ? { ...settings, publishing_mode: 'live' } : null)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      settings?.publishing_mode === 'live'
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Unlock className="w-4 h-4 text-indigo-600" />
                        Live Platform Publishing
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Sends real payloads to Facebook, Instagram, and TikTok. Requires admin toggle, verified platform OAuth tokens, and server flag ENABLE_LIVE_SOCIAL_PUBLISHING=true.
                    </p>
                  </div>
                </div>

                {/* Guardrail explanation box */}
                <div className="text-xs p-3 rounded-xl bg-white border border-slate-200/90 text-slate-600 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-800">Server Safety Gate Status: </span>
                    {summary?.live_publishing_gate_enabled ? (
                      <span className="text-emerald-700 font-medium">ENABLE_LIVE_SOCIAL_PUBLISHING is enabled on server.</span>
                    ) : (
                      <span className="text-slate-600">
                        ENABLE_LIVE_SOCIAL_PUBLISHING is disabled (default). Even if set to Live, dispatches fall back safely to simulation until an administrator enables the server environment variable.
                      </span>
                    )}
                    {summary?.live_publishing_block_reason && (
                      <div className="text-amber-700 mt-0.5 font-medium text-[11px]">
                        Active restriction: {summary.live_publishing_block_reason}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Cadence Mode Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">Automation Mode</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div
                    onClick={() => setSettings(settings ? { ...settings, automation_mode: 'review_required' } : null)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      settings?.automation_mode === 'review_required'
                        ? 'border-indigo-600 bg-indigo-50/30 ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-slate-900">Review Before Posting</span>
                      <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      AI drafts content in the background. The business owner explicitly approves the exact content, media, and destination before anything is published.
                    </p>
                  </div>

                  <div
                    onClick={() => setSettings(settings ? { ...settings, automation_mode: 'autopilot' } : null)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      settings?.automation_mode === 'autopilot'
                        ? 'border-indigo-600 bg-indigo-50/30 ring-1 ring-indigo-600'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-slate-900">Autonomous Autopilot</span>
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      AI prepares and publishes content automatically according to your posting times and strict brand guardrails without requiring manual approval.
                    </p>
                  </div>
                </div>
              </div>

              {/* Recurring Schedule Days & Times */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                <div>
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Recurring Schedule Cadence</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select recurring days and posting hours. The background n8n scheduler prepares and publishes content in these exact slots.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Posting Days</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { num: 1, label: 'Mon' },
                      { num: 2, label: 'Tue' },
                      { num: 3, label: 'Wed' },
                      { num: 4, label: 'Thu' },
                      { num: 5, label: 'Fri' },
                      { num: 6, label: 'Sat' },
                      { num: 0, label: 'Sun' },
                    ].map((d) => {
                      const currentDays = settings?.posting_days || [1, 3, 5];
                      const isSelected = currentDays.includes(d.num);
                      return (
                        <button
                          key={d.num}
                          type="button"
                          onClick={() => {
                            if (!settings) return;
                            const nextDays = isSelected
                              ? currentDays.filter((x) => x !== d.num)
                              : [...currentDays, d.num];
                            setSettings({ ...settings, posting_days: nextDays.length > 0 ? nextDays : [1] });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Posting Times (HH:MM, comma-separated)
                    </label>
                    <input
                      type="text"
                      value={(settings?.posting_times || ['09:00', '14:00', '18:00']).join(', ')}
                      onChange={(e) => {
                        if (!settings) return;
                        const times = e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter((t) => /^\d{1,2}:\d{2}$/.test(t));
                        setSettings({ ...settings, posting_times: times.length > 0 ? times : ['10:00'] });
                      }}
                      placeholder="09:00, 14:00, 18:00"
                      className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Timezone</label>
                    <input
                      type="text"
                      value={settings?.timezone || 'UTC'}
                      onChange={(e) => setSettings(settings ? { ...settings, timezone: e.target.value } : null)}
                      className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Tone & Language */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Language</label>
                  <input
                    type="text"
                    value={settings?.language || 'English'}
                    onChange={(e) => setSettings(settings ? { ...settings, language: e.target.value } : null)}
                    className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Brand Voice & Tone</label>
                  <input
                    type="text"
                    value={settings?.tone || ''}
                    onChange={(e) => setSettings(settings ? { ...settings, tone: e.target.value } : null)}
                    placeholder="Authoritative, friendly, customer-centric"
                    className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                  />
                </div>
              </div>

              {/* Target Audience */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Audience</label>
                <input
                  type="text"
                  value={settings?.target_audience || ''}
                  onChange={(e) => setSettings(settings ? { ...settings, target_audience: e.target.value } : null)}
                  placeholder="Local property owners, homeowners, and commercial facilities"
                  className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                />
              </div>

              {/* Content Themes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Content Themes (comma-separated)
                </label>
                <input
                  type="text"
                  value={settings?.content_themes.join(', ') || ''}
                  onChange={(e) =>
                    setSettings(
                      settings
                        ? {
                            ...settings,
                            content_themes: e.target.value
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          }
                        : null
                    )
                  }
                  placeholder="Maintenance tips, Emergency advice, Behind-the-scenes"
                  className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                />
              </div>

              {/* Prohibited Topics */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Prohibited Topics (Safety Guardrails)
                </label>
                <input
                  type="text"
                  value={settings?.prohibited_topics.join(', ') || ''}
                  onChange={(e) =>
                    setSettings(
                      settings
                        ? {
                            ...settings,
                            prohibited_topics: e.target.value
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          }
                        : null
                    )
                  }
                  placeholder="Competitor mentions, Unverified discounts, Speculative guarantees"
                  className="w-full text-sm p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                />
              </div>

              {/* Media Providers & Capabilities Section */}
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Media Generation Capabilities & Providers</h4>
                    <p className="text-xs text-slate-500">
                      Visual assets attached to social posts. Text and short video scripts are generated automatically; media files rely on configured engines.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateBrandedCard}
                    disabled={isGeneratingCard}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isGeneratingCard ? 'animate-spin' : ''}`} />
                    {isGeneratingCard ? 'Generating Card...' : 'Generate Showcase Card'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(summary?.media_providers || []).map((provider) => (
                    <div
                      key={provider.id}
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            {provider.type === 'video' ? (
                              <Video className="w-4 h-4 text-purple-600" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-indigo-600" />
                            )}
                            {provider.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                              provider.is_ready
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {provider.is_ready ? 'Ready' : 'Setup Required'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          {provider.setup_guide?.description}
                        </p>
                      </div>

                      {provider.missing_keys.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-slate-100 text-[10px] text-amber-700 font-mono">
                          Missing: {provider.missing_keys.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-md transition-colors"
                >
                  Save Brand Settings
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: PUBLISHING ACTIVITY & AUDIT                                       */}
        {/* ========================================================================= */}
        {activeTab === 'activity' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Publishing Dispatches & n8n Executions</h3>
                  <p className="text-xs text-slate-500">
                    Correlated execution log with Job IDs, Post IDs, platform drivers, and simulation outcomes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadDashboardData}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>

              {jobs.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  No publishing jobs dispatched yet. As scheduled content becomes due, n8n claims and dispatches jobs here.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {jobs.map((job) => (
                    <div key={job.id} className="p-4 hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            job.status === 'published' || job.status === 'simulated'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : job.status === 'failed'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            {job.status.toUpperCase()}
                          </span>

                          <span className="text-xs font-mono font-bold text-slate-800">
                            Job #{job.id.slice(0, 8)}
                          </span>

                          <span className="text-xs text-slate-400">
                            Post #{job.post_id.slice(0, 8)}
                          </span>

                          <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                            {job.platform}
                          </span>

                          {job.is_simulated && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                              Simulated Driver
                            </span>
                          )}
                          {job.error_code && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                              {job.error_code}
                            </span>
                          )}
                        </div>

                        {job.provider_post_id && (
                          <div className="text-[11px] text-slate-500 font-mono">
                            Provider Ref: {job.provider_post_id} {job.is_simulated && '(Simulated - No Live Post Created)'}
                          </div>
                        )}

                        {job.error_message && (
                          <div className="text-xs text-rose-600 font-medium bg-rose-50/50 p-2 rounded-lg border border-rose-100">
                            {job.error_message}
                          </div>
                        )}
                      </div>

                      <div className="text-right text-xs shrink-0">
                        <div className="text-slate-500">
                          {new Date(job.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                        {job.last_attempt_at && (
                          <div className="text-[10px] text-slate-400">
                            Dispatched: {new Date(job.last_attempt_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Posts Audit Log */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Post Catalog & Approval Audit</h3>
                <p className="text-xs text-slate-500">
                  Approved content and review statuses across platforms.
                </p>
              </div>

              <div className="divide-y divide-slate-100">
                {posts.map((post) => (
                  <div key={post.id} className="p-4 flex items-center justify-between hover:bg-slate-50/50">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {getStatusBadge(post.status)}
                        <span className="text-xs font-bold text-slate-800">
                          Post #{post.id.slice(0, 8)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(post.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-1">{post.caption}</p>
                    </div>

                    <div className="text-right text-xs">
                      <div className="text-slate-500">
                        {post.is_approved ? (
                          <span className="text-emerald-600 font-semibold flex items-center gap-1 justify-end">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                          </span>
                        ) : (
                          <span className="text-amber-600 font-semibold">Unapproved</span>
                        )}
                      </div>
                      {post.published_at && (
                        <div className="text-[11px] text-slate-400">
                          Dispatched: {new Date(post.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
