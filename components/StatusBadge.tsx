'use client';

import React from 'react';
import { getStatusDetails } from '@/lib/utils';
import { CaseStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: CaseStatus | string;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const details = getStatusDetails(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${details.badgeClass} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${details.dotClass}`} />
      {details.label}
    </span>
  );
}
