import React from 'react';

interface MediFlowLogoProps {
  size?: number;
  className?: string;
}

export function MediFlowLogo({ size = 24, className = '' }: MediFlowLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Sleek, professional rounded medical cross representing pharmacy/health */}
      <rect x="10.5" y="4" width="3" height="16" rx="1.5" fill="currentColor" />
      <rect x="4" y="10.5" width="16" height="3" rx="1.5" fill="currentColor" />
      
      {/* Swoosh/Checkmark wrapping the cross representing transactions, flow, and success */}
      <path
        d="M6 13L10 17L18 8"
        stroke="url(#mediflow-logo-grad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      <defs>
        <linearGradient id="mediflow-logo-grad" x1="6" y1="8" x2="18" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#06b6d4" /> {/* Teal */}
          <stop offset="100%" stopColor="#10b981" /> {/* Emerald Green */}
        </linearGradient>
      </defs>
    </svg>
  );
}
