'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Menu,
  Plus,
  RefreshCw,
  Building2,
  ChevronDown,
  Check,
  Store,
  Sparkles,
  Briefcase,
  BookOpen,
  ShoppingBag,
  ShieldCheck,
  AlertCircle,
  X,
} from 'lucide-react';
import { BusinessSummary } from '@/lib/types';

interface HeaderProps {
  businessName?: string;
  onOpenMobileNav?: () => void;
  onOpenCreateCase?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastRefreshed?: Date | null;
}

export function Header({
  businessName = 'Demo Clothing Store',
  onOpenMobileNav,
  onOpenCreateCase,
  onRefresh,
  isRefreshing = false,
  lastRefreshed,
}: HeaderProps) {
  const [mounted, setMounted] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([]);
  const [activeTenantId, setActiveTenantId] = useState('demo-store');
  const [userRole, setUserRole] = useState('owner');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBizName, setNewBizName] = useState('');
  const [newBizType, setNewBizType] = useState<'services' | 'ecommerce' | 'blog'>('services');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close workspace dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  // Support Escape key to close modal or dropdown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCreateModal) {
          setShowCreateModal(false);
          if (typeof window !== 'undefined' && window.location.search.includes('new_owner=true')) {
            window.history.replaceState({}, '', window.location.pathname);
          }
        } else if (dropdownOpen) {
          setDropdownOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCreateModal, dropdownOpen]);

  useEffect(() => {
    fetch('/api/auth/businesses')
      .then((r) => r.json())
      .then((data) => {
        if (data.businesses) {
          setBusinesses(data.businesses);
          setActiveTenantId(data.active_tenant_id || '');
          if (data.role) setUserRole(data.role);
          if (data.user_name) setUserName(data.user_name);
          if (data.email) setUserEmail(data.email);
          if (data.businesses.length === 0 || (typeof window !== 'undefined' && window.location.search.includes('new_owner=true'))) {
            setShowCreateModal(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleSwitchBusiness = async (tenantId: string) => {
    if (tenantId === activeTenantId) {
      setDropdownOpen(false);
      return;
    }

    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to switch workspace');
      }

      setActiveTenantId(tenantId);
      setDropdownOpen(false);
      window.location.reload();
    } catch (err: unknown) {
      setSwitchError(err instanceof Error ? err.message : 'Switching failed');
    } finally {
      setSwitching(false);
    }
  };

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBizName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/auth/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: newBizName.trim(),
          business_type: newBizType,
          industry: newBizType === 'ecommerce' ? 'ecommerce' : newBizType === 'blog' ? 'blog' : 'services',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create workspace');
      }

      setShowCreateModal(false);
      setNewBizName('');
      window.location.href = '/onboarding';
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setCreating(false);
    }
  };

  const currentBiz = businesses.find((b) => b.tenant_id === activeTenantId);
  const currentIndustry = currentBiz?.industry || 'services';

  const getTypeIcon = (ind?: string) => {
    switch (ind) {
      case 'services':
        return <Briefcase className="w-4 h-4 text-emerald-600" />;
      case 'blog':
        return <BookOpen className="w-4 h-4 text-amber-600" />;
      default:
        return <ShoppingBag className="w-4 h-4 text-indigo-600" />;
    }
  };

  return (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
        {/* Left: Mobile hamburger + Workspace Switcher */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="relative" ref={dropdownRef}>
            <button
              id="workspace-dropdown-btn"
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2.5 p-1 -m-1 rounded-xl hover:bg-slate-50 transition-colors text-left select-none cursor-pointer group"
              aria-expanded={dropdownOpen}
              aria-haspopup="true"
            >
              <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                {getTypeIcon(currentIndustry)}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-900 text-sm sm:text-base leading-tight">
                    {businessName}
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                    {currentIndustry}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition-colors" />
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Protected ({userRole})
                  </span>
                  {lastRefreshed && (
                    <>
                      <span className="text-slate-300">•</span>
                      <span className="hidden sm:inline text-[11px] text-slate-400">
                        Updated {lastRefreshed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </button>

            {/* Workspace Switcher Dropdown */}
            {dropdownOpen && (
              <div
                id="workspace-dropdown-menu"
                className="absolute left-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    My Workspaces
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {businesses.length} active
                  </span>
                </div>

                {switchError && (
                  <div className="m-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{switchError}</span>
                  </div>
                )}

                <div className="py-1 space-y-0.5 max-h-60 overflow-y-auto">
                  {businesses.map((b) => {
                    const isCurrent = b.tenant_id === activeTenantId;
                    return (
                      <button
                        key={b.tenant_id}
                        id={`workspace-item-${b.tenant_id}`}
                        type="button"
                        onClick={() => handleSwitchBusiness(b.tenant_id)}
                        disabled={switching}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors text-left cursor-pointer ${
                          isCurrent
                            ? 'bg-indigo-50 text-indigo-900 font-semibold'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="shrink-0">{getTypeIcon(b.industry)}</div>
                          <div className="truncate">
                            <div className="truncate font-medium">{b.business_name}</div>
                            <div className="text-[10px] text-slate-400 capitalize">
                              {b.industry || 'services'} • {b.role || 'member'}
                            </div>
                          </div>
                        </div>
                        {isCurrent && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <button
                    id="create-workspace-btn"
                    type="button"
                    onClick={() => {
                      setDropdownOpen(false);
                      setShowCreateModal(true);
                    }}
                    className="w-full flex items-center gap-2 p-2 rounded-xl text-indigo-600 hover:bg-indigo-50 font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create New Workspace</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              title="Refresh Assistant Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-600' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}

          <a
            href="/login"
            id="switch-owner-link"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-xs"
            title="Switch or Register Test Owner Account"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">{userName ? userName.split(' ')[0] : 'Owner'}</span>
            <span className="text-[10px] text-slate-400 font-normal">({userRole})</span>
          </a>

          {onOpenCreateCase && (
            <button
              type="button"
              onClick={onOpenCreateCase}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:bg-indigo-800 shadow-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Simulate Request</span>
            </button>
          )}
        </div>
      </div>

      {/* Create New Business Workspace Modal (Rendered via Portal to document.body to break free from header stacking context) */}
      {mounted && showCreateModal && createPortal(
        <div
          id="create-workspace-modal-backdrop"
          className="fixed inset-0 z-[100] overflow-y-auto flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreateModal(false);
              if (typeof window !== 'undefined' && window.location.search.includes('new_owner=true')) {
                window.history.replaceState({}, '', window.location.pathname);
              }
            }
          }}
        >
          <div
            id="create-workspace-modal-card"
            className="relative bg-white rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 sm:p-6 border-b border-slate-100 bg-white shrink-0">
              <div className="flex items-center gap-2.5 text-slate-900 font-bold text-base">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="leading-tight">Create Business Workspace</h3>
                  <p className="text-xs font-normal text-slate-500 mt-0.5">
                    Launch a dedicated, isolated workspace with independent settings & data.
                  </p>
                </div>
              </div>
              <button
                type="button"
                id="close-create-modal-btn"
                onClick={() => {
                  setShowCreateModal(false);
                  if (typeof window !== 'undefined' && window.location.search.includes('new_owner=true')) {
                    window.history.replaceState({}, '', window.location.pathname);
                  }
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleCreateBusiness} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
                {createError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{createError}</span>
                  </div>
                )}

                <div>
                  <label htmlFor="new-workspace-name-input" className="block font-semibold text-slate-700 mb-1.5">
                    Business Name *
                  </label>
                  <input
                    id="new-workspace-name-input"
                    type="text"
                    required
                    value={newBizName}
                    onChange={(e) => setNewBizName(e.target.value)}
                    placeholder="e.g. Apex Legal & Consulting"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-sm"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    Business Type *
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      id="type-services-btn"
                      onClick={() => setNewBizType('services')}
                      className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                        newBizType === 'services'
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <Briefcase className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
                      <div>Services</div>
                    </button>
                    <button
                      type="button"
                      id="type-ecommerce-btn"
                      onClick={() => setNewBizType('ecommerce')}
                      className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                        newBizType === 'ecommerce'
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <ShoppingBag className="w-4 h-4 mx-auto mb-1 text-indigo-600" />
                      <div>E-commerce</div>
                    </button>
                    <button
                      type="button"
                      id="type-publisher-btn"
                      onClick={() => setNewBizType('blog')}
                      className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                        newBizType === 'blog'
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <BookOpen className="w-4 h-4 mx-auto mb-1 text-amber-600" />
                      <div>Publisher</div>
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl text-indigo-900 text-[11px] leading-relaxed">
                  Workspace isolation ensures this organization will have its own private catalogs, business hours, inquiries, drafts, and customer channels.
                </div>
              </div>

              {/* Pinned Visible Footer with Cancel and Submit */}
              <div className="px-5 sm:px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  id="cancel-create-modal-btn"
                  onClick={() => {
                    setShowCreateModal(false);
                    if (typeof window !== 'undefined' && window.location.search.includes('new_owner=true')) {
                      window.history.replaceState({}, '', window.location.pathname);
                    }
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/70 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="submit-create-modal-btn"
                  disabled={creating || !newBizName.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 transition-all cursor-pointer"
                >
                  {creating ? 'Creating Workspace...' : 'Launch Workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
}
