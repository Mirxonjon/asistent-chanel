/**
 * OpenAI kalitini tekshiradi va mavjud modellarni ko'rsatadi.
 * Ishlatish:  npm run models
 */
import OpenAI from 'openai';
import { config } from '../src/config.js';

const client = new OpenAI({ apiKey: config.openaiKey });

try {
  const list = await client.models.list();
  const ids = list.data.map((m) => m.id).sort();

  console.log(`\n✅ OpenAI kaliti ishlayapti. ${ids.length} ta model mavjud.\n`);

  // Matn yozish uchun mos modellarni ajratib ko'rsatamiz
  const text = ids.filter((id) => /^(gpt|o\d)/.test(id) && !/audio|realtime|image|tts|whisper|embed|moderation|transcri/.test(id));

  console.log('📝 Matn uchun mos modellar:');
  for (const id of text) {
    const mark = id === config.openaiModel ? '  ← .env da shu tanlangan' : '';
    console.log(`   ${id}${mark}`);
  }

  if (!ids.includes(config.openaiModel)) {
    console.log(`\n⚠️  Diqqat: .env dagi "${config.openaiModel}" ro'yxatda yo'q.`);
    console.log('   OPENAI_MODEL ni yuqoridagi ro\'yxatdan biriga o\'zgartiring.');
  }
  console.log('');
} catch (err) {
  console.error('\n❌ OpenAI kaliti ishlamadi:', err.message);
  if (err.status === 401) console.error('   Kalit noto\'g\'ri. .env dagi OPENAI_API_KEY ni tekshiring.');
  process.exit(1);
}
