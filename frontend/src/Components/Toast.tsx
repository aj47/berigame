import React from 'react';
import { useToastStore } from '../spacetime/stores/toastStore';

const Toast = () => {
  const message = useToastStore((s) => s.message);
  if (!message) return null;
  return <div className="toast ui-element">{message}</div>;
};

export default Toast;
