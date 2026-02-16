import config from '../config/index.js';

/**
 * CSRF protection middleware using Origin header verification.
 * Skips safe methods (GET, HEAD, OPTIONS) and checks that the
 * Origin header matches the app's own origin or allowed CORS origins.
 */
export function csrfProtection(req, res, next) {
  // Safe methods don't need CSRF protection
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (safeMethod) {
    return next();
  }

  const origin = req.get('origin');

  // If no Origin header, check Referer as fallback
  if (!origin) {
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
      if (isAllowedOrigin(refererOrigin)) {
        return next();
      }
    } catch {
      // Invalid referer URL
    }

    return res.status(403).json({ error: 'CSRF validation failed' });
  }

  // Validate Origin header
  if (isAllowedOrigin(origin)) {
    return next();
  }

  return res.status(403).json({ error: 'CSRF validation failed' });
}

function isAllowedOrigin(origin) {
  // In dev mode with wildcard CORS, allow everything
  if (config.corsOrigins.includes('*')) {
    return true;
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
