import React from 'react';

export type SpinnerSize = 'small' | 'medium' | 'large';

interface LoadingSpinnerProps {
  size?: SpinnerSize;
  text?: string;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  small: 'w-4 h-4 border-2',
  medium: 'w-8 h-8 border-[3px]',
  large: 'w-12 h-12 border-4',
};

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  text,
  className = '',
}) => {
  return (
    <div
      className={`loading-spinner flex flex-col items-center justify-center gap-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-gray-200 border-t-blue-600`}
        aria-hidden="true"
      />
      <span className={text ? 'text-sm text-gray-600' : 'sr-only'}>
        {text || 'Loading...'}
      </span>
    </div>
  );
};

export default LoadingSpinner;