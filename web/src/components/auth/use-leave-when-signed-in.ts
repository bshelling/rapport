"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "@/components/auth-provider";
import { consumeReturnTo } from "@/lib/auth";

/**
 * Auth pages send already-signed-in visitors on to where they were going.
 * Set `leaving.current` while a flow is signing in so it picks the destination.
 */
export function useLeaveWhenSignedIn() {
  const auth = useAuth();
  const router = useRouter();
  const leaving = useRef(false);

  useEffect(() => {
    if (auth.status === "signedIn" && !leaving.current)
      router.replace(consumeReturnTo("/dashboard/"));
  }, [auth.status, router]);

  return leaving;
}
