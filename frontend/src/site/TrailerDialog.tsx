import React, { useEffect, useRef } from 'react';

export default function TrailerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { video.current?.pause(); if (element.open) element.close(); return; }
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void video.current?.play().catch(() => { /* Native controls remain available when autoplay is blocked. */ });
    return () => { document.body.style.overflow = previousOverflow; video.current?.pause(); };
  }, [open]);
  return <dialog ref={dialog} className="trailer-dialog" aria-labelledby="trailer-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="trailer-dialog-header"><div><span className="site-kicker">THE BERIGAME FILM</span><h2 id="trailer-title">Little island. Giant adventures.</h2></div><button type="button" onClick={onClose} aria-label="Close trailer" autoFocus><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
    {open && <video ref={video} controls playsInline preload="metadata" poster="/site/adventure.jpg" aria-label="BeriGame cinematic trailer"><source src="/site/berigame-trailer.mp4" type="video/mp4" /></video>}
    <p className="trailer-description">A giant berry. A curious creature. A feast worth sharing. A cinematic glimpse of life on Bramblewild.</p>
  </dialog>;
}
