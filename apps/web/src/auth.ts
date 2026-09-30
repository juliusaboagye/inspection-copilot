import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { setTokenProvider } from './api';

/**
 * Entra ID sign-in with MSAL (authorization code + PKCE). Enabled when VITE_AUTH_MODE=entra.
 * The API validates the token and checks app roles (Inspection.Read / Inspection.Review).
 */
export async function initAuth() {
  if (import.meta.env.VITE_AUTH_MODE !== 'entra') return;
  const pca = new PublicClientApplication({
    auth: {
      clientId: import.meta.env.VITE_ENTRA_SPA_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await pca.initialize();
  const result = await pca.handleRedirectPromise();
  const account = result?.account ?? pca.getAllAccounts()[0];
  if (!account) { await pca.loginRedirect({ scopes: [import.meta.env.VITE_API_SCOPE] }); return; }
  pca.setActiveAccount(account);
  setTokenProvider(async () => {
    try {
      return (await pca.acquireTokenSilent({ scopes: [import.meta.env.VITE_API_SCOPE], account })).accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) await pca.acquireTokenRedirect({ scopes: [import.meta.env.VITE_API_SCOPE] });
      throw e;
    }
  });
}
