'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CreateCaseModal } from './CreateCaseModal';
import { SummaryStats } from '@/lib/types';

interface AppLayoutProps {
  children: React.ReactNode;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function AppLayout({ children, onRefresh, isRefreshing }: AppLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [createCaseModalOpen, setCreateCaseModalOpen] = useState(false);
  const [businessName, setBusinessName] = useState('Demo Clothing Store');
  const [businessType, setBusinessType] = useState('ecommerce');
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [leadCount, setLeadCount] = useState<number>(0);
  const [onboardingIncomplete, setOnboardingIncomplete] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchGlobalMetadata = useCallback(async () => {
    try {
      const [summaryRes, bizRes, leadsRes] = await Promise.all([
        fetch('/api/summary', { cache: 'no-store' }),
        fetch('/api/business', { cache: 'no-store' }),
        fetch('/api/services/leads?limit=1', { cache: 'no-store' }),
      ]);

      if (summaryRes.ok) {
        const summary: SummaryStats = await summaryRes.json();
        setPendingCount(summary.pending_approvals_all_time || 0);
      }

      if (bizRes.ok) {
        const bizData = await bizRes.json();
        if (bizData.business?.settings?.business_name) {
          setBusinessName(bizData.business.settings.business_name);
        }
        const bType = bizData.business?.business_type || (bizData.business?.settings?.industry === 'services' ? 'services' : 'ecommerce');
        setBusinessType(bType);
        const ob = bizData.business?.onboarding;
        setOnboardingIncomplete(ob ? !ob.completed : false);
      }

      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        setLeadCount(leadsData.counts?.new || leadsData.total || 0);
      }

      setLastRefreshed(new Date());
    } catch {
      // Ignore network errors on background fetch
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [summaryRes, bizRes, leadsRes] = await Promise.all([
          fetch('/api/summary', { cache: 'no-store' }),
          fetch('/api/business', { cache: 'no-store' }),
          fetch('/api/services/leads?limit=1', { cache: 'no-store' }),
        ]);
        if (!active) return;

        if (summaryRes.ok) {
          const summary: SummaryStats = await summaryRes.json();
          if (active) setPendingCount(summary.pending_approvals_all_time || 0);
        }

        if (bizRes.ok) {
          const bizData = await bizRes.json();
          if (active) {
            if (bizData.business?.settings?.business_name) {
              setBusinessName(bizData.business.settings.business_name);
            }
            const bType = bizData.business?.business_type || (bizData.business?.settings?.industry === 'services' ? 'services' : 'ecommerce');
            setBusinessType(bType);
            const ob = bizData.business?.onboarding;
            setOnboardingIncomplete(ob ? !ob.completed : false);
          }
        }

        if (leadsRes.ok && active) {
          const leadsData = await leadsRes.json();
          setLeadCount(leadsData.counts?.new || leadsData.total || 0);
        }

        if (active) setLastRefreshed(new Date());
      } catch {
        // Ignore background fetch error
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const handleManualRefresh = () => {
    fetchGlobalMetadata();
    if (onRefresh) {
      onRefresh();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Sidebar */}
      <Sidebar
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        pendingCount={pendingCount}
        leadCount={leadCount}
        businessType={businessType}
        onboardingIncomplete={onboardingIncomplete}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:pl-64 min-w-0">
        <Header
          businessName={businessName}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenCreateCase={() => setCreateCaseModalOpen(true)}
          onRefresh={handleManualRefresh}
          isRefreshing={isRefreshing}
          lastRefreshed={lastRefreshed}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Create Demo Case Modal */}
      <CreateCaseModal
        isOpen={createCaseModalOpen}
        onClose={() => setCreateCaseModalOpen(false)}
        onCaseCreated={() => {
          handleManualRefresh();
        }}
      />
    </div>
  );
}
