import React, { useEffect, useRef, useState } from 'react';
import { useHealthBarStore, useUserStateStore, useChatStore } from '../store';

const HealthBar: React.FC = () => {
  const healthBarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Store states
  const { 
    isVisible, 
    position, 
    setPosition, 
    toggleVisibility,
    initializePosition 
  } = useHealthBarStore();
  
  const health = useUserStateStore((state) => state.health);
  const maxHealth = useUserStateStore((state) => state.maxHealth);
  const focusedChat = useChatStore((state) => state.focusedChat);

  // Initialize position from localStorage on mount
  useEffect(() => {
    initializePosition();
  }, [initializePosition]);

  // Keyboard shortcut to toggle health bar visibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusedChat) return; // Don't handle shortcuts when chat is focused
      
      // Toggle health bar visibility with 'Shift+H'
      if (e.key === 'H' && e.shiftKey) {
        e.preventDefault();
        toggleVisibility();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleVisibility, focusedChat]);

  // Mouse and touch drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.target === healthBarRef.current || (e.target as HTMLElement).classList.contains('health-bar-header')) {
      setIsDragging(true);
      const rect = healthBarRef.current?.getBoundingClientRect();
      if (rect) {
        const clientX = e.clientX;
        const clientY = e.clientY;
        setDragOffset({
          x: clientX - rect.left,
          y: clientY - rect.top
        });
      }
      e.preventDefault(); // Prevent text selection
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (isDragging) {
      const clientX = e.clientX;
      const clientY = e.clientY;
      const maxWidth = window.innerWidth - 180; // Account for component width
      const maxHeight = window.innerHeight - 80; // Account for component height
      
      const newX = Math.max(0, Math.min(maxWidth, clientX - dragOffset.x));
      const newY = Math.max(0, Math.min(maxHeight, clientY - dragOffset.y));
      setPosition({ x: newX, y: newY });
    }
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      return () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [isDragging, dragOffset]);

  if (!isVisible) {
    return (
      <button
        className="health-bar-toggle-button"
        onClick={toggleVisibility}
        style={{
          position: 'fixed',
          top: '10px',
          left: '10px',
          zIndex: 1000,
          padding: '6px 10px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          border: '1px solid #555',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '11px',
          minHeight: '32px',
          minWidth: '60px'
        }}
        title="Show Health Bar (Shift+H)"
      >
        HP
      </button>
    );
  }

  const healthPercentage = (health / maxHealth) * 100;

  return (
    <div
      ref={healthBarRef}
      className="health-bar-container"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.8)',
        border: '2px solid #444',
        borderRadius: '8px',
        padding: '8px 12px',
        minWidth: '160px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        pointerEvents: 'all',
        touchAction: 'none' // Prevent default touch behaviors
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Header with close button */}
      <div 
        className="health-bar-header" 
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
          color: 'white',
          fontSize: '11px',
          fontWeight: 'bold'
        }}
      >
        <span>Health</span>
        <button
          onClick={toggleVisibility}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 4px',
            minHeight: '20px',
            minWidth: '20px'
          }}
          title="Hide Health Bar (Shift+H)"
        >
          ×
        </button>
      </div>

      {/* Health display */}
      <div style={{
        color: 'white',
        fontSize: '10px',
        marginBottom: '4px',
        textAlign: 'center'
      }}>
        {health}/{maxHealth}
      </div>
      
      {/* Health bar */}
      <div style={{
        width: '100%',
        height: '12px',
        background: '#333',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid #555'
      }}>
        <div style={{
          width: `${healthPercentage}%`,
          height: '100%',
          background: healthPercentage > 60 ? '#4CAF50' : healthPercentage > 30 ? '#FF9800' : '#F44336',
          transition: 'width 0.3s ease, background-color 0.3s ease'
        }} />
      </div>
    </div>
  );
};

export default HealthBar;
