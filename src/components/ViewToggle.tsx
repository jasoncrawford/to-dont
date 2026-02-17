import React, { useState, useRef, useEffect } from 'react';
import { useViewMode, setViewMode, useAuthState, useAuthEmail } from '../store';
import { SyncStatus } from './SyncStatus';
import { getSupabaseClient } from '../lib/supabase-client';

export function ViewToggle() {
  const viewMode = useViewMode();
  const authState = useAuthState();
  const authEmail = useAuthEmail();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  async function handleSignOut() {
    setMenuOpen(false);
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
  }

  return (
    <div id="viewToggle" className="view-tabs">
      <div className="view-tabs-left">
        <button
          id="importantViewBtn"
          className={`view-tab${viewMode === 'important' ? ' active' : ''}`}
          onClick={() => setViewMode('important')}
        >
          Important
        </button>
        <button
          id="activeViewBtn"
          className={`view-tab${viewMode === 'active' ? ' active' : ''}`}
          onClick={() => setViewMode('active')}
        >
          Active
        </button>
        <button
          id="fadedViewBtn"
          className={`view-tab${viewMode === 'faded' ? ' active' : ''}`}
          onClick={() => setViewMode('faded')}
        >
          Faded
        </button>
        <button
          id="doneViewBtn"
          className={`view-tab${viewMode === 'done' ? ' active' : ''}`}
          onClick={() => setViewMode('done')}
        >
          Done
        </button>
      </div>
      <div className="view-tabs-right">
        <SyncStatus />
        {authState === 'authenticated' && (
          <div className="account-menu" ref={menuRef}>
            <button
              className="account-icon-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Account menu"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="5" r="3" />
                <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
              </svg>
            </button>
            {menuOpen && (
              <div className="account-dropdown">
                <div className="account-email">{authEmail}</div>
                <button className="account-sign-out" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
