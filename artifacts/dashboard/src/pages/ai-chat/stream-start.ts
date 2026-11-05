import type { ChatMessage } from './types';

type OptimisticUserMessageInput = {
  message: string;
  idTimestamp: number;
  createdAt: string;
};

export function createOptimisticUserMessage({
  message,
  idTimestamp,
  createdAt,
}: OptimisticUserMessageInput): ChatMessage {
  return {
    id: `opt-${idTimestamp}`,
    role: 'user',
    content: message,
    createdAt,
  };
}
