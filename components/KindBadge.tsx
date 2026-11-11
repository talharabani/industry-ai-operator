'use client';

import React from 'react';
import { getKindDetails } from '@/lib/utils';
import { CaseKind } from '@/lib/types';
import { ShoppingBag, RotateCcw, PackageX, Truck, HelpCircle } from 'lucide-react';

interface KindBadgeProps {
  kind: CaseKind | string;
  showIcon?: boolean;
  className?: string;
}

export function KindBadge({ kind, showIcon = true, className = '' }: KindBadgeProps) {
  const details = getKindDetails(kind);

  const renderIcon = () => {
    switch (kind) {
      case 'order':
        return <ShoppingBag className="w-3.5 h-3.5 mr-1.5 shrink-0 text-blue-600" />;
      case 'return':
        return <RotateCcw className="w-3.5 h-3.5 mr-1.5 shrink-0 text-amber-600" />;
      case 'stock':
        return <PackageX className="w-3.5 h-3.5 mr-1.5 shrink-0 text-purple-600" />;
      case 'delivery':
        return <Truck className="w-3.5 h-3.5 mr-1.5 shrink-0 text-indigo-600" />;
      default:
        return <HelpCircle className="w-3.5 h-3.5 mr-1.5 shrink-0 text-slate-500" />;
    }
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${details.badgeClass} ${className}`}
    >
      {showIcon && renderIcon()}
      {details.label}
    </span>
  );
}
