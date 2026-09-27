"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { ReportFlow, storeDraftId } from "@/components/report/report-flow";

type ReportContextValue = {
  /** Opens the report modal, resuming `draftId` (e.g. one the assistant drafted). */
  openReport: (draftId?: string) => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openReport = useCallback((draftId?: string) => {
    if (draftId) storeDraftId(draftId);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ openReport }), [openReport]);

  return (
    <ReportContext.Provider value={value}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background shadow-2xl outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90vh] sm:w-[min(40rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
          >
            <ReportFlow onClose={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ReportContext.Provider>
  );
}

export function useReport(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error("useReport must be used inside <ReportProvider>");
  return ctx;
}
