import { useEffect, useState } from "react";

export type ExitState = {
  isExitConfirmOpen: boolean;
  openExitConfirm: () => void;
  closeExitConfirm: () => void;
};

export const useExitConfirmation = (): ExitState => {
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);

  const openExitConfirm = (): void => setIsExitConfirmOpen(true);
  const closeExitConfirm = (): void => setIsExitConfirmOpen(false);

  useEffect(() => {
    const onSigint = (): void => {
      setIsExitConfirmOpen(true);
    };

    process.on("SIGINT", onSigint);
    return () => {
      process.off("SIGINT", onSigint);
    };
  }, []);

  return { isExitConfirmOpen, openExitConfirm, closeExitConfirm };
};
