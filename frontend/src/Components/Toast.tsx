import React from "react";
import { useToastStore } from "../spacetime/stores/toastStore";
const Toast = () => {
  const message = useToastStore((state) => state.message);
  return message ? (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  ) : null;
};
export default Toast;
