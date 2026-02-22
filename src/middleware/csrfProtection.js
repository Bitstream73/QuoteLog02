import config from '../config/index.js';

/**
 * CSRF protection middleware.
 * Uses Sec-Fetch-Site header (most reliable), then falls back to
 * Origin/Referer verification. The auth cookie's sameSite: 'strict'
 * provides the primary CSRF defense; this is an additional layer.
 */
export function csrfProtection(req, res, next) {
  // Safe methods don't need CSRF protection
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (safeMethod) {
    return next();
  }

  // Sec-Fetch-Site is sent by all modern browsers and is the most
  // reliable way to detect same-origin requests (not spoofable by JS).
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'same-origin') {
    return next();
  }

  const origin = req.get('origin');

  // If no Origin header, check Referer as fallback
  if (!origin || origin === 'null') {
    const referer = req.get('referer');
    if (!referer) {
      // No origin info at all — allow the request since same-origin
      // requests from older browsers may not send Origin on POST.
      // Cookie sameSite: 'strict' provides the primary CSRF defense.
      return next();
    }

    // Validate referer against allowed origins
    try {
      const refererOrigin = new URL(referer).origin;
      if (isAllowedOrigin(refererOrigin, req)) {
        return next();
      }
    } catch {
      // Invalid referer URL
    }

    return res.status(403).json({ error: 'CSRF validation failed' });
  }

  // Validate Origin header
  if (isAllowedOrigin(origin, req)) {
    return next();
  }

  return res.status(403).json({ error: 'CSRF validation failed' });
}

function isAllowedOrigin(origin, req) {
  // In dev mode with wildcard CORS, allow everything
  if (config.corsOrigins.includes('*')) {
    return true;
  }

  // Check against the request's own Host header — handles reverse
  // proxies (Railway, nginx, etc.) without requiring APP_URL to match.
  if (req) {
    const host = req.get('host');
    if (host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost === host) {
          return true;
        }
      } catch {
        // Invalid origin URL
      }
    }
  }

  // Check against app URL origin
  try {
    const appOrigin = new URL(config.appUrl).origin;
    if (origin === appOrigin) {
      return true;
    }
  } catch {
    // Invalid appUrl
  }

  // Check against configured CORS origins
  for (const allowed of config.corsOrigins) {
    try {
      if (origin === new URL(allowed).origin) {
        return true;
      }
    } catch {
      // If the allowed origin is just a bare origin string, compare directly
      if (origin === allowed) {
        return true;
      }
    }
  }

  return false;
}
