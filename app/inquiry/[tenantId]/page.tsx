'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
  Building2,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Phone,
  Mail,
  User,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

export default function HostedInquiryPage() {
  const params = useParams();
  const tenantId = typeof params?.tenantId === 'string' ? params.tenantId : 'demo-store';

  const [businessName, setBusinessName] = useState(
    tenantId.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
  );
  const [industry, setIndustry] = useState<string>('services');
  const [businessType, setBusinessType] = useState<string>('services');
  const [loadingBusiness, setLoadingBusiness] = useState(true);
  const [formDisabled, setFormDisabled] = useState(false);
  const [availableServices, setAvailableServices] = useState<{ id: string; name: string }[]>([]);
  const [collectBudget, setCollectBudget] = useState(false);
  const [collectLocation, setCollectLocation] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [serviceInterest, setServiceInterest] = useState('');
  const [budgetRange, setBudgetRange] = useState('');
  const [location, setLocation] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState(''); // Hidden anti-spam field
  const [showEmbedInfo, setShowEmbedInfo] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submittedRefId, setSubmittedRefId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/inquiry/form-info?id=${encodeURIComponent(tenantId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.business_name) setBusinessName(data.business_name);
        if (data.business_type) setBusinessType(data.business_type);
        if (data.industry) setIndustry(data.industry);
        if (data.services && Array.isArray(data.services)) {
          setAvailableServices(data.services);
        }
        setCollectBudget(Boolean(data.collect_budget));
        setCollectLocation(Boolean(data.collect_location));
        if (data.hosted_inquiry_enabled === false) {
          setFormDisabled(true);
        }
      })
      .catch(() => {
        // Fallback to legacy business endpoint if form-info fails
        fetch(`/api/business?tenant=${encodeURIComponent(tenantId)}`)
          .then((r) => r.json())
          .then((data) => {
            if (active && data.business?.settings) {
              const settings = data.business.settings;
              if (settings.business_name) setBusinessName(settings.business_name);
              if (settings.industry) setIndustry(settings.industry);
              if (settings.connections?.website?.hosted_inquiry_enabled === false) {
                setFormDisabled(true);
              }
            }
          })
          .catch(() => {});
      })
      .finally(() => {
        if (active) setLoadingBusiness(false);
      });

    return () => {
      active = false;
    };
  }, [tenantId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/inquiry/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_form_id: tenantId,
          tenant_id: tenantId,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone || undefined,
          service_interest: serviceInterest || undefined,
          budget_range: budgetRange || undefined,
          location: location || undefined,
          subject: subject || (serviceInterest ? `Inquiry for ${serviceInterest}` : undefined),
          message: message,
          honeypot: honeypot || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to transmit inquiry.');
      }

      setSubmittedRefId(data.reference_id || 'INQ-' + Date.now().toString(36).toUpperCase());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const getIndustryBadge = () => {
    switch (industry) {
      case 'retail':
        return 'Retail Store Support';
      case 'services':
        return 'Professional Services Intake';
      case 'realestate':
        return 'Real Estate Client Desk';
      case 'healthcare_clinic':
        return 'Clinic Patient Inquiries';
      default:
        return 'Customer Support & Operations Portal';
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md text-center space-y-3">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20 ring-1 ring-white/20">
          <Building2 className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {businessName}
          </h1>
          <p className="text-xs text-blue-300/80 font-medium mt-0.5">
            {getIndustryBadge()}
          </p>
        </div>
      </div>

      <div className="relative z-10 mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-slate-800/90 backdrop-blur-md py-8 px-6 shadow-2xl rounded-3xl sm:px-10 border border-slate-700/80 space-y-6">
          {formDisabled ? (
            <div className="text-center py-8 space-y-3">
              <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
              <h3 className="text-base font-bold text-white">Inquiry Form Inactive</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {businessName} is not accepting inquiries through this link at this moment. Please contact the business directly.
              </p>
            </div>
          ) : submittedRefId ? (
            <div className="text-center space-y-5 py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">Inquiry Successfully Transmitted</h2>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Your message has been securely delivered to <span className="text-slate-200 font-medium">{businessName}</span>&apos;s team. A representative will respond to your email shortly.
                </p>
              </div>

              <div className="p-3.5 bg-slate-900/80 rounded-2xl border border-slate-700/80 text-xs font-mono text-slate-300">
                Tracking Reference: <span className="font-bold text-blue-400">{submittedRefId}</span>
              </div>

              <button
                type="button"
                id="submit-another-inquiry-btn"
                onClick={() => {
                  setSubmittedRefId(null);
                  setMessage('');
                  setSubject('');
                  setCustomerPhone('');
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Submit Another Inquiry</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Spam Honeypot Field (Hidden from humans) */}
              <div className="hidden" aria-hidden="true">
                <label htmlFor="hp_field">Leave this empty</label>
                <input
                  id="hp_field"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />
              </div>

              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-2 text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Customer Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Your Name <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                    <input
                      id="inquiry-customer-name"
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="e.g. Sarah Jenkins"
                      className="w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Email Address <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                    <input
                      id="inquiry-customer-email"
                      type="email"
                      required
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="e.g. sarah@example.com"
                      className="w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Optional Phone */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Phone Number <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                  <input
                    id="inquiry-customer-phone"
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="e.g. +1 555-0199"
                    className="w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Service of Interest (if available or services business) */}
              {availableServices.length > 0 ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Service Requested <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <select
                    id="inquiry-service-interest"
                    value={serviceInterest}
                    onChange={(e) => setServiceInterest(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                  >
                    <option value="">General Inquiry / Consultation</option>
                    {availableServices.map((svc) => (
                      <option key={svc.id} value={svc.name}>
                        {svc.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Service / Topic of Interest <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <input
                    id="inquiry-service-interest"
                    type="text"
                    value={serviceInterest}
                    onChange={(e) => setServiceInterest(e.target.value)}
                    placeholder="e.g. Residential Installation, Consulting"
                    className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              )}

              {/* Location & Budget if configured */}
              {(collectLocation || collectBudget) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {collectLocation && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Service Location / City
                      </label>
                      <input
                        id="inquiry-location"
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. Austin, TX"
                        className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                  )}

                  {collectBudget && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Estimated Budget
                      </label>
                      <input
                        id="inquiry-budget"
                        type="text"
                        value={budgetRange}
                        onChange={(e) => setBudgetRange(e.target.value)}
                        placeholder="e.g. $1,000 - $2,500"
                        className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Message Details */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  How can we help you? <span className="text-rose-400">*</span>
                </label>
                <textarea
                  id="inquiry-message"
                  rows={4}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Provide any details, questions, or project requirements regarding your request..."
                  className="w-full px-3.5 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden leading-relaxed"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  id="submit-inquiry-btn"
                  disabled={submitting || loadingBusiness}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending inquiry to team...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Transmit Inquiry to {businessName}</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400 text-center pt-2">
                <Sparkles className="w-3 h-3 text-blue-400" />
                <span>Protected by rate-limiting & automated spam filters</span>
              </div>
            </form>
          )}
        </div>

        {/* Developer Integration & Embed Info */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setShowEmbedInfo(!showEmbedInfo)}
            className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors underline cursor-pointer"
          >
            {showEmbedInfo ? 'Hide developer integration instructions' : 'Developer integration instructions (Embed on website)'}
          </button>

          {showEmbedInfo && (
            <div className="mt-3 p-4 bg-slate-800/80 rounded-2xl border border-slate-700/80 text-left space-y-2">
              <div className="text-xs font-semibold text-slate-200">
                Embed this form on your website:
              </div>
              <pre className="p-2.5 bg-slate-900 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto select-all">
                {`<iframe src="${typeof window !== 'undefined' ? window.location.href : `/inquiry/${tenantId}`}" width="100%" height="650" frameborder="0"></iframe>`}
              </pre>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Note: A hosted form link alone does not connect a client&apos;s existing website. Embed this snippet directly into your website&apos;s HTML to capture leads and customer messages directly into your AI Operator inbox.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
