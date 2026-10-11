import 'dotenv/config';

/** Birinchi topilgan qiymatni qaytaradi. Hech biri bo'lmasa - bot ishga tushmaydi. */
function required(names, hint) {
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }

  console.error(`\n❌ .env faylida ${list.map((n) => `"${n}"`).join(' yoki ')} yo'q.`);
  if (hint) console.error(`   ${hint}`);
  console.error(`   Namuna: cp .env.example .env\n`);
  process.exit(1);
}

function optional(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

export const config = {
  botToken: required('BOT_TOKEN', '@BotFather dan token oling.'),

  openaiKey: required('OPENAI_API_KEY', 'platform.openai.com dan kalit oling.'),
  openaiModel: optional('OPENAI_MODEL') || 'gpt-6-luna',

  // Ikkala nom ham ishlaydi
  mongoUrl: required(
    ['MONGODB_URI', 'MONGO_URL'],
    'Masalan: mongodb://localhost:27017/postAi'
  ),

  // Ixtiyoriy
  ownerId: optional('OWNER_ID') ? Number(optional('OWNER_ID')) : null,
  defaultTimezone: optional('DEFAULT_TIMEZONE') || 'Asia/Tashkent',
};
