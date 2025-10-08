import React, {useRef, ReactNode} from 'react';

import {observer} from 'mobx-react';

import {Bubble, ChatView, ErrorSnackbar} from '../../components';

import {useChatSession} from '../../hooks';
import {OffModeProvider, useOffMode} from '../../hooks/useOffMode';
import {routeToOff} from '../../off/router';
import {getLastOffUrl} from '../../off/api';
import {OffMessage} from '../../off/OffMessage';

import {modelStore, chatSessionStore, palStore, uiStore} from '../../store';

import {L10nContext} from '../../utils';
import {MessageType} from '../../utils/types';
import {sendOffQuery} from '../../services/sendOffQuery';
import {user, assistant} from '../../utils/chat';

import {VideoPalScreen} from './VideoPalScreen';
import {PalType} from '../../components/PalsSheets/types';

const renderBubble = ({
  child,
  message,
  nextMessageInGroup,
  scale,
}: {
  child: ReactNode;
  message: MessageType.Any;
  nextMessageInGroup: boolean;
  scale?: any;
}) => (
  <Bubble
    child={child}
    message={message}
    nextMessageInGroup={nextMessageInGroup}
    scale={scale}
  />
);

export const ChatScreen: React.FC = observer(() => {
  const currentMessageInfo = useRef<{
    createdAt: number;
    id: string;
    sessionId: string;
  } | null>(null);
  const l10n = React.useContext(L10nContext);

  const {handleSendPress, handleStopPress, isMultimodalEnabled} =
    useChatSession(currentMessageInfo, user, assistant);

  // Check if multimodal is enabled
  const [multimodalEnabled, setMultimodalEnabled] = React.useState(false);

  React.useEffect(() => {
    const checkMultimodal = async () => {
      const enabled = await isMultimodalEnabled();
      setMultimodalEnabled(enabled);
    };

    checkMultimodal();
  }, [isMultimodalEnabled]);

  const thinkingSupported = modelStore.activeModel?.supportsThinking ?? false;

  const thinkingEnabled = (() => {
    const currentSession = chatSessionStore.sessions.find(
      s => s.id === chatSessionStore.activeSessionId,
    );
    const settings =
      currentSession?.completionSettings ??
      chatSessionStore.newChatCompletionSettings;
    return settings.enable_thinking ?? true;
  })();

  // Show loading bubble only during the thinking phase (inferencing but not streaming)
  const isThinking = modelStore.inferencing && !modelStore.isStreaming;

  const handleThinkingToggle = async (enabled: boolean) => {
    const currentSession = chatSessionStore.sessions.find(
      s => s.id === chatSessionStore.activeSessionId,
    );

    if (currentSession) {
      // Update session-specific settings
      const updatedSettings = {
        ...currentSession.completionSettings,
        enable_thinking: enabled,
      };
      await chatSessionStore.updateSessionCompletionSettings(updatedSettings);
    } else {
      // Update global settings for new chats
      const updatedSettings = {
        ...chatSessionStore.newChatCompletionSettings,
        enable_thinking: enabled,
      };
      await chatSessionStore.setNewChatCompletionSettings(updatedSettings);
    }
  };

  const activePalId = chatSessionStore.activePalId;
  const activePal = activePalId
    ? palStore.pals.find(p => p.id === activePalId)
    : undefined;
  const isVideoPal = activePal?.palType === PalType.VIDEO;

  // If the active pal is a video pal, show the video pal screen
  if (isVideoPal) {
    return <VideoPalScreen />;
  }

  // Otherwise, show the regular chat view
  return (
    <>
      <OffModeProvider sessionId={chatSessionStore.activeSessionId}>
        <OffAwareChatView
          renderBubble={renderBubble}
          messages={chatSessionStore.currentSessionMessages}
          onSendPress={handleSendPress}
          onStopPress={handleStopPress}
          user={user}
          isStopVisible={modelStore.inferencing}
          isThinking={isThinking}
          isStreaming={modelStore.isStreaming}
          sendButtonVisibilityMode="always"
          showImageUpload={true}
          isVisionEnabled={multimodalEnabled}
          inputProps={{
            showThinkingToggle: thinkingSupported,
            isThinkingEnabled: thinkingEnabled,
            onThinkingToggle: handleThinkingToggle,
          }}
          textInputProps={{
            editable: !!modelStore.context,
            placeholder: !modelStore.context
              ? modelStore.isContextLoading
                ? l10n.chat.loadingModel
                : l10n.chat.modelNotLoaded
              : l10n.chat.typeYourMessage,
          }}
          renderCustomMessage={(message) => {
            // Render OFF custom bubbles
            const meta = (message as any)?.metadata;
            if (meta?.off && meta?.offAnswer) {
              return <OffMessage answer={meta.offAnswer} />;
            }
            return null;
          }}
        />
      </OffModeProvider>
      {uiStore.chatWarning && (
        <ErrorSnackbar
          error={uiStore.chatWarning}
          onDismiss={() => uiStore.clearChatWarning()}
        />
      )}
    </>
  );
});

const OffAwareChatView = observer(
  (
    props: React.ComponentProps<typeof ChatView> & {
      onSendPress: (message: MessageType.PartialText) => Promise<void>;
    },
  ) => {
    const {offMode} = useOffMode();
    const onSendPress = async (message: MessageType.PartialText) => {
      if (offMode) {
        // In OFF mode: add only the user message, skip LLM pipeline
        const textMessage: MessageType.Text = {
          author: user,
          createdAt: Date.now(),
          id: '',
          text: message.text,
          type: 'text',
          imageUris: message.imageUris,
          metadata: {
            ...(message.metadata || {}),
            offMode: true,
          },
        };
        await chatSessionStore.addMessageToCurrentSession(textMessage);
        try {
          const started = Date.now();
          const offAnswer = await routeToOff(message.text);
          const elapsed = Date.now() - started;
          if (__DEV__) {
            console.log('[OFF] routeToOff ms:', elapsed, 'url:', getLastOffUrl());
          }

          // Push assistant custom OFF bubble
          await chatSessionStore.addMessageToCurrentSession({
            author: assistant,
            createdAt: Date.now(),
            id: '',
            type: 'custom',
            text: '',
            metadata: {off: true, offAnswer, url: getLastOffUrl()},
          } as any);
        } catch (e: any) {
          const msg = String(e?.message || e || 'OFF request failed');
          if (msg.includes('429') || msg.toLowerCase().includes('rate')) {
            await chatSessionStore.addMessageToCurrentSession({
              author: assistant,
              createdAt: Date.now(),
              id: '',
              type: 'text',
              text: "We're temporarily rate-limited, please try again in a few seconds.",
            });
          } else {
            await chatSessionStore.addMessageToCurrentSession({
              author: assistant,
              createdAt: Date.now(),
              id: '',
              type: 'text',
              text: `OFF error: ${msg}`,
            });
          }
        }
        return;
      }
      await props.onSendPress(message);
    };

    return <ChatView {...props} onSendPress={onSendPress} />;
  },
);
