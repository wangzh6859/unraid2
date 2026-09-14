import { AppState } from 'react-native';

let lastAppState = 'active';
let appResumedTimestamp = Date.now();

// Track when app resumes from background (commonly happens when user switches VPN in quick settings/VPN app)
if (AppState) {
  AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active' && lastAppState !== 'active') {
      appResumedTimestamp = Date.now();
    }
    lastAppState = nextState;
  });
}

/**
 * Checks if an error is likely caused by an Android network routing switch
 * (e.g. toggling VPN on/off, switching WiFi/Cellular, stale OkHttp connection pool)
 */
function isNetworkRouteError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to connect') ||
    msg.includes('sockettimeoutexception') ||
    msg.includes('connectexception') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('broken pipe') ||
    msg.includes('connection closed') ||
    msg.includes('stream was reset')
  );
}

/**
 * Resilient API Fetch for Unraid Mobile Manager
 * 
 * Solves:
 * 1. OkHttp Connection Pool Stale Sockets after VPN / Proxy toggle
 * 2. Android network routing table changes (wlan0 <-> tun0)
 * 3. Cache-busting to prevent stale proxy responses
 * 4. Automatic retry on network route change
 */
export async function apiFetch(url, options = {}, timeoutMs = 9000, maxRetries = 1) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Append cache buster if not present
    let finalUrl = url;
    if (typeof finalUrl === 'string' && !finalUrl.includes('_t=')) {
      finalUrl += (finalUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`;
    }

    const mergedHeaders = {
      'Accept': 'application/json, text/plain, */*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Connection': 'close',
      ...(options.headers || {}),
    };

    try {
      const res = await (global._originalFetch || fetch)(finalUrl, {
        ...options,
        headers: mergedHeaders,
        signal: options.signal || controller.signal,
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      attempt++;

      // If caller intentionally aborted via signal, don't retry
      if (options.signal?.aborted) {
        throw err;
      }

      if (attempt <= maxRetries && isNetworkRouteError(err)) {
        // Wait 400ms for network routing table (tun0 / wlan0) to settle
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('网络请求失败，请检查网络连接或梯子/代理设置');
}

/**
 * Helper to fetch and parse JSON with automatic network resilience
 */
export async function apiFetchJson(url, options = {}, timeoutMs = 9000, maxRetries = 1) {
  const res = await apiFetch(url, options, timeoutMs, maxRetries);
  if (!res.ok) {
    let errBody = null;
    try {
      errBody = await res.json();
    } catch (_) {}
    throw new Error(errBody?.message || `服务端响应错误 (HTTP ${res.status})`);
  }
  const rawText = (await res.text()).trim();
  if (!rawText) {
    return { status: 'success' };
  }
  try {
    return JSON.parse(rawText);
  } catch (parseErr) {
    // If string has BOM or unexpected prefix
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      return JSON.parse(rawText.substring(jsonStart, jsonEnd + 1));
    }
    throw parseErr;
  }
}

/**
 * Install global network interceptor
 * Automatically adds Connection: close and retry for all fetch() calls targeting api.php
 */
export function installApiNetworkInterceptor() {
  if (global._apiNetworkInterceptorInstalled) return;
  global._apiNetworkInterceptorInstalled = true;
  global._originalFetch = global.fetch;

  global.fetch = async function (input, init = {}) {
    const urlStr = typeof input === 'string' ? input : (input?.url || '');
    if (urlStr && urlStr.includes('api.php')) {
      // It's a backend Unraid API call: route through resilient apiFetch
      return apiFetch(urlStr, init, 9000, 1);
    }
    return global._originalFetch(input, init);
  };
}

// Auto-install interceptor on import so all screens benefit automatically
installApiNetworkInterceptor();
