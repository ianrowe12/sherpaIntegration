import * as React from 'react';

import {modelStore} from '../store/ModelStore';
import {startVadContinuous, stopVadContinuous} from '../services/audio/Recorder';
import {addSpeakingListener, isSpeaking} from '../services/tts';

/**
 * Auto-start VAD while assistant is speaking or streaming tokens, and stop it afterwards.
 * This enables barge-in without manually toggling the mic.
 */
export function useAutoVadBargeIn(enabled: boolean = true) {
  React.useEffect(() => {
    if (!enabled) return;
    let isMounted = true;

    let speakingSub: {remove?: () => void} | null = null;
    let lastSpeaking = isSpeaking();

    const ensureVad = async () => {
      try {
        const needVad = modelStore.isStreaming || lastSpeaking;
        if (needVad) {
          await startVadContinuous();
        } else {
          await stopVadContinuous();
        }
      } catch {}
    };

    // Initial set
    void ensureVad();

    // React to speaking state changes
    speakingSub = addSpeakingListener(s => {
      lastSpeaking = s;
      void ensureVad();
    });

    // React to streaming state changes
    const unsubStreaming = modelStore.observe?.((change: any) => {
      if (change?.name === 'isStreaming') {
        void ensureVad();
      }
    });

    return () => {
      isMounted = false;
      try { speakingSub?.remove?.(); } catch {}
      if (unsubStreaming) {
        try { unsubStreaming(); } catch {}
      }
      // Stop VAD when hook unmounts
      void stopVadContinuous();
    };
  }, [enabled]);
}


