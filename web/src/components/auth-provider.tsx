"use client";

import { getCurrentUser, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authConfigured, configureAuth, rememberReturnTo } from "@/lib/auth";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; userId: string; email?: string }
  | { status: "unavailable" };

type AuthContextValue = AuthState & {
  signIn: (returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>(
    authConfigured ? { status: "loading" } : { status: "unavailable" },
  );

  const refresh = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      setState({
        status: "signedIn",
        userId: user.userId,
        email: user.signInDetails?.loginId,
      });
    } catch {
      setState({ status: "signedOut" });
    }
  }, []);

  useEffect(() => {
    if (!authConfigured) return;
    configureAuth();
    refresh();
    return Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn") refresh();
      if (payload.event === "signedOut") setState({ status: "signedOut" });
    });
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      // Sends the visitor to our sign-in page; they come back here afterwards.
      signIn: async (returnTo) => {
        rememberReturnTo(returnTo ?? window.location.pathname);
        router.push("/sign-in/");
      },
      signOut: async () => {
        configureAuth();
        await signOut();
        router.push("/");
      },
    }),
    [state, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
