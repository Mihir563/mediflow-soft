'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';

interface SmartDateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void; // YYYY-MM-DD
  id?: string;
  className?: string;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}

// Convert YYYY-MM-DD to DD/MM/YYYY
const toDisplayFormat = (isoString: string): string => {
  if (!isoString) return '';
  const parts = isoString.split('-');
  if (parts.length !== 3) return isoString;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

export default function SmartDateInput({
  value,
  onChange,
  id,
  className = '',
  placeholder = 'DD/MM/YYYY',
  onKeyDown,
  autoFocus = false,
  ...props
}: SmartDateInputProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const nativeDateRef = useRef<HTMLInputElement>(null);

  // Sync internal state with prop value
  useEffect(() => {
    if (value) {
      setInputValue(toDisplayFormat(value));
    } else {
      setInputValue('');
    }
  }, [value]);

  // Parse typed string to a valid date
  const parseAndFormat = (text: string) => {
    const cleanText = text.replace(/[^0-9]/g, '');
    const today = new Date();
    let d = today.getDate();
    let m = today.getMonth() + 1; // 1-indexed
    let y = today.getFullYear();

    if (cleanText.length > 0) {
      if (cleanText.length <= 2) {
        // Just day
        d = parseInt(cleanText, 10);
      } else if (cleanText.length <= 4) {
        // Day and Month
        d = parseInt(cleanText.substring(0, 2), 10);
        m = parseInt(cleanText.substring(2), 10);
      } else if (cleanText.length <= 6) {
        // Day, Month, 2-digit Year
        d = parseInt(cleanText.substring(0, 2), 10);
        m = parseInt(cleanText.substring(2, 4), 10);
        const y2 = parseInt(cleanText.substring(4), 10);
        y = y2 < 50 ? 2000 + y2 : 1900 + y2;
      } else {
        // Day, Month, 4-digit Year
        d = parseInt(cleanText.substring(0, 2), 10);
        m = parseInt(cleanText.substring(2, 4), 10);
        y = parseInt(cleanText.substring(4, 8), 10);
      }
    }

    // Clamp values to real dates
    m = Math.max(1, Math.min(12, m));
    
    // Days in month calculation
    const daysInMonth = new Date(y, m, 0).getDate();
    d = Math.max(1, Math.min(daysInMonth, d));

    const dayStr = String(d).padStart(2, '0');
    const monthStr = String(m).padStart(2, '0');
    const yearStr = String(y).padStart(4, '0');

    const formattedDisplay = `${dayStr}/${monthStr}/${yearStr}`;
    const formattedIso = `${yearStr}-${monthStr}-${dayStr}`;

    setInputValue(formattedDisplay);
    onChange(formattedIso);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    
    // Keep only numbers and slashes
    val = val.replace(/[^0-9/]/g, '');

    // Auto-append separator slash as typing digits (skip if user is backspacing)
    const currentLength = val.length;
    const oldLength = inputValue.length;

    if (currentLength > oldLength) {
      // Auto formatting mask
      if (currentLength === 2 && !val.includes('/')) {
        val = val + '/';
      } else if (currentLength === 5 && val.split('/').length - 1 === 1) {
        val = val + '/';
      }
    }

    setInputValue(val);
  };

  const handleBlur = () => {
    if (inputValue.trim() === '') {
      // If empty, revert to today
      const today = new Date().toISOString().split('T')[0];
      onChange(today);
      setInputValue(toDisplayFormat(today));
    } else {
      parseAndFormat(inputValue);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      parseAndFormat(inputValue);
      if (onKeyDown) onKeyDown(e);
      return;
    }

    // Today key shortcut
    if (e.key.toLowerCase() === 't') {
      e.preventDefault();
      const today = new Date().toISOString().split('T')[0];
      onChange(today);
      setInputValue(toDisplayFormat(today));
      return;
    }

    // Arrow keys to adjust dates
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const currentDate = value ? new Date(value) : new Date();
      if (!isNaN(currentDate.getTime())) {
        const delta = e.key === 'ArrowUp' ? 1 : -1;
        currentDate.setDate(currentDate.getDate() + delta);
        const iso = currentDate.toISOString().split('T')[0];
        onChange(iso);
        setInputValue(toDisplayFormat(iso));
      }
      return;
    }

    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const handleNativeDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val) {
      onChange(val);
      setInputValue(toDisplayFormat(val));
    }
  };

  const handleCalendarClick = (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      if (nativeDateRef.current) {
        nativeDateRef.current.showPicker();
      }
    } catch (err) {
      console.warn('Native picker not supported, fallback to input focus', err);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="relative inline-block w-full">
      <div className="relative flex items-center">
        {/* Visible smart formatted text input */}
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          maxLength={10}
          {...props}
          className={`w-full pr-10 font-mono text-sm bg-white focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand border border-slate-200 rounded-lg px-3 py-2 shadow-sm transition-all h-10 ${className}`}
        />
        
        {/* Hidden native input[type=date] for native calendar popup */}
        <input
          ref={nativeDateRef}
          type="date"
          value={value || ''}
          onChange={handleNativeDateChange}
          tabIndex={-1}
          style={{
            position: 'absolute',
            width: 0,
            height: 0,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />

        <button
          type="button"
          onClick={handleCalendarClick}
          tabIndex={-1}
          className="absolute right-3 text-slate-400 hover:text-brand focus:outline-none transition-colors cursor-pointer"
        >
          <CalendarIcon size={16} />
        </button>
      </div>
    </div>
  );
}
