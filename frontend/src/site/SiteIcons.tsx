import React from 'react';

export function BerryMark({ size = 36 }: { size?: number }) {
  return <img className="berry-mark" src="/icon.png?v=blueberry-1" width={size} height={size} alt="" aria-hidden="true" />;
}
export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span className="site-arrow" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h16m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}
export function PlayIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="m7 4 9 6-9 6V4Z" /></svg>;
}
export function LightIcon({ moon = false }: { moon?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{moon ? <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" /> : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>}</svg>;
}
