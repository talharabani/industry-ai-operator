'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/AppLayout';
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  ShieldAlert,
  Globe,
  Briefcase,
  ShoppingBag,
  BookOpen,
  Clock,
  MapPin,
  Mail,
  Copy,
  Check,
  AlertCircle,
  ExternalLink,
  Plus,
  Trash2,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import { BusinessType, ServiceItem, ServiceAreaItem, ExtractedFactItem } from '@/lib/types';

const STEPS = [
  { id: 1, title: 'Profile', subtitle: 'Basic business info' },
  { id: 2, title: 'Business Type', subtitle: 'Select capability pack' },
  { id: 3, title: 'Connections', subtitle: 'Inquiry forms & channels' },
  { id: 4, title: 'Knowledge', subtitle: 'Services, hours & areas' },
  { id: 5, title: 'Automation', subtitle: 'Guardrails & routine rules' },
  { id: 6, title: 'Readiness', subtitle: 'Summary & launch' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Form State
  const [businessName, setBusinessName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [language, setLanguage] = useState('en');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('services');
  const [automationMode, setAutomationMode] = useState('auto_routine');
  const [enableFollowup, setEnableFollowup] = useState(false);
  const [publicFormId, setPublicFormId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');

  // Knowledge State
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceAreaItem[]>([]);
  const [extractedFacts, setExtractedFacts] = useState<ExtractedFactItem[]>([]);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState('');

  // New service modal form
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDesc, setNewServiceDesc] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceType, setNewServiceType] = useState<'fixed' | 'starting_at' | 'quote_required'>('starting_at');

  // New service area form
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaType, setNewAreaType] = useState<'city' | 'zip' | 'region'>('city');

  // Working Hours & Policies State
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('18:00');
  const [workingDays, setWorkingDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [generalPolicy, setGeneralPolicy] = useState('Emergency repairs available during working hours. Quotes are valid for 30 days and require owner approval.');
  const [cancellationHours, setCancellationHours] = useState<number>(24);

  const fetchOnboardingData = useCallback(async () => {
    setLoading(true);
    try {
      const [onboardRes, bizRes] = await Promise.all([
        fetch('/api/business/onboarding', { cache: 'no-store' }),
        fetch('/api/business', { cache: 'no-store' }),
      ]);

      if (onboardRes.ok) {
        const oData = await onboardRes.json();
        setTenantId(oData.tenant_id || '');
        setPublicFormId(oData.public_form_id || '');
        if (oData.onboarding?.step) {
          setStep(oData.onboarding.step);
        }
      }

      if (bizRes.ok) {
        const bData = await bizRes.json();
        const settings = bData.business?.settings || {};
        setBusinessName(settings.business_name || '');
        setWebsiteUrl(settings.website_url || '');
        setTimezone(settings.timezone || 'America/New_York');
        setLanguage(settings.language || 'en');
        setContactEmail(settings.contact_email || settings.support_email || '');
        setContactPhone(settings.contact_phone || '');
        setBusinessType(settings.business_type || (settings.industry === 'services' ? 'services' : 'ecommerce'));
        setAutomationMode(settings.automation_mode || 'auto_routine');
        setEnableFollowup(settings.services_config?.enable_customer_followup ?? false);

        setServices(settings.knowledge?.services || []);
        setServiceAreas(settings.knowledge?.service_areas || []);
        setExtractedFacts(settings.knowledge?.extracted_facts || []);

        if (settings.working_hours) {
          if (settings.working_hours.start_time) setStartTime(settings.working_hours.start_time);
          if (settings.working_hours.end_time) setEndTime(settings.working_hours.end_time);
          if (Array.isArray(settings.working_hours.days)) setWorkingDays(settings.working_hours.days);
        }
        if (settings.knowledge?.policies) {
          if (settings.knowledge.policies.general_rules) setGeneralPolicy(settings.knowledge.policies.general_rules);
          if (settings.knowledge.policies.cancellation_notice_hours) setCancellationHours(Number(settings.knowledge.policies.cancellation_notice_hours));
        }

        if (bData.business?.gmail_connection?.google_email) {
          setGmailConnected(true);
          setGmailEmail(bData.business.gmail_connection.google_email);
        }
      }
    } catch (err) {
      console.error('Failed to load onboarding info', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnboardingData();
  }, [fetchOnboardingData]);

  const saveCurrentStep = async (nextStep: number, complete = false) => {
    setSaving(true);
    setErrorMsg('');
    try {
      const payload: any = {
        step: nextStep,
        completed: complete,
        business_name: businessName,
        website_url: websiteUrl,
        timezone,
        language,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        business_type: businessType,
        industry: businessType === 'services' ? 'services' : businessType === 'blog' ? 'blog' : 'ecommerce',
        automation_mode: automationMode,
        services_config: {
          enable_customer_followup: enableFollowup,
          require_quote_approval: true,
        },
        working_hours: {
          start_time: startTime,
          end_time: endTime,
          days: workingDays,
          auto_reply_outside_hours: true,
        },
        policies: {
          general_rules: generalPolicy,
          cancellation_notice_hours: cancellationHours,
        },
      };

      const res = await fetch('/api/business/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save onboarding');
      }

      setStep(nextStep);
      if (complete) {
        router.push(businessType === 'services' ? '/leads' : '/');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error saving changes');
    } finally {
      setSaving(false);
    }
  };

  const handleImportWebsite = async () => {
    if (!importUrl) return;
    setIsImporting(true);
    setImportNotice('');
    try {
      const res = await fetch('/api/business/knowledge/import-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to extract facts');
      }
      setImportNotice(`Successfully parsed page. Extracted ${data.extracted_count} pending facts for your review.`);
      // Refresh business facts
      fetchOnboardingData();
    } catch (err: any) {
      setImportNotice(`Extraction failed: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleFactDecision = async (factId: string, decision: 'approve' | 'reject') => {
    try {
      const res = await fetch('/api/business/knowledge/facts/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact_id: factId, decision }),
      });
      if (res.ok) {
        setExtractedFacts((prev) =>
          prev.map((f) => (f.id === factId ? { ...f, status: decision === 'approve' ? 'approved' : 'rejected' } : f))
        );
      }
    } catch (err) {
      console.error('Fact decision error', err);
    }
  };

  const handleAddService = async () => {
    if (!newServiceName.trim()) return;
    try {
      const res = await fetch('/api/business/knowledge/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newServiceName.trim(),
          description: newServiceDesc.trim(),
          price_type: newServiceType,
          base_price: newServicePrice ? Number(newServicePrice) : undefined,
          approval_status: 'approved',
        }),
      });
      if (res.ok) {
        setNewServiceName('');
        setNewServiceDesc('');
        setNewServicePrice('');
        fetchOnboardingData();
      }
    } catch (err) {
      console.error('Error adding service', err);
    }
  };

  const handleAddArea = async () => {
    if (!newAreaName.trim()) return;
    try {
      const res = await fetch('/api/business/knowledge/service-areas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAreaName.trim(),
          area_type: newAreaType,
          supported: true,
        }),
      });
      if (res.ok) {
        setNewAreaName('');
        fetchOnboardingData();
      }
    } catch (err) {
      console.error('Error adding area', err);
    }
  };

  const publicLink = typeof window !== 'undefined'
    ? `${window.location.origin}/inquiry/${publicFormId || tenantId}`
    : `/inquiry/${publicFormId || tenantId}`;

  const embedSnippet = `<iframe src="${publicLink}" width="100%" height="650" frameborder="0"></iframe>`;

  const copyToClipboard = (text: string, isEmbed = false) => {
    navigator.clipboard.writeText(text);
    if (isEmbed) {
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8 pb-16">
        {/* Stepper Header */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                Workspace Onboarding & Capability Setup
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Configure your business profile, service catalog, inquiry capture, and AI guardrails.
              </p>
            </div>
            <div className="text-xs font-semibold px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 self-start md:self-auto">
              Step {step} of 6
            </div>
          </div>

          {/* Stepper Track */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {STEPS.map((s) => {
              const isDone = s.id < step;
              const isCurrent = s.id === step;
              return (
                <button
                  key={s.id}
                  onClick={() => s.id <= step && setStep(s.id)}
                  className={`flex flex-col p-2.5 rounded-xl border text-left transition-all ${
                    isCurrent
                      ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
                      : isDone
                      ? 'border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer'
                      : 'border-slate-100 bg-white opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : isCurrent ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-600 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                      </div>
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-slate-300" />
                    )}
                    <span
                      className={`text-xs font-bold ${
                        isCurrent ? 'text-indigo-900' : isDone ? 'text-slate-800' : 'text-slate-400'
                      }`}
                    >
                      {s.title}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 truncate">{s.subtitle}</span>
                </button>
              );
            })}
          </div>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Step 1: Business Profile */}
        {step === 1 && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Step 1: Business Profile</h2>
              <p className="text-xs text-slate-500 mt-1">
                Tell us about your organization and preferred regional settings.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700 block mb-1">Business Name *</label>
                <input
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Apex Electrical & Lighting"
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700 block mb-1">Public Website URL</label>
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://www.example.com"
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <div className="mt-2 p-3 rounded-lg bg-amber-50/70 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
                  <strong>Important Notice:</strong> Adding your website URL enables public page fact extraction for your approval. It does <em>not</em> grant access to private orders, internal inbox messages, or private analytics.
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Timezone *</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="America/New_York">Eastern Time (America/New_York)</option>
                  <option value="America/Chicago">Central Time (America/Chicago)</option>
                  <option value="America/Denver">Mountain Time (America/Denver)</option>
                  <option value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</option>
                  <option value="Europe/London">London (Europe/London)</option>
                  <option value="Asia/Kolkata">India (Asia/Kolkata)</option>
                  <option value="UTC">UTC Universal</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="en">English (en)</option>
                  <option value="es">Spanish (es)</option>
                  <option value="fr">French (fr)</option>
                  <option value="de">German (de)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Contact Email *</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="support@example.com"
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Contact Phone</label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                disabled={!businessName.trim() || saving}
                onClick={() => saveCurrentStep(2)}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                Continue to Business Type <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Business Type & Pack */}
        {step === 2 && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Step 2: Business Type & Capability Pack</h2>
              <p className="text-xs text-slate-500 mt-1">
                Select your primary business model to tailor navigation and automation pipelines.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Services Pack */}
              <div
                onClick={() => setBusinessType('services')}
                className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
                  businessType === 'services'
                    ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center mb-4">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Services</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Tailored for contractors, agencies, maintenance, healthcare, and consultants.
                </p>
                <ul className="text-[11px] text-slate-500 mt-3 space-y-1">
                  <li>• Hosted Inquiry Form & Embeds</li>
                  <li>• Services Lead Pipeline & Stages</li>
                  <li>• Service Area & Catalog Matching</li>
                  <li>• Automated Follow-Up Guards</li>
                </ul>
              </div>

              {/* E-Commerce Pack */}
              <div
                onClick={() => setBusinessType('ecommerce')}
                className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
                  businessType === 'ecommerce'
                    ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center mb-4">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">E-Commerce</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                    Active
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Tailored for online retailers, direct-to-consumer brands, and Shopify stores.
                </p>
                <ul className="text-[11px] text-slate-500 mt-3 space-y-1">
                  <li>• Shopify & Custom Store Sync</li>
                  <li>• Order Lookup & Tracking</li>
                  <li>• Return/Refund Approval Gates</li>
                  <li>• Inventory & Product FAQs</li>
                </ul>
              </div>

              {/* Blog / Publisher */}
              <div
                onClick={() => setBusinessType('blog')}
                className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
                  businessType === 'blog'
                    ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-slate-600 text-white flex items-center justify-center mb-4">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Blog / Publisher</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                    Not configured
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Tailored for digital publications, content creators, and media companies.
                </p>
                <ul className="text-[11px] text-slate-500 mt-3 space-y-1">
                  <li>• Reader Inquiry Capture</li>
                  <li>• Content FAQs & Topic Routing</li>
                  <li>• Blog Analytics: <em>Coming soon</em></li>
                  <li>• Social Publishing: <em>Coming soon</em></li>
                </ul>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => saveCurrentStep(3)}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                Continue to Connections <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Relevant Connections */}
        {step === 3 && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Step 3: Inquiry Capture & Connections</h2>
              <p className="text-xs text-slate-500 mt-1">
                Connect channels to capture inquiries directly into your unified workspace inbox.
              </p>
            </div>

            {/* Hosted Inquiry Form Link */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-indigo-600" />
                    Dedicated Hosted Inquiry Form
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Your unique public link. Share with clients or link from your website.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  Ready & Active
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={publicLink}
                  className="flex-1 text-xs p-2.5 rounded-xl border border-slate-200 bg-white font-mono text-slate-700 select-all"
                />
                <button
                  onClick={() => copyToClipboard(publicLink)}
                  className="px-3.5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shrink-0"
                >
                  {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedLink ? 'Copied' : 'Copy Link'}
                </button>
                <a
                  href={publicLink}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Open Form"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              {/* Developer Embed Snippet */}
              <div className="pt-3 border-t border-slate-200/60">
                <div className="text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span>Website Developer Embed Code (iFrame)</span>
                  <button
                    onClick={() => copyToClipboard(embedSnippet, true)}
                    className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 font-medium"
                  >
                    {copiedEmbed ? 'Copied Snippet!' : 'Copy Snippet'}
                  </button>
                </div>
                <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto">
                  {embedSnippet}
                </pre>
                <p className="text-[11px] text-slate-500 mt-1">
                  Note: A hosted form link alone does not connect your website backend. Paste this snippet onto your Contact page to capture customer inquiries directly into your Leads workspace.
                </p>
              </div>
            </div>

            {/* Other Channel Integrations */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Gmail Sync */}
              <div className="p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-red-500" />
                    Gmail Workspace Sync
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {gmailConnected ? `Connected (${gmailEmail})` : 'Not connected'}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    gmailConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {gmailConnected ? 'Connected' : 'Available in Settings'}
                </span>
              </div>

              {/* WhatsApp Business */}
              <div className="p-4 rounded-xl border border-slate-200 flex items-center justify-between opacity-70">
                <div>
                  <div className="text-xs font-bold text-slate-900">WhatsApp Business Channel</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Direct messaging channel</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                  Coming soon
                </span>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => saveCurrentStep(4)}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                Continue to Knowledge <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Services Knowledge */}
        {step === 4 && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Step 4: Services Knowledge & Catalog</h2>
              <p className="text-xs text-slate-500 mt-1">
                Provide approved services, operating hours, and service locations. The AI will only use facts approved by you.
              </p>
            </div>

            {/* SSRF-Safe Website Importer */}
            <div className="p-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 space-y-3">
              <h3 className="text-xs font-bold text-indigo-950 flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-600" />
                Import Facts from Your Public Website
              </h3>
              <p className="text-[11px] text-indigo-900/80 leading-relaxed">
                Scan your public about/services page. Extracted business facts are strictly held as <strong>Pending Review</strong> until you approve them. Website text is treated as untrusted data; we never invent prices or project timelines.
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://yourwebsite.com/services"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  className="flex-1 text-xs p-2.5 rounded-xl border border-indigo-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  disabled={!importUrl.trim() || isImporting}
                  onClick={handleImportWebsite}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isImporting ? 'animate-spin' : ''}`} />
                  {isImporting ? 'Extracting...' : 'Scan Page'}
                </button>
              </div>
              {importNotice && (
                <div className="text-xs font-medium text-indigo-950 bg-white p-2.5 rounded-lg border border-indigo-200">
                  {importNotice}
                </div>
              )}
            </div>

            {/* Extracted Facts Review Section */}
            {extractedFacts.length > 0 && (
              <div className="p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Extracted Facts Review ({extractedFacts.filter((f) => f.approval_status === 'pending_review').length} pending)
                  </h3>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {extractedFacts.map((fact) => (
                    <div
                      key={fact.id}
                      className="p-3 rounded-lg border border-slate-100 bg-slate-50/60 flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-900 capitalize">{fact.fact_type} Fact:</div>
                        <p className="text-slate-600 mt-0.5">{fact.raw_text}</p>
                        <span className="text-[10px] text-slate-400 mt-1 block">
                          Status: <strong className="capitalize">{fact.approval_status.replace(/_/g, ' ')}</strong>
                        </span>
                      </div>
                      {fact.approval_status === 'pending_review' && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleFactDecision(fact.id, 'approve')}
                            className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleFactDecision(fact.id, 'reject')}
                            className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approved Services Catalog */}
            <div className="p-4 rounded-xl border border-slate-200 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
                <span>Services Catalog ({services.length})</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {services.map((svc) => (
                  <div key={svc.id} className="p-3 rounded-xl border border-slate-200 bg-white space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">{svc.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                        Approved
                      </span>
                    </div>
                    {svc.description && (
                      <p className="text-[11px] text-slate-500 line-clamp-2">{svc.description}</p>
                    )}
                    <div className="text-[11px] text-slate-700 font-medium pt-1">
                      {svc.price_type === 'quote_required'
                        ? 'Custom Quote Required'
                        : svc.price_type === 'starting_at'
                        ? `Starts at $${svc.price || 0}`
                        : `$${svc.price || 0}`}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Service Sub-Form */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-xs font-semibold text-slate-700 block">Add New Service</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Service Name (e.g. Panel Upgrade)"
                    value={newServiceName}
                    onChange={(e) => setNewServiceName(e.target.value)}
                    className="text-xs p-2 rounded-lg border border-slate-200 bg-white"
                  />
                  <select
                    value={newServiceType}
                    onChange={(e: any) => setNewServiceType(e.target.value)}
                    className="text-xs p-2 rounded-lg border border-slate-200 bg-white"
                  >
                    <option value="starting_at">Starting At Price</option>
                    <option value="fixed">Fixed Price</option>
                    <option value="quote_required">Quote Required</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Base Price ($)"
                    value={newServicePrice}
                    onChange={(e) => setNewServicePrice(e.target.value)}
                    className="text-xs p-2 rounded-lg border border-slate-200 bg-white"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Short description of what is included..."
                  value={newServiceDesc}
                  onChange={(e) => setNewServiceDesc(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 bg-white"
                />
                <button
                  disabled={!newServiceName.trim()}
                  onClick={handleAddService}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  Save Service
                </button>
              </div>
            </div>

            {/* Service Areas */}
            <div className="p-4 rounded-xl border border-slate-200 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Service Areas & Coverage
              </h3>
              <div className="flex flex-wrap gap-2">
                {serviceAreas.map((area) => (
                  <span
                    key={area.id}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-medium flex items-center gap-1.5"
                  >
                    <MapPin className="w-3 h-3 text-indigo-500" />
                    {area.name} ({area.type || 'region'})
                  </span>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  placeholder="Add city or zip code (e.g. Austin, 78701)"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  className="flex-1 text-xs p-2 rounded-lg border border-slate-200"
                />
                <button
                  disabled={!newAreaName.trim()}
                  onClick={handleAddArea}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  Add Area
                </button>
              </div>
            </div>

            {/* Working Hours Configuration */}
            <div className="p-4 rounded-xl border border-slate-200 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                Working Hours & Availability
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Operating Start Time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Operating End Time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">Active Days</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'mon', label: 'Mon' },
                    { id: 'tue', label: 'Tue' },
                    { id: 'wed', label: 'Wed' },
                    { id: 'thu', label: 'Thu' },
                    { id: 'fri', label: 'Fri' },
                    { id: 'sat', label: 'Sat' },
                    { id: 'sun', label: 'Sun' },
                  ].map((d) => {
                    const active = workingDays.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          setWorkingDays(
                            active ? workingDays.filter((x) => x !== d.id) : [...workingDays, d.id]
                          );
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Service Policies */}
            <div className="p-4 rounded-xl border border-slate-200 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-indigo-600" />
                Service Policies & Terms
              </h3>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">General Rules & Estimates Policy</label>
                <textarea
                  rows={2}
                  value={generalPolicy}
                  onChange={(e) => setGeneralPolicy(e.target.value)}
                  placeholder="e.g. Estimates valid for 30 days. Emergency callouts have a dispatch fee."
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Cancellation Notice (Hours)</label>
                <input
                  type="number"
                  value={cancellationHours}
                  onChange={(e) => setCancellationHours(Number(e.target.value))}
                  className="w-32 text-xs p-2.5 rounded-xl border border-slate-200 bg-white"
                />
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => saveCurrentStep(5)}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                Continue to Automation <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Automation Preferences */}
        {step === 5 && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Step 5: Automation Preferences & Guardrails</h2>
              <p className="text-xs text-slate-500 mt-1">
                Configure when the AI can reply automatically versus when it must draft for review.
              </p>
            </div>

            {/* Routine Mode Selector */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                Operating Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    key: 'auto_routine',
                    title: 'Auto-Routine',
                    badge: 'Recommended',
                    desc: 'Instantly answers approved catalog & hours. Clarifies missing details. Holds quotes for review.',
                  },
                  {
                    key: 'draft_only',
                    title: 'Draft Only',
                    badge: 'Manual Review',
                    desc: 'AI drafts every response but requires operator approval before sending.',
                  },
                  {
                    key: 'paused',
                    title: 'Paused',
                    badge: 'Suspended',
                    desc: 'Automated response generation is turned off entirely.',
                  },
                ].map((m) => (
                  <div
                    key={m.key}
                    onClick={() => setAutomationMode(m.key)}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      automationMode === m.key
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-900">{m.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-700">
                        {m.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{m.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer Follow-Up Toggle */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Customer Follow-Up Automation</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Orchestrated via n8n worker. Disabled by default until explicitly enabled.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEnableFollowup(!enableFollowup)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    enableFollowup ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      enableFollowup ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 italic">
                Follow-ups are automatically cancelled if the customer replies, opts out, closes the lead, or if you activate manual takeover.
              </p>
            </div>

            {/* Guardrails Callout */}
            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                Immutable Safety Guardrails
              </div>
              <ul className="text-[11px] text-amber-800 space-y-1 list-disc pl-4">
                <li>Quotes, estimates, discounts, and contractual promises strictly require owner review.</li>
                <li>Leads are never marked Won automatically by AI interpretation.</li>
                <li>Website imports are treated as untrusted text and require explicit merchant sign-off.</li>
              </ul>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={() => setStep(4)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => saveCurrentStep(6)}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                Continue to Readiness <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 6: Readiness Summary */}
        {step === 6 && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Step 6: Readiness Summary</h2>
              <p className="text-xs text-slate-500 mt-1">
                Review your configuration before launching your AI Operator workspace.
              </p>
            </div>

            {/* Checklist Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-slate-500">Business Profile</div>
                <div className="text-sm font-bold text-slate-900">{businessName}</div>
                <div className="text-xs text-slate-600">{contactEmail || 'No email configured'}</div>
                <div className="text-xs text-slate-500">{timezone} • {language.toUpperCase()}</div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-slate-500">Capability Pack</div>
                <div className="text-sm font-bold text-slate-900 capitalize">{businessType} Pack</div>
                <div className="text-xs text-slate-600">
                  Mode: <strong className="capitalize">{automationMode.replace(/_/g, ' ')}</strong>
                </div>
                <div className="text-xs text-slate-500">
                  Follow-ups: {enableFollowup ? 'Enabled' : 'Disabled (Default)'}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-slate-500">Services & Areas</div>
                <div className="text-sm font-bold text-slate-900">{services.length} Approved Services</div>
                <div className="text-xs text-slate-600">{serviceAreas.length} Service Areas configured</div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-slate-500">Inquiry Channel</div>
                <div className="text-sm font-bold text-slate-900">Hosted Inquiry Form Active</div>
                <div className="text-xs text-slate-600 truncate font-mono text-[11px]">{publicLink}</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>
                Your workspace is ready. You can adjust your services, knowledge base, and guardrails at any time in Settings.
              </span>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={() => setStep(5)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                disabled={saving}
                onClick={() => saveCurrentStep(6, true)}
                className="px-8 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-sm"
              >
                {saving ? 'Completing Setup...' : 'Complete Onboarding & Enter Workspace'} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
