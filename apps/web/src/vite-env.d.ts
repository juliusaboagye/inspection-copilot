/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_AUTH_MODE?: 'none' | 'entra';
  readonly VITE_ENTRA_TENANT_ID: string;
  readonly VITE_ENTRA_SPA_CLIENT_ID: string;
  readonly VITE_API_SCOPE: string;
}
