/**
 * Whether the core service answers, as the frontend shows it. Mapped from the contract's health response.
 * `rejected`: the core answered 401, so it does not accept this session's token (spec 004).
 */
export type SystemStatus =
  | { readonly state: 'connecting' }
  | { readonly state: 'connected'; readonly version: string }
  | { readonly state: 'unreachable' }
  | { readonly state: 'rejected' };
