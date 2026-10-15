// Provider adapters. An adapter only talks to a supplier API it has been configured for.
// Without credentials it reports a blocker; with credentials but without a verified client
// it still refuses to fetch. Neither path returns made-up supplier data.

import type { InventoryCheck, SupplierProductSnapshot, SupplierProvider } from './types';

export class SupplierNotConfiguredError extends Error {
  constructor(public readonly provider: SupplierProvider, public readonly missing: string[]) {
    super(`${provider} supplier sync is blocked: missing ${missing.join(', ')}`);
    this.name = 'SupplierNotConfiguredError';
  }
}

export class SupplierClientUnverifiedError extends Error {
  constructor(public readonly provider: SupplierProvider) {
    super(`${provider} API client has not been verified against live credentials; sync is disabled`);
    this.name = 'SupplierClientUnverifiedError';
  }
}

export interface SupplierAdapter {
  readonly provider: SupplierProvider;
  /** Empty array when the adapter can run; otherwise the names of the missing settings. */
  missingConfig(): string[];
  fetchProduct(supplierProductId: string): Promise<SupplierProductSnapshot>;
  checkInventory(supplierProductId: string, skus: string[]): Promise<InventoryCheck[]>;
}

type Env = Record<string, string | undefined>;

function makeAdapter(provider: SupplierProvider, requiredEnv: string[], env: Env): SupplierAdapter {
  const missing = requiredEnv.filter((name) => !env[name]?.trim());
  const blocked = (): never => {
    if (missing.length > 0) throw new SupplierNotConfiguredError(provider, missing);
    throw new SupplierClientUnverifiedError(provider);
  };
  return {
    provider,
    missingConfig: () => missing,
    async fetchProduct() {
      return blocked();
    },
    async checkInventory() {
      return blocked();
    },
  };
}

export const ALIEXPRESS_ENV = ['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET'] as const;
export const ALIBABA_ENV = ['ALIBABA_APP_KEY', 'ALIBABA_APP_SECRET'] as const;

export function createAliExpressAdapter(env: Env): SupplierAdapter {
  return makeAdapter('aliexpress', [...ALIEXPRESS_ENV], env);
}

export function createAlibabaAdapter(env: Env): SupplierAdapter {
  return makeAdapter('alibaba', [...ALIBABA_ENV], env);
}
