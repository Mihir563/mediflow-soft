'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, CalendarRange } from 'lucide-react';

interface SmartExpiryInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string; // MM/YYYY or similar
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}

const checkExpiryStatus = (expiryStr: string): 'expired' | 'near_expiry' | 'valid' => {
  if (!expiryStr) return 'valid';

  let month = 0;
  let year = 0;

  const parts = expiryStr.split(/[^0-9]+/).filter(Boolean);
  if (parts.length === 2) {
    const [p1, p2] = parts;
    if (p1.length === 4) {
      // YYYY-MM
      year = parseInt(p1, 10);
      month = parseInt(p2, 10);
    } else {
      // MM/YY or MM/YYYY
      month = parseInt(p1, 10);
      year = parseInt(p2, 10);
      if (p2.length === 2) {
        year = 2000 + year;
      }
    }
  } else {
    // If it's a date object string fallback
    const d = new Date(expiryStr);
    if (!isNaN(d.getTime())) {
      month = d.getMonth() + 1;
      year = d.getFullYear();
    }
  }

  if (month === 0 || year === 0 || isNaN(month) || isNaN(year)) return 'valid';

  const today = new Date();
  const todayReset = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  // Expiry is at the last day of the month
  const expiryDate = new Date(year, month, 0);

  if (expiryDate < todayReset) {
    return 'expired';
  }

  const sixMonthsFromNow = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
  if (expiryDate <= sixMonthsFromNow) {
    return 'near_expiry';
  }

  return 'valid';
};

// Pre-format to make sure there's a slash if they typed e.g. 1226
const normalizeInputSlash = (text: string): string => {
  const clean = text.replace(/[^0-9/]/g, '');
  if (!clean.includes('/') && clean.length >= 3) {
    return `${clean.substring(0, 2)}/${clean.substring(2)}`;
  }
  return clean;
};

// Returns { formatted: string, error: string }
const parseExpiryParts = (text: string): { formatted: string, error: string } => {
  const normalized = normalizeInputSlash(text);
  if (!normalized.trim()) return { formatted: '', error: '' };

  const parts = normalized.split('/');
  if (parts.length !== 2) {
    return { formatted: normalized, error: 'Format must be MM/YY or MM/YYYY' };
  }

  const [mStr, yStr] = parts;
  const m = parseInt(mStr, 10);
  const y = parseInt(yStr, 10);

  if (isNaN(m) || m < 1 || m > 12) {
    return { formatted: normalized, error: 'Month must be between 01 and 12' };
  }

  if (isNaN(y) || (yStr.length !== 2 && yStr.length !== 4)) {
    return { formatted: normalized, error: 'Year must be 2 or 4 digits' };
  }

  let fullYear = y;
  if (yStr.length === 2) {
    fullYear = 2000 + y;
  }

  if (fullYear < 2000 || fullYear > 2100) {
    return { formatted: normalized, error: 'Year must be between 2000 and 2100' };
  }

  const formatted = `${String(m).padStart(2, '0')}/${fullYear}`;
  return { formatted, error: '' };
};

export default function SmartExpiryInput({
  value,
  onChange,
  id,
  className = '',
  placeholder = 'MM/YY',
  onKeyDown,
  autoFocus = false,
  ...props
}: SmartExpiryInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'expired' | 'near_expiry' | 'valid'>('valid');

  // Convert raw value (e.g. YYYY-MM or MM/YYYY) to display MM/YYYY or MM/YY
  useEffect(() => {
    if (value) {
      let displayVal = value;
      // If it's YYYY-MM, convert to MM/YYYY
      const parts = value.split('-');
      if (parts.length === 2 && parts[0].length === 4) {
        displayVal = `${parts[1]}/${parts[0]}`;
      }
      setInputValue(displayVal);
      setError('');
      setStatus(checkExpiryStatus(value));
    } else {
      setInputValue('');
      setError('');
      setStatus('valid');
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    val = val.replace(/[^0-9/]/g, '');

    const currentLength = val.length;
    const oldLength = inputValue.length;

    if (currentLength > oldLength) {
      if (currentLength === 2 && !val.includes('/')) {
        val = val + '/';
      }
    }

    setInputValue(val);
  };

  const handleBlur = () => {
    const { formatted, error: err } = parseExpiryParts(inputValue);
    if (err) {
      setError(err);
      onChange(''); // Send empty to parent to block saving
      setStatus('valid');
    } else {
      setError('');
      setInputValue(formatted);
      onChange(formatted);
      setStatus(checkExpiryStatus(formatted));
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const { formatted, error: err } = parseExpiryParts(inputValue);
      if (err) {
        setError(err);
        onChange(''); // Send empty to parent to block saving
        setStatus('valid');
      } else {
        setError('');
        setInputValue(formatted);
        onChange(formatted);
        setStatus(checkExpiryStatus(formatted));
        if (onKeyDown) onKeyDown(e);
      }
    } else if (onKeyDown) {
      onKeyDown(e);
    }
  };

  return (
    <div className="relative inline-block w-full">
      <div className="relative flex items-center">
        <input
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          maxLength={7}
          {...props}
          className={`w-full font-mono text-xs bg-white focus:outline-none focus:ring-1 border rounded-md px-2 py-1 h-8 shadow-sm transition-all ${
            error
              ? 'border-red-500 focus:ring-red-500 focus:border-red-500 bg-red-50 text-red-700 font-semibold shadow-red-50'
              : status === 'expired'
              ? 'border-red-300 focus:ring-red-500 focus:border-red-500 bg-red-50/20 text-red-700 font-bold'
              : status === 'near_expiry'
              ? 'border-amber-300 focus:ring-amber-500 focus:border-amber-500 bg-amber-50/20 text-amber-700 font-bold'
              : 'border-slate-200 focus:ring-brand focus:border-brand text-slate-700'
          } ${className}`}
        />
        {(error || status !== 'valid') && (
          <span
            className={`absolute right-2 flex items-center pointer-events-none ${
              error || status === 'expired' ? 'text-red-500' : 'text-amber-500'
            }`}
            title={error || (status === 'expired' ? 'Expired medicine!' : 'Near Expiry (expires within 6 months)')}
          >
            <AlertCircle size={14} />
          </span>
        )}
      </div>
    </div>
  );
}
