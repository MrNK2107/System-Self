import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { LogModal } from "@/components/LogModal";

interface LogSheetValue {
  /** Open the log sheet (the Log tab, and any "log it" action inside the tabs). */
  openLog: () => void;
}

const LogSheetContext = createContext<LogSheetValue>({ openLog: () => {} });

/** One log sheet for the whole tab area, so the Log tab opens logging directly instead of a page. */
export function LogSheetProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const openLog = useCallback(() => setVisible(true), []);
  const value = useMemo(() => ({ openLog }), [openLog]);
  return (
    <LogSheetContext.Provider value={value}>
      {children}
      <LogModal visible={visible} onClose={() => setVisible(false)} />
    </LogSheetContext.Provider>
  );
}

export function useLogSheet(): LogSheetValue {
  return useContext(LogSheetContext);
}
