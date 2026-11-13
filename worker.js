// Homophone Showdown — Cloudflare Worker (static frontend + WebSocket relay)
// Serves game HTML; students' browsers connect to Render for live multiplayer.

const GAME_REPO = 'https://raw.githubusercontent.com/GregDavies91/mrdavies/main';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── CORS headers for all responses ──────────────────────────
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Route map ───────────────────────────────────────────────
    const routes = {
      '/': '/static/index.html',
      '/host': '/static/host.html',
      '/host.html': '/static/host.html',
      '/jeopardy': '/static/jeopardy.html',
      '/jeopardy.html': '/static/jeopardy.html',
      '/homophone': '/static/homophone.html',
      '/homophone.html': '/static/homophone.html',
      '/game.js': '/static/game.js',
    };

    // ── Static file proxy ───────────────────────────────────────
    if (routes[path]) {
      try {
        const resp = await fetch(GAME_REPO + routes[path]);
        if (!resp.ok) throw new Error('Not found');
        const body = await resp.text();
        const contentType = getContentType(routes[path]);
        return new Response(body, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
            ...corsHeaders,
          },
        });
      } catch (e) {
        return new Response('Error loading game files. Try again.', { status: 500, headers: corsHeaders });
      }
    }

    // ── WebSocket upgrade → proxy to Render ─────────────────────
    if (path.startsWith('/ws/')) {
      // Cloudflare Workers can't proxy WebSocket upgrades to arbitrary hosts
      // without Durable Objects. Return a helpful message instead.
      return new Response(
        JSON.stringify({
          error: 'Use Render WebSocket directly',
          wsUrl: 'wss://mrdavies.onrender.com' + path,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // ── Fallback ────────────────────────────────────────────────
    return new Response('Homophone Showdown — use / or /host?room=ABCD', {
      status: 200,
      headers: { 'Content-Type': 'text/plain', ...corsHeaders },
    });
  },
};

function getContentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
}