import { describe, expect, it } from 'vitest';
import {
  getSearchGeneralChatMessagesByContentQueryKey,
  getSearchGeneralChatMessagesByContentUrl,
} from './generated/api';

describe('general chat message search client contract', () => {
  it('encodes the query in the generated URL and includes it in the cache key', () => {
    const params = { query: 'Needle marker' };

    expect(getSearchGeneralChatMessagesByContentUrl(params)).toBe(
      '/api/ai/general-chat/message-search?query=Needle+marker',
    );
    expect(getSearchGeneralChatMessagesByContentQueryKey(params)).toEqual([
      '/api/ai/general-chat/message-search',
      params,
    ]);
  });
});
