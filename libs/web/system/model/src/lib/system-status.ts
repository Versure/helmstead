/** Whether the core service answers, as the frontend shows it. Mapped from the contract's health response. */
export type SystemStatus =
  | { readonly state: 'connecting' }
  | { readonly state: 'connected'; readonly version: string }
  | { readonly state: 'unreachable' };
