'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Inbox,
  CheckCircle2,
  Settings,
  Sparkles,
  Bot,
  Users,
  ClipboardCheck,
  Share2,
} from 'lucide-react';

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  pendingCount?: number;
  unreadInboxCount?: number;
  leadCount?: number;
  businessType?: string;
  onboardingIncomplete?: boolean;
}

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home, exact: true },
  { href: '/inbox', label: 'Inbox', icon: Inbox, badgeKey: 'inbox' },
  { href: '/approvals', label: 'Approvals', icon: CheckCircle2, badgeKey: 'pending' },
  { href: '/social', label: 'Social Media', icon: Share2 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  mobileOpen = false,
  onCloseMobile,
  pendingCount = 0,
  unreadInboxCount = 0,
  leadCount = 0,
  businessType = 'ecommerce',
  onboardingIncomplete = false,
}: SidebarProps) {
  const pathname = usePathname();

  const isItemActive = (href: string, exact?: boolean) => {
    if (exact) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const isServices = businessType === 'services';

  const navItems = [
    { href: '/', label: 'Home', icon: Home, exact: true },
    ...(isServices
      ? [{ href: '/leads', label: 'Leads', icon: Users, badgeKey: 'leads' }]
      : []),
    { href: '/inbox', label: 'Inbox', icon: Inbox, badgeKey: 'inbox' },
    { href: '/approvals', label: 'Approvals', icon: CheckCircle2, badgeKey: 'pending' },
    { href: '/social', label: 'Social Media', icon: Share2 },
    { href: '/onboarding', label: 'Onboarding', icon: ClipboardCheck, badgeKey: 'onboarding' },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  const navContent = (
    <div className="flex flex-col h-full bg-white text-slate-900 border-r border-slate-200 select-none">
      {/* Brand & Assistant Header */}
      <div className="p-5 border-b border-slate-100">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/20 group-hover:bg-indigo-700 transition-colors">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 tracking-tight">
              AI Operator
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {isServices ? 'Services Engine Active' : 'Auto-Reply Active'}
            </div>
          </div>
        </Link>
      </div>

      {/* Main Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          {isServices ? 'Services Workspace' : 'Merchant Workspace'}
        </div>
        {navItems.map((item) => {
          const active = isItemActive(item.href, item.exact);
          const Icon = item.icon;
          const showPendingBadge = item.badgeKey === 'pending' && pendingCount > 0;
          const showInboxBadge = item.badgeKey === 'inbox' && (unreadInboxCount ?? 0) > 0;
          const showLeadBadge = item.badgeKey === 'leads' && leadCount > 0;
          const showOnboardingBadge = item.badgeKey === 'onboarding' && onboardingIncomplete;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${active ? 'text-indigo-600' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {showPendingBadge && (
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full font-bold ${
                      active
                        ? 'bg-amber-500 text-white'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
                {showInboxBadge && (
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full font-bold ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                    }`}
                  >
                    {unreadInboxCount}
                  </span>
                )}
                {showLeadBadge && (
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full font-bold ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-100 text-blue-700 border border-blue-200'
                    }`}
                  >
                    {leadCount}
                  </span>
                )}
                {showOnboardingBadge && (
                  <span
                    className="w-2 h-2 rounded-full bg-amber-500"
                    title="Setup incomplete"
                  />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Assistant Status Summary Card in Sidebar Footer */}
      <div className="p-4 m-3 rounded-xl bg-slate-50 border border-slate-200/80">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-800 mb-1">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            Guardrails
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
            ENFORCED
          </span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          {isServices
            ? 'Quotes, custom pricing, commitments and unapproved services strictly require owner approval.'
            : 'Refunds, exchanges, and cancellations are strictly held for your approval.'}
        </p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop fixed sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 z-30">
        {navContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white z-10 shadow-2xl">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}

