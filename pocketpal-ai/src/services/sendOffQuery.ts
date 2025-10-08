import {MessageType} from '../utils/types';

export type OffQueryResult = {
  acknowledged: boolean;
};

export const sendOffQuery = async (
  _message: MessageType.PartialText,
): Promise<OffQueryResult> => {
  await new Promise(resolve => setTimeout(resolve, 100));
  return {acknowledged: true};
};

