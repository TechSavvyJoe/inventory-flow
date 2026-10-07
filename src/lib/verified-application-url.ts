/**
 * Accept only explicit public HTTPS application URLs from server configuration.
 * These are navigation hints, never authentication or authorization grants.
 */
export function verifiedApplicationUrl(value: string | undefined, path: '/platform' | '/inventory'): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const privateSuffixes = ['.localhost', '.local', '.internal', '.test', '.invalid', '.example', '.lan', '.home']
    const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname)
    const publicHostname = hostname.includes('.') && !hostname.endsWith('.') && !hostname.includes(':') && !ipv4 &&
      !privateSuffixes.some((suffix) => hostname.endsWith(suffix))
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || url.pathname !== path || !publicHostname) return undefined
    return url.href
  } catch {
    return undefined
  }
}
