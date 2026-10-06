import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * Shared revalidation plumbing behind every "keep this fresh" hook
 * (useProducts, useGalleryImages, useSiteSettings). Subscribes to Postgres
 * change events on the given tables via Supabase Realtime -- the client
 * connects directly to Supabase's own realtime service, not through our
 * Express server, so this works fine on stateless/serverless hosting
 * (unlike the old server-held SSE stream, which kept one function
 * invocation open per browser tab indefinitely and couldn't broadcast
 * across separate serverless containers anyway).
 *
 * Falls back to focus/visibility revalidation if the Realtime connection
 * drops. Each hook still owns its own fetch/parse/cache logic, this just
 * decides *when* to re-fetch.
 *
 * Do NOT listen for `tdp_catalog_invalidate` here: useProducts dispatches it
 * after every forced refresh, so reacting to it with another forced refresh
 * is an infinite loop (one focus event produced thousands of requests).
 * ProductPage/BookingPage listen for it on their own.
 */
export function useLiveSync(revalidate: (force: boolean) => void, tables: string[]): void {
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  const tableKey = tables.join(',');

  useEffect(() => {
    revalidateRef.current(false);

    // A fixed channel name collides with itself on a fast remount (React
    // StrictMode's dev double-invoke, or navigating away and back before the
    // previous channel's async removeChannel() finishes) -- the Realtime
    // client reuses the already-SUBSCRIBED instance for that topic, and
    // calling .on() on it then throws. A per-mount-unique name sidesteps it.
    let channel = supabase?.channel(`live-sync:${tableKey}:${Math.random().toString(36).slice(2)}`);
    if (channel) {
      for (const table of tables) {
        channel = channel.on(
          'postgres_changes' as any,
          { event: '*', schema: 'public', table },
          () => revalidateRef.current(true)
        );
      }
      channel.subscribe((status: string, err?: Error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[useLiveSync] Realtime subscription for [${tableKey}] ${status}`, err || '');
        }
      });
    }

    const revalidateOnFocus = () => {
      if (document.visibilityState === 'visible') revalidateRef.current(true);
    };
    window.addEventListener('focus', revalidateOnFocus);
    document.addEventListener('visibilitychange', revalidateOnFocus);

    return () => {
      if (channel) supabase?.removeChannel(channel);
      window.removeEventListener('focus', revalidateOnFocus);
      document.removeEventListener('visibilitychange', revalidateOnFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);
}
