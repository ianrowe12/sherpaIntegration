import * as React from 'react';

import {offModeStore} from '../store';

export const OffModeContext = React.createContext<{
  offMode: boolean;
  setOffMode: (value: boolean) => void;
} | null>(null);

export const OffModeProvider = ({
  sessionId,
  children,
}: {
  sessionId?: string | null;
  children: React.ReactNode;
}) => {
  const [offMode, setOffModeState] = React.useState(() =>
    offModeStore.getValue(sessionId),
  );

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      const value = await offModeStore.getValueAsync(sessionId);
      if (mounted) {
        setOffModeState(value);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [sessionId]);

  const setOffMode = React.useCallback(
    (value: boolean) => {
      offModeStore.setValue(value, sessionId);
      setOffModeState(value);
    },
    [sessionId],
  );

  const value = React.useMemo(
    () => ({
      offMode,
      setOffMode,
    }),
    [offMode, setOffMode],
  );

  return (
    <OffModeContext.Provider value={value}>
      {children}
    </OffModeContext.Provider>
  );
};

export const useOffMode = () => {
  const context = React.useContext(OffModeContext);
  if (!context) {
    throw new Error('useOffMode must be used within an OffModeProvider');
  }
  return context;
};

