/**
 * AI post sifatini sinash. Botga ulamasdan, to'g'ridan terminalda ko'rish.
 *
 * Ishlatish:
 *   node scripts/test-post.js
 *   node scripts/test-post.js "Stop-loss qo'yishning 3 xatosi"
 */
import { generatePost, suggestTopic } from '../src/ai.js';
import { config } from '../src/config.js';

const CHANNEL_TOPIC = 'Trading, investitsiya va bozor tahlili. Boshlovchilar uchun.';

const RECENT = [
  'Bitcoin narxi nega tushdi',
  'Diversifikatsiya nima',
];

const t0 = Date.now();
console.log(`\nModel: ${config.openaiModel}\n`);

// --- Mavzu: argumentdan yoki AI o'zi tanlaydi ---
let topic = process.argv[2];
if (!topic) {
  console.log('Mavzu berilmadi — AI o‘zi tanlaydi...');
  topic = await suggestTopic({ channelTopic: CHANNEL_TOPIC, recentTopics: RECENT });
  console.log(`✓ AI tanladi: "${topic}"\n`);
} else {
  console.log(`Mavzu: "${topic}"\n`);
}

// --- Post yozish ---
const post = await generatePost({
  topic,
  channelTopic: CHANNEL_TOPIC,
  tone: 'professional',
  recentTopics: RECENT,
});

const ms = Date.now() - t0;

console.log('─'.repeat(60));
console.log(post);
console.log('─'.repeat(60));
console.log(`\n📏 ${post.length} belgi   ⏱  ${(ms / 1000).toFixed(1)}s`);

// --- Taqiqlangan teg qoldimi? ---
const bad = [...post.matchAll(/<\/?([a-zA-Z0-9-]+)[^>]*>/g)]
  .map((m) => m[1].toLowerCase())
  .filter(
    (tag) =>
      !/^(b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|a|span|tg-spoiler|tg-emoji)$/.test(tag)
  );

if (bad.length) {
  console.log(`\n⚠️  Taqiqlangan teg topildi: ${[...new Set(bad)].join(', ')}`);
} else {
  console.log('✅ Teglar toza — Telegram qabul qiladi');
}

if (post.length > 1000) {
  console.log(`⚠️  Uzunroq chiqdi (${post.length}) — prompt'ni qattiqlashtirish kerak`);
}
console.log('');
