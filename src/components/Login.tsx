import React, { useState } from 'react';
import { getSupabaseClient } from '../lib/supabase-client';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const client = getSupabaseClient();
    if (!client) {
      setError('Sync not configured');
      setLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        const { error } = await client.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <h2 className="login-title">To-Don't</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="login-input"
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="login-input"
          required
        />
        {error && <div className="login-error">{error}</div>}
        <button type="submit" className="login-button" disabled={loading}>
          {loading ? '...' : isSignUp ? 'Sign up' : 'Sign in'}
        </button>
        <button
          type="button"
          className="login-toggle"
          onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
        >
          {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
        </button>
      </form>
    </div>
  );
}
