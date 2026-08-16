import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// 1. Extract styles into a map for better readability and easier maintenance
const toastStyles: Record<ToastType, string> = {
  success: 'bg-green-100 text-green-800 border-green-300',
  error: 'bg-red-100 text-red-800 border-red-300',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  info: 'bg-blue-100 text-blue-800 border-blue-300',
};

// 2. Extract Toast Item into its own component to handle its own timeout lifecycle
const ToastItem: React.FC<{ toast: Toast; onClose: (id: string) => void }> = ({ 
  toast, 
  onClose 
}) => {
  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => {
        onClose(toast.id);
      }, toast.duration);

      // Cleanup the timeout if the component unmounts early
      return () => clearTimeout(timer);
    }
  }, [toast, onClose]);

  return (
    <div
      className={`toast px-4 py-3 rounded-lg shadow-lg flex items-center justify-between border animate-fade-in-down ${toastStyles[toast.type]}`}
      role="alert"
    >
      <span>{toast.message}</span>
      <button
        onClick={() => onClose(toast.id)}
        className="ml-4 text-xl leading-none hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 rounded"
        aria-label="Close"
      >
        &times;
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    // Use crypto.randomUUID if available, otherwise fallback to Math.random
    const id = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 9);
      
    setToasts(prev => [...prev, { id, message, type, duration }]);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {/* 3. Added aria-live for screen readers to announce toasts */}
      <div 
        className="toast-container fixed top-4 right-4 z-50 flex flex-col gap-2" 
        aria-live="polite" 
        aria-atomic="true"
      >
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};