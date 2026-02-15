// Type declarations for @cloudflare/next-on-pages
// This package is available at runtime in Cloudflare Pages Functions
// but not installed locally for development

declare module "@cloudflare/next-on-pages" {
  interface RequestContext {
    env: unknown;  // Use unknown to allow safe casting
    ctx: ExecutionContext;
    cf: IncomingRequestCfProperties;
  }

  export function getRequestContext(): RequestContext;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface IncomingRequestCfProperties {
  colo?: string;
  country?: string;
  city?: string;
  continent?: string;
  latitude?: string;
  longitude?: string;
  postalCode?: string;
  region?: string;
  timezone?: string;
}
