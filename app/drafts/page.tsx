'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { KindBadge } from '@/components/KindBadge';
import { CaseRecord } from '@/lib/types';
import { humanizeProposal, formatDate } from '@/lib/utils';
import {
  Sparkles,
  Copy,
  Check,
  AlertTriangle,
  FileText,
  Loader2,
  ShieldAlert,
  Info,
} from 'lucide-react';

export default function DraftWorkspacePage() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [draftContent, setDraftContent] = useState<string>('');
  const [originalDraft, setOriginalDraft] = useState<string>('');
  const [loadingCases, setLoadingCases] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const fetchCases = useCallback(async () => {
    try {
      const res = await fetch('/api/cases?limit=30');
      if (res.ok) {
        const data = await res.json();
        const caseList: CaseRecord[] = data.cases || [];
        setCases(caseList);
        if (caseList.length > 0 && !selectedCaseId) {
          setSelectedCaseId(caseList[0].case_id);
        }
      }
    } catch (err) {
      console.error('Failed to load cases:', err);
    } finally {
      setLoadingCases(false);
    }
  }, [selectedCaseId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/cases?limit=30');
        if (res.ok && active) {
          const data = await res.json();
          const caseList: CaseRecord[] = data.cases || [];
          setCases(caseList);
          if (caseList.length > 0) {
            setSelectedCaseId(caseList[0].case_id);
          }
        }
      } catch (err) {
        console.error('Failed to load cases in workspace:', err);
      } finally {
        if (active) setLoadingCases(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const selectedCase = cases.find((c) => c.case_id === selectedCaseId);
  const hasUnsavedEdits = draftContent !== originalDraft && originalDraft !== '';

  const executeDraftGeneration = async (caseId: string) => {
    setGenerating(true);
    setError(null);
    setShowUnsavedWarning(false);
    try {
      const res = await fetch(`/api/cases/${caseId}/draft`, { method: 'POST' });
      let data: Record<string, unknown> = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: text.slice(0, 200) || `Server returned HTTP ${res.status}` };
        }
      }

      if (!res.ok) {
        throw new Error(
          (data.error as string) ||
            (data.message as string) ||
            'Failed to generate customer draft from n8n'
        );
      }

      const generated = (data.draft as string) || '';
      setDraftContent(generated);
      setOriginalDraft(generated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Draft generation error');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateClick = () => {
    if (!selectedCaseId) return;
    if (hasUnsavedEdits) {
      setPendingAction(() => () => executeDraftGeneration(selectedCaseId));
      setShowUnsavedWarning(true);
      return;
    }
    executeDraftGeneration(selectedCaseId);
  };

  const handleCaseChange = (newCaseId: string) => {
    if (hasUnsavedEdits) {
      setPendingAction(() => () => {
        setSelectedCaseId(newCaseId);
        setDraftContent('');
        setOriginalDraft('');
      });
      setShowUnsavedWarning(true);
      return;
    }
    setSelectedCaseId(newCaseId);
    setDraftContent('');
    setOriginalDraft('');
  };

  const copyToClipboard = () => {
    if (!draftContent) return;
    navigator.clipboard.writeText(draftContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppLayout onRefresh={fetchCases}>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              <span>AI Customer Reply Draft Workspace</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Groq LLM-assisted customer communication drafts powered through n8n workflows.
            </p>
          </div>
        </div>

        {/* Warning Modal for Unsaved Edits */}
        {showUnsavedWarning && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3 text-xs text-amber-900 animate-in fade-in duration-150">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <span className="font-semibold block">Unsaved Draft Changes</span>
              <p>
                You have modified the draft in this session. Generating a new draft or switching cases will replace your current edits.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (pendingAction) pendingAction();
                    setShowUnsavedWarning(false);
                  }}
                  className="px-3 py-1 bg-amber-600 text-white rounded text-xs font-semibold hover:bg-amber-700 transition-colors"
                >
                  Discard & Proceed
                </button>
                <button
                  type="button"
                  onClick={() => setShowUnsavedWarning(false)}
                  className="px-3 py-1 bg-white border border-amber-300 rounded text-xs font-medium hover:bg-amber-100 transition-colors"
                >
                  Keep Editing
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Select Case & Case Context (1 Col) */}
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Select Case
              </label>

              {loadingCases ? (
                <div className="p-4 border rounded-xl flex items-center justify-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>Loading cases...</span>
                </div>
              ) : cases.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  No cases found. Create a demo case first.
                </div>
              ) : (
                <select
                  value={selectedCaseId}
                  onChange={(e) => handleCaseChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white"
                >
                  {cases.map((c) => (
                    <option key={c.case_id} value={c.case_id}>
                      {c.case_id} — [{c.kind.toUpperCase()}] Rev {c.revision}
                    </option>
                  ))}
                </select>
              )}

              {selectedCase && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Case Context</span>
                    <KindBadge kind={selectedCase.kind} />
                  </div>

                  <div className="space-y-1">
                    <div className="text-slate-500">Proposed Action:</div>
                    <div className="font-medium text-slate-900">
                      {humanizeProposal(selectedCase.proposal).headline}
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500">
                    Created: {formatDate(selectedCase.created_at)}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleGenerateClick}
                disabled={generating || !selectedCaseId}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Calling Groq via n8n...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>{draftContent ? 'Regenerate Draft' : 'Generate AI Draft'}</span>
                  </>
                )}
              </button>
            </div>

            {/* Session Scope Callout */}
            <div className="bg-slate-100/80 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Info className="w-3.5 h-3.5 text-blue-600" />
                <span>Session-Local Draft</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Drafts generated here are maintained in local session memory for operator review and copying. They are not stored persistently or sent automatically.
              </p>
            </div>
          </div>

          {/* Right Column: Draft Editor & Actions (2 Cols) */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              {/* Draft Header Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Plain-Text Reply Draft</h2>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                    Requires Review
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                    Not Sent — Simulated
                  </span>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
                  {error}
                </div>
              )}

              {/* Draft Editor Textarea */}
              {draftContent ? (
                <div className="space-y-2">
                  <textarea
                    rows={12}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder="Generated draft will appear here..."
                    className="w-full p-4 bg-slate-50/70 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 leading-relaxed focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-colors"
                  />
                  {hasUnsavedEdits && (
                    <div className="text-[11px] text-amber-700 font-medium">
                      • Draft modified in workspace (unsaved session edits)
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-16 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2 text-xs text-slate-400">
                  <Sparkles className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="font-medium text-slate-600">No Draft Generated Yet</p>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Select a case on the left and click <strong>Generate AI Draft</strong> to invoke the n8n Groq workflow.
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
                <span>No automated dispatch is performed from this dashboard</span>
              </div>

              {draftContent && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyToClipboard}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied to Clipboard</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Draft</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
