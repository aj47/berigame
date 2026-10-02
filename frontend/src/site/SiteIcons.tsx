import React from 'react';

export function BerryMark() {
  return <svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M23 16C14 16 11 8 13 4c9 0 12 5 10 12Z" fill="#b7d69e"/><path d="M24 17c0-9 7-12 14-10-1 8-7 11-14 10Z" fill="#8cbb76"/><circle cx="17" cy="27" r="11" fill="#e18e91"/><circle cx="30" cy="29" r="10" fill="#d36777"/><circle cx="14" cy="23" r="2.4" fill="#ffd4be"/><circle cx="28" cy="25" r="2" fill="#ffd4be"/></svg>;
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
