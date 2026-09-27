import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "";
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
export const authConfigured = Boolean(userPoolId && userPoolClientId);

let configured = false;

/** Configure Amplify once, in the browser. Sign-in happens on our own pages (SRP). */
export function configureAuth() {
  if (configured || !authConfigured || typeof window === "undefined") return;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { email: true },
      },
    },
  });
  configured = true;
}

/** Cognito ID token for API calls (API Gateway's JWT authorizer expects it). */
export async function getIdToken(): Promise<string | undefined> {
  if (!authConfigured) return undefined;
  configureAuth();
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString();
}

const RETURN_TO_KEY = "rapport.returnTo";

export function rememberReturnTo(path: string) {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch {
    // storage unavailable (private mode); fall back to default
  }
}

export function consumeReturnTo(fallback = "/profile/"): string {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    // Only allow same-site relative paths.
    if (value?.startsWith("/") && !value.startsWith("//")) return value;
  } catch {
    // ignore
  }
  return fallback;
}
