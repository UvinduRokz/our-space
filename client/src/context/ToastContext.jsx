import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Toast from '../components/Toast.jsx';

const ToastContext = createContext(null);

const AUTO_HIDE_MS = 3500;

export function ToastProvider({ children }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  const showToast = useCallback((text) => {
    setMessage(text);
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <Toast message={message} visible={visible} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
