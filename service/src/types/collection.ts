// Type definitions for Postman v3 Collection format
// Kept intentionally permissive to work with partial/unknown inputs.

export interface V3Collection {
  info?: {
    name?: string;
    description?: string | { content?: string };
    schema?: string;
    version?: string | { major?: number; minor?: number; patch?: number };
    _postman_id?: string;
  };
  variable?: V3Variable[];
  auth?: V3Auth;
  item?: V3Item[];
  event?: V3Event[];
  [key: string]: unknown;
}

export interface V3Variable {
  key?: string;
  value?: unknown;
  type?: string;
  description?: string | { content?: string };
  disabled?: boolean;
}

export interface V3Auth {
  type?: string;
  [key: string]: unknown;
}

export interface V3Event {
  listen?: 'test' | 'prerequest' | string;
  script?: {
    type?: string;
    exec?: string | string[];
  };
  disabled?: boolean;
}

// A v3 item is either a folder (has item[]) or a request leaf.
export interface V3Item {
  name?: string;
  description?: string | { content?: string };
  item?: V3Item[]; // folder
  request?: V3Request;
  protocolProfileBehavior?: Record<string, unknown>;
  response?: V3Response[];
  event?: V3Event[];
  auth?: V3Auth;
  [key: string]: unknown;
}

export interface V3Request {
  method?: string;
  url?: string | V3Url;
  description?: string | { content?: string };
  header?: V3Header[];
  body?: V3Body;
  auth?: V3Auth;
  [key: string]: unknown;
}

export interface V3Url {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  path?: string | string[];
  port?: string;
  query?: V3QueryParam[];
  variable?: V3PathVariable[];
}

export interface V3Header {
  key?: string;
  value?: string;
  description?: string | { content?: string };
  disabled?: boolean;
  type?: string;
}

export interface V3QueryParam {
  key?: string;
  value?: string;
  description?: string | { content?: string };
  disabled?: boolean;
}

export interface V3PathVariable {
  key?: string;
  value?: string;
  description?: string | { content?: string };
}

export interface V3Body {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql' | string;
  raw?: string;
  urlencoded?: Array<{
    key?: string;
    value?: string;
    description?: string | { content?: string };
    disabled?: boolean;
  }>;
  formdata?: Array<{
    key?: string;
    value?: string;
    type?: string;
    description?: string | { content?: string };
    disabled?: boolean;
  }>;
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
}

export interface V3Response {
  name?: string;
  status?: string;
  code?: number;
  body?: string;
  header?: V3Header[];
  originalRequest?: V3Request;
}

// Flattened request info used by the scorer
export interface FlatEndpoint {
  path: string[]; // folder breadcrumbs incl. request name at end
  name: string;
  method: string;
  url: V3Url | string | undefined;
  request: V3Request | undefined;
  item: V3Item;
  effectiveAuth?: V3Auth;
  tests: string[]; // concatenated test script bodies
  preRequests: string[];
  examples: V3Response[];
  description: string;
}
