import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserInputStore } from "../store";

const ClickDropdown = () => {
  const selected = useUserInputStore((state: any) => state.clickedOtherObject);
  const setSelected = useUserInputStore(
    (state: any) => state.setClickedOtherObject,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 80 });
  useLayoutEffect(() => {
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      const x = selected?.e?.clientX ?? window.innerWidth / 2;
      const y = selected?.e?.clientY ?? window.innerHeight / 2;
      setPosition({
        left: Math.max(
          12,
          Math.min(x, window.innerWidth - (rect?.width ?? 240) - 12),
        ),
        top: Math.max(
          12,
          Math.min(y, window.innerHeight - (rect?.height ?? 200) - 12),
        ),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [selected]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setSelected(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [setSelected]);
  if (!selected) return null;
  return (
    <div
      className="click-dropdown"
      ref={ref}
      style={position}
      role="group"
      aria-label={`Actions for ${selected.connectionId}`}
    >
      <div className="context-heading">
        <span>{selected.connectionId}</span>
        <button
          className="close-button"
          onClick={() => setSelected(null)}
          aria-label="Close actions"
        >
          ×
        </button>
      </div>
      {selected.dropdownOptions.map((option: any, index: number) => (
        <button
          className="context-action"
          key={index}
          onClick={option.onClick}
          disabled={option.disabled}
        >
          {option.label}
          <span aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
};
export default ClickDropdown;
