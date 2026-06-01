'use client';
import React, { useRef, useEffect } from 'react';
import { Plus, X, FileText, ShoppingCart } from 'lucide-react';

export interface BillTab {
  id: string;
  label: string;        // e.g. "New Bill" or the bill/invoice number
  editTxnId: number | null;
  isDirty?: boolean;    // true if the bill has unsaved items
}

interface BillTabBarProps {
  tabs: BillTab[];
  activeTabId: string;
  type: 'purchase' | 'sale';
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  maxTabs?: number;
}

export default function BillTabBar({
  tabs,
  activeTabId,
  type,
  onSelect,
  onClose,
  onNew,
  maxTabs = 8,
}: BillTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  const Icon = type === 'purchase' ? ShoppingCart : FileText;
  const accentColor = type === 'purchase' ? 'text-brand border-brand' : 'text-emerald-600 border-emerald-500';
  const accentBg = type === 'purchase' ? 'bg-brand/10' : 'bg-emerald-50';
  const newBtnColor = type === 'purchase'
    ? 'hover:bg-brand/10 hover:text-brand text-slate-500'
    : 'hover:bg-emerald-50 hover:text-emerald-600 text-slate-500';

  return (
    <div className="flex items-end bg-slate-100 border-b border-slate-200 px-2 pt-1 select-none overflow-hidden shrink-0" style={{ minHeight: 38 }}>
      {/* Scrollable tab strip — + button lives inside, right after the last tab */}
      <div
        ref={scrollRef}
        className="flex items-end gap-0.5 overflow-x-auto no-scrollbar"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSelect(tab.id)}
              className={`
                group relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-lg
                border border-b-0 transition-all duration-150 shrink-0 max-w-[180px]
                ${isActive
                  ? `bg-white ${accentColor} shadow-sm z-10`
                  : 'bg-slate-200/70 text-slate-500 border-slate-300 hover:bg-slate-200 hover:text-slate-700'
                }
              `}
              style={isActive ? { marginBottom: -1 } : {}}
              title={tab.label}
            >
              <Icon size={11} className={isActive ? (type === 'purchase' ? 'text-brand' : 'text-emerald-600') : 'text-slate-400 group-hover:text-slate-600'} />
              <span className="truncate max-w-[110px]">
                {tab.label}
              </span>
              {tab.isDirty && (
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? (type === 'purchase' ? 'bg-brand' : 'bg-emerald-500') : 'bg-slate-400'}`}
                  title="Unsaved changes"
                />
              )}
              {tabs.length > 1 && (
                <span
                  role="button"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={`
                    ml-0.5 flex-shrink-0 w-4 h-4 flex items-center justify-center rounded
                    opacity-0 group-hover:opacity-100 transition-opacity
                    hover:bg-red-100 hover:text-red-500
                    ${isActive ? 'opacity-100' : ''}
                  `}
                >
                  <X size={10} />
                </span>
              )}
            </button>
          );
        })}

        {/* + button sits immediately after the last tab, scrolls with them */}
        {tabs.length < maxTabs && (
          <button
            onClick={onNew}
            title="New bill"
            className={`self-center flex-shrink-0 w-6 h-6 ml-1 mb-0.5 flex items-center justify-center rounded-md transition-colors ${newBtnColor}`}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
