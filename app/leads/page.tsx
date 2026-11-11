'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import {
  Users,
  Search,
  Filter,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  UserCheck,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  DollarSign,
  Tag,
} from 'lucide-react';
import { ServicesLeadRecord, ServicesLeadEventRecord, ServicesLeadStage } from '@/lib/types';

const STAGES: { key: ServicesLeadStage | 'all'; label: string; color: string; bg: string }[] = [
  { key: 'all', label: 'All Leads', color: 'text-slate-700', bg: 'bg-slate-100' },
  { key: 'new', label: 'New', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  { key: 'contacted', label: 'Contacted', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  { key: 'qualified', label: 'Qualified', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
  { key: 'won', label: 'Won', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  { key: 'lost', label: 'Lost', color: 'text-slate-600', bg: 'bg-slate-100 border-slate-200' },
];

export default function LeadsPage() {
  const [leads, setLeads] = useState<ServicesLeadRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [activeStage, setActiveStage] = useState<ServicesLeadStage | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<ServicesLeadRecord | null>(null);
  const [leadEvents, setLeadEvents] = useState<ServicesLeadEventRecord[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [newNote, setNewNote] = useState('');

  const fetchLeads = useCallback(async () => {
    setIsLoading(true);
    try {
      const stageParam = activeStage !== 'all' ? `&stage=${activeStage}` : '';
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
      const res = await fetch(`/api/services/leads?limit=50${stageParam}${searchParam}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
        setCounts(data.counts || {});
      }
    } catch (err) {
      console.error('Failed to fetch leads', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeStage, searchQuery]);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/business', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.members) {
          setTeamMembers(
            data.members.map((m: any) => ({
              id: m.user_id,
              name: m.name || m.email,
              email: m.email,
            }))
          );
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchLeads();
    fetchMembers();
  }, [fetchLeads, fetchMembers]);

  const loadLeadDetail = async (lead: ServicesLeadRecord) => {
    setSelectedLead(lead);
    try {
      const res = await fetch(`/api/services/leads/${lead.id}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSelectedLead(data.lead);
        setLeadEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to load lead events', err);
    }
  };

  const handleUpdateLead = async (updates: Partial<ServicesLeadRecord> & { note?: string; manual_takeover?: boolean }) => {
    if (!selectedLead) return;
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/services/leads/${selectedLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedLead(data.lead);
        setLeadEvents(data.events || []);
        // Update in main list
        setLeads((prev) => prev.map((l) => (l.id === data.lead.id ? data.lead : l)));
        setNewNote('');
      }
    } catch (err) {
      console.error('Failed to update lead', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const stageBadge = (stage: ServicesLeadStage) => {
    switch (stage) {
      case 'new':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 border border-blue-200">
            New
          </span>
        );
      case 'contacted':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            Contacted
          </span>
        );
      case 'qualified':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
            Qualified
          </span>
        );
      case 'won':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
            Won
          </span>
        );
      case 'lost':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            Lost
          </span>
        );
    }
  };

  return (
    <AppLayout onRefresh={fetchLeads} isRefreshing={isLoading}>
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <Users className="w-6 h-6 text-indigo-600" />
              Services Leads
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Track customer inquiries, qualification stages, team assignments, and automated follow-up guards.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchLeads()}
              disabled={isLoading}
              className="px-3.5 py-2 text-sm font-medium rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
            <div className="text-xs font-medium text-slate-500">Total Leads</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{leads.length}</div>
          </div>
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 shadow-xs">
            <div className="text-xs font-medium text-blue-700">New Inquiries</div>
            <div className="text-2xl font-bold text-blue-900 mt-1">{counts.new || 0}</div>
          </div>
          <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200 shadow-xs">
            <div className="text-xs font-medium text-amber-700">In Contact</div>
            <div className="text-2xl font-bold text-amber-900 mt-1">{counts.contacted || 0}</div>
          </div>
          <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200 shadow-xs">
            <div className="text-xs font-medium text-indigo-700">Qualified</div>
            <div className="text-2xl font-bold text-indigo-900 mt-1">{counts.qualified || 0}</div>
          </div>
          <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 shadow-xs">
            <div className="text-xs font-medium text-emerald-700">Won (Closed)</div>
            <div className="text-2xl font-bold text-emerald-900 mt-1">{counts.won || 0}</div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          {/* Stage Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveStage(s.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  activeStage === s.key
                    ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {s.label}
                {s.key !== 'all' && counts[s.key] !== undefined && (
                  <span className={`ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] ${activeStage === s.key ? 'bg-indigo-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                    {counts[s.key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search leads, email, service..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Leads Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
              Loading services leads...
            </div>
          ) : leads.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800">No services leads found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                Leads are automatically created from hosted inquiries, website submissions, and customer messages.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[11px] font-semibold">
                  <tr>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Service Interest</th>
                    <th className="py-3 px-4">Stage</th>
                    <th className="py-3 px-4">Next Action</th>
                    <th className="py-3 px-4">Assigned To</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      onClick={() => loadLeadDetail(lead)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{lead.customer_name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{lead.customer_email}</span>
                          {lead.customer_phone && (
                            <span className="text-slate-400">• {lead.customer_phone}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-800">
                          {lead.service_interest || 'General Inquiry'}
                        </span>
                        {lead.location && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            {lead.location}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">{stageBadge(lead.stage)}</td>
                      <td className="py-3 px-4">
                        <div className="text-slate-800 font-medium">
                          {lead.next_action || 'Follow up with customer'}
                        </div>
                        {lead.due_date && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3 text-amber-500" />
                            Due {new Date(lead.due_date).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {lead.assigned_member_name ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                            <UserCheck className="w-3 h-3 text-indigo-500" />
                            {lead.assigned_member_name}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                        {Boolean(lead.metadata?.manual_takeover) && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold" title="Automated follow-ups paused">
                            Manual
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-[11px]">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            loadLeadDetail(lead);
                          }}
                          className="px-2.5 py-1 rounded-lg text-indigo-600 hover:bg-indigo-50 font-medium inline-flex items-center gap-1 transition-colors"
                        >
                          View <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Lead Detail Drawer / Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{selectedLead.customer_name}</h2>
                  {stageBadge(selectedLead.stage)}
                </div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5" />
                    {selectedLead.customer_email}
                  </span>
                  {selectedLead.customer_phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" />
                      {selectedLead.customer_phone}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition-colors text-lg"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Stage Progression Buttons */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="text-xs font-semibold text-slate-700">Update Lead Stage</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {(['new', 'contacted', 'qualified', 'won', 'lost'] as ServicesLeadStage[]).map((stage) => (
                    <button
                      key={stage}
                      disabled={isUpdating || selectedLead.stage === stage}
                      onClick={() => handleUpdateLead({ stage })}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                        selectedLead.stage === stage
                          ? 'bg-indigo-600 text-white font-bold shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {stage}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 italic">
                  Note: A lead is never marked Won automatically; closing requires merchant decision.
                </p>
              </div>

              {/* Inquiry Details Card */}
              <div className="p-4 rounded-xl border border-slate-200 space-y-3">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Inquiry Details
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500">Service Interest:</span>
                    <div className="font-semibold text-slate-900 mt-0.5">
                      {selectedLead.service_interest || 'General'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Estimated Budget:</span>
                    <div className="font-semibold text-slate-900 mt-0.5">
                      {selectedLead.budget_range || 'Not specified'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Service Location:</span>
                    <div className="font-semibold text-slate-900 mt-0.5">
                      {selectedLead.location || 'Not specified'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Created At:</span>
                    <div className="font-semibold text-slate-900 mt-0.5">
                      {new Date(selectedLead.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>

                {Boolean(selectedLead.metadata?.initial_inquiry) && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <span className="text-xs font-medium text-slate-500">Initial Message:</span>
                    <p className="mt-1 text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed whitespace-pre-wrap">
                      {String(selectedLead.metadata?.initial_inquiry)}
                    </p>
                  </div>
                )}
              </div>

              {/* Assignment & Controls */}
              <div className="p-4 rounded-xl border border-slate-200 space-y-4">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Assignment & Automation Guards
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">
                      Assigned Member
                    </label>
                    <select
                      value={selectedLead.assigned_member_id || ''}
                      onChange={(e) => {
                        const userId = e.target.value;
                        const mem = teamMembers.find((m) => m.id === userId);
                        handleUpdateLead({
                          assigned_member_id: userId || null,
                          assigned_member_name: mem?.name || null,
                        });
                      }}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Unassigned</option>
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">
                      Next Action Due Date
                    </label>
                    <input
                      type="date"
                      value={selectedLead.due_date ? selectedLead.due_date.substring(0, 10) : ''}
                      onChange={(e) => {
                        handleUpdateLead({
                          due_date: e.target.value ? new Date(e.target.value).toISOString() : null,
                        });
                      }}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                {/* Manual Takeover Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50/60 border border-amber-200">
                  <div>
                    <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                      Manual Takeover Guard
                    </div>
                    <div className="text-[11px] text-amber-700 mt-0.5">
                      Suspends all automated background follow-ups and reminders for this lead.
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      handleUpdateLead({
                        manual_takeover: !Boolean(selectedLead.metadata?.manual_takeover),
                      })
                    }
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                      Boolean(selectedLead.metadata?.manual_takeover)
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-amber-300 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    {Boolean(selectedLead.metadata?.manual_takeover) ? 'Active (Paused)' : 'Enable'}
                  </button>
                </div>
              </div>

              {/* Chronological Timeline */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
                  <span>Chronological History</span>
                  <span className="text-slate-400 font-normal">{leadEvents.length} events</span>
                </h3>

                {leadEvents.length === 0 ? (
                  <div className="text-xs text-slate-400 py-3 italic">No events recorded yet.</div>
                ) : (
                  <div className="relative pl-5 space-y-4 border-l-2 border-slate-200 ml-2">
                    {leadEvents.map((evt) => (
                      <div key={evt.id} className="relative group">
                        <div className="absolute -left-[27px] top-1 w-3.5 h-3.5 rounded-full bg-indigo-500 border-2 border-white shadow-xs" />
                        <div className="text-xs">
                          <div className="flex items-center justify-between text-slate-500">
                            <span className="font-semibold text-slate-800 capitalize">
                              {evt.event_type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px]">
                              {new Date(evt.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              • {new Date(evt.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          {evt.actor_id && (
                            <span className="text-[11px] text-slate-400">By {evt.actor_id}</span>
                          )}
                          {evt.details && Object.keys(evt.details).length > 0 && (
                            <div className="mt-1 p-2 rounded-lg bg-slate-50 text-[11px] text-slate-600 font-mono">
                              {String((evt.details as any).note || JSON.stringify(evt.details))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Note Section */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="text-xs font-semibold text-slate-700 block">
                  Add Operator Note / Next Action
                </label>
                <textarea
                  rows={2}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Record call outcome, proposal sent, or client instruction..."
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  disabled={!newNote.trim() || isUpdating}
                  onClick={() => handleUpdateLead({ note: newNote.trim() })}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  Save Note
                </button>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between">
              <span className="text-xs text-slate-500">Lead ID: {selectedLead.id}</span>
              <button
                onClick={() => setSelectedLead(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
