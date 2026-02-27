export const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
