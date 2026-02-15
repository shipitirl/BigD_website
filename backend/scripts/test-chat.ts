import 'dotenv/config';
import { createSession } from '../lib/session';
import { runChatTurn } from '../lib/chatbot';

(async () => {
  const s = createSession();
  const r = await runChatTurn(s, 'hello');
  console.log('assistant:', r.assistantMessage);
})();
