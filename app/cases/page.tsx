'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppLayout } from '@/components/AppLayout';
import { KindBadge } from '@/components/KindBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { CaseRecord } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  RotateCcw,
  Loader2,
  ExternalLink,
} from 'lucide-react';

function CasesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const kindParam = searchParams.get('kind') || 'all';
  const statusParam = searchParams.get('status') || 'all';
  const searchParam = searchParams.get('search') || '';
  const pageParam = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = 15;

  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(searchParam);

  const fetchCases = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (kindParam !== 'all') params.set('kind', kindParam);
      if (statusParam !== 'all') params.set('status', statusParam);
      if (searchParam) params.set('search', searchParam);
      params.set('limit', String(pageSize));
      params.set('offset', String((pageParam - 1) * pageSize));

      const res = await fetch(`/api/cases?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCases(data.cases || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch cases:', err);
    } finally {
      setLoading(false);
    }
  }, [kindParam, statusParam, searchParam, pageParam]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (kindParam !== 'all') params.set('kind', kindParam);
        if (statusParam !== 'all') params.set('status', statusParam);
        if (searchParam) params.set('search', searchParam);
        params.set('limit', String(pageSize));
        params.set('offset', String((pageParam - 1) * pageSize));

        const res = await fetch(`/api/cases?${params.toString()}`);
        if (res.ok && active) {
          const data = await res.json();
          setCases(data.cases || []);
          setTotal(data.total || 0);
        }
      } catch (err) {
        console.error('Failed to load cases:', err);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [kindParam, statusParam, searchParam, pageParam]);

  const updateFilters = (newParams: Record<string, string | number>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(newParams).forEach(([key, val]) => {
      if (val === 'all' || val === '' || val === undefined) {
        next.delete(key);
      } else {
        next.set(key, String(val));
      }
    });
    router.push(`/cases?${next.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ search: searchInput, page: 1 });
  };

  const clearAllFilters = () => {
    setSearchInput('');
    router.push('/cases');
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AppLayout onRefresh={fetchCases}>
      <div className="space-y-6">
        {/* Title Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-blue-600" />
              <span>Operations Cases History</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Tenant-scoped operational records from PostgreSQL with full revision auditability.
            </p>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by Case ID, Order ID, or proposal summary..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
              />
            </div>

            {/* Kind Filter */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 hidden sm:inline" />
              <select
                value={kindParam}
                onChange={(e) => updateFilters({ kind: e.target.value, page: 1 })}
                className="w-full md:w-auto px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Workflows</option>
                <option value="order">Order Confirmation</option>
                <option value="return">Return / Refund</option>
                <option value="stock">Stock Shortage</option>
                <option value="delivery">Delivery Escalation</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusParam}
                onChange={(e) => updateFilters({ status: e.target.value, page: 1 })}
                className="w-full md:w-auto px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="demo_completed">Simulated Completed</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>

              {(kindParam !== 'all' || statusParam !== 'all' || searchParam) && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-xs transition-colors shrink-0"
                  title="Reset Filters"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Cases Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span>Querying PostgreSQL cases repository...</span>
            </div>
          ) : cases.length === 0 ? (
            <div className="p-16 text-center text-xs text-slate-400 space-y-2">
              <FolderKanban className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-medium text-slate-600">No cases match your filters.</p>
              <p className="text-[11px] text-slate-400">Try adjusting your search criteria or resetting filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 select-none">
                  <tr>
                    <th className="px-5 py-3">Case ID</th>
                    <th className="px-5 py-3">Workflow Kind</th>
                    <th className="px-5 py-3">Target Order</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Revision</th>
                    <th className="px-5 py-3">Created Date (PKT)</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cases.map((c) => {
                    const orderId =
                      (c.payload?.order_id as string) ||
                      (c.payload?.orderId as string) ||
                      '—';
                    return (
                      <tr key={c.case_id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5 font-mono font-medium text-slate-900">
                          <Link
                            href={`/cases/${c.case_id}`}
                            className="hover:text-blue-600 hover:underline flex items-center gap-1.5"
                          >
                            <span>{c.case_id}</span>
                          </Link>
                        </td>
                        <td className="px-5 py-3.5">
                          <KindBadge kind={c.kind} />
                        </td>
                        <td className="px-5 py-3.5 font-mono text-slate-700">
                          {orderId}
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-5 py-3.5 font-mono text-slate-500">
                          Rev {c.revision}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                          {formatDate(c.created_at)}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <Link
                            href={`/cases/${c.case_id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Bar */}
          <div className="p-4 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div>
              Showing <span className="font-semibold">{cases.length > 0 ? (pageParam - 1) * pageSize + 1 : 0}</span> to{' '}
              <span className="font-semibold">{Math.min(pageParam * pageSize, total)}</span> of{' '}
              <span className="font-semibold">{total}</span> total cases
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateFilters({ page: pageParam - 1 })}
                disabled={pageParam <= 1 || loading}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-mono font-medium">
                Page {pageParam} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => updateFilters({ page: pageParam + 1 })}
                disabled={pageParam >= totalPages || loading}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

export default function CasesPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-xs text-slate-400">Loading cases view...</div>}>
      <CasesContent />
    </Suspense>
  );
}
