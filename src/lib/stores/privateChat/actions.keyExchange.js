import { withChat } from './state.js';

export function setKeyExchangeState(chatId, state) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, keyExchangeState: state });
  });
}

