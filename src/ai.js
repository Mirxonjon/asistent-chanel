import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';

const client = new OpenAI({ apiKey: config.openaiKey });

// =====================================================================
//  Telegram HTML — faqat shu teglar ishlaydi. Boshqasi xato beradi.
// =====================================================================
const ALLOWED_TAGS =
  /^(b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|a|span|tg-spoiler|tg-emoji)$/i;

/** Shundan qisqa post — demak kesilgan yoki yarim chiqqan */
const MIN_POST_CHARS = 450;

/** Birinchi urinish, keyin kattaroq chegara bilan takror */
const TOKEN_LIMITS = [4000, 8000];

/** Reja uzun ro'yxat — ko'proq token kerak */
const PLAN_TOKEN_LIMITS = [8000, 16000];

const TONE_HINT = {
  professional: 'Jiddiy, ishonchli, ekspert ohangi. Faktlarga tayan.',
  sodda: 'Oddiy, tushunarli til. Murakkab atamalarni izohla.',
  qiziqarli: 'Yengil, jonli ohang. Savol va qiziqarli faktlar bilan.',
};

// =====================================================================
//  SYSTEM PROMPT — post ko'rinishini shu belgilaydi
// =====================================================================
function buildInstructions({ tone, language }) {
  const langRule =
    language === 'uz'
      ? `O'ZBEK TILI, FAQAT LOTIN ALIFBOSIDA.

QAT'IY TIL QOIDASI:
- Kirill harflari MUTLAQO ishlatilmasin: а б в г д е ж з и к л м н о п р с т у ф х ц ч ш э ю я қ ғ ҳ ў
- Turkcha harflar ishlatilmasin: ı ş ğ ç ö ü
- Turkcha so'zlar ishlatilmasin (masalan "kaldıraç" ❌ → "leveraj" yoki "yelka" ✅)
- Ruscha so'z o'rniga o'zbekcha yoki xalqaro atama ishlat
- Yozib bo'lgach matnni qayta o'qib chiq: bitta ham kirill harfi
  qolmaganiga ishonch hosil qil. Bu eng muhim tekshiruv.`
      : language;

  return `Sen Telegram kanallari uchun post yozadigan professional kontent muallifisan.

TIL: ${langRule}

OHANG: ${TONE_HINT[tone] ?? TONE_HINT.professional}

=== POST TUZILISHI (qat'iy rioya qil) ===
1-qator:  <b>Sarlavha</b> — oldida 1 ta mos emoji. Qisqa, 3-7 so'z.
          (bo'sh qator)
Kirish:   1-2 gap. O'quvchini qiziqtiradi, muammoni aytadi.
          (bo'sh qator)
Asosiy:   3 ta punkt (maksimum 4). Har biri shu ko'rinishda:
          • <b>Kalit so'z</b> — BIR qisqa gap. Ikki gap yozma.
          (bo'sh qator)
Iqtibos:  <blockquote>Eng muhim fikr yoki xulosa</blockquote>
          (bo'sh qator)
Yakun:    1 gap + o'quvchiga savol (izoh yozishga undaydi)
          (bo'sh qator)
Teglar:   2-4 ta hashtag

=== FORMAT QOIDALARI ===
RUXSAT ETILGAN teglar — faqat shular:
<b>  <i>  <u>  <s>  <code>  <blockquote>  <a href="...">

QAT'IY TAQIQLANGAN (Telegram bularni qabul qilmaydi, xato beradi):
<h1> <h2> <p> <ul> <ol> <li> <br> <div> <span> <table>
Markdown ham ishlatma: ** yoki ## yoki * yoki __

=== UZUNLIK ===
Butun post 600-850 belgi. Bu QAT'IY chegara — undan uzun post o'qilmaydi.
Yozib bo'lgach uzunligini tekshir, uzun bo'lsa punktlarni qisqartir.

=== EMOJI ===
Jami 3-5 ta. Sarlavhada 1 ta, punktlarda kerak bo'lsa.
Har bir qatorga emoji qo'yma — bu arzon ko'rinadi.

=== USLUB ===
- Punktlar ichida ro'yxat ichida ro'yxat qilma
- "Bugun biz..." / "Keling, ko'rib chiqamiz" kabi bo'sh ochilishlardan voz kech
- Aniq raqam va fakt bo'lsa — ishlat
- Har gapni yangi fikr bilan boshla, takrorlama
- Oxirgi savol haqiqiy savol bo'lsin, rasmiy emas

FAQAT post matnini qaytar. Izoh, sarlavha, "mana post:" kabi narsa yozma.`;
}

// =====================================================================
//  Til tekshiruvi
// =====================================================================

const CYRILLIC = /[Ѐ-ӿ]/;
const TURKISH = /[ışğçöüİŞĞÇÖÜ]/;

/** O'zbekcha postda begona alifbo topilsa konsolga ogohlantirish yozadi */
export function warnForeignScript(text) {
  const words = text.split(/\s+/).filter((w) => CYRILLIC.test(w) || TURKISH.test(w));
  if (words.length === 0) return false;

  log.warn(
    `AI begona alifbo ishlatdi (${words.length} so'z):`,
    [...new Set(words)].slice(0, 8).join(', ')
  );
  return true;
}

// =====================================================================
//  Javobni o'qish
// =====================================================================

/**
 * Responses API javobidan matnni oladi.
 *
 * gpt-6-luna kabi modellar javobdan oldin "o'ylaydi" va o'sha reasoning
 * tokenlari ham max_output_tokens ichidan yeyiladi. Chegara yetmasa
 * status="incomplete" bo'lib, output_text BO'SH qaytadi — xatosiz, jim.
 * Shuning uchun sababini aniq aytib xato chiqaramiz.
 */
function readOutput(response, label) {
  const text = response.output_text?.trim() ?? '';
  const reason = response.incomplete_details?.reason ?? null;
  const reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens ?? 0;

  // DIQQAT: javob YARIM kelishi ham mumkin — matn bor, lekin kesilgan.
  // Shuni ham ushlaymiz, aks holda yarim post foydalanuvchiga ketadi.
  const incomplete = response.status === 'incomplete' || reason !== null;

  if (!text) {
    if (reason === 'max_output_tokens') {
      throw new Error(
        `${label}: token chegarasi yetmadi (o'ylashga ${reasoningTokens} token ketdi)`
      );
    }
    if (reason) throw new Error(`${label}: javob tugallanmadi (${reason})`);
    throw new Error(`${label}: AI bo'sh javob qaytardi (status=${response.status})`);
  }

  return { text, incomplete, reason, reasoningTokens };
}

// =====================================================================
//  1. Post yozish
// =====================================================================

/**
 * @param {object} p
 * @param {string} p.topic          - shu post mavzusi
 * @param {string} p.channelTopic   - kanalning umumiy mavzusi (kontekst)
 * @param {string} [p.tone]
 * @param {string} [p.language]
 * @param {string[]} [p.recentTopics] - oxirgi postlar (takrorlanmasin)
 * @returns {Promise<string>} Telegram HTML
 */
export async function generatePost({
  topic,
  channelTopic,
  tone = 'professional',
  language = 'uz',
  recentTopics = [],
}) {
  const input = [
    `KANAL MAVZUSI: ${channelTopic}`,
    '',
    `SHU POST MAVZUSI: ${topic}`,
    recentTopics.length
      ? `\nOXIRGI POSTLAR (bularni takrorlama):\n${recentTopics.map((t) => `- ${t}`).join('\n')}`
      : '',
    '',
    'Yuqoridagi mavzuda post yoz.',
  ]
    .filter(Boolean)
    .join('\n');

  const instructions = buildInstructions({ tone, language });
  let best = '';

  // Javob kesilib qolsa yoki juda qisqa chiqsa — kattaroq chegara bilan
  // qayta urinamiz. Yarim post foydalanuvchiga ketmasligi kerak.
  for (const maxTokens of TOKEN_LIMITS) {
    const response = await client.responses.create({
      model: config.openaiModel,
      instructions,
      input,
      // DIQQAT: reasoning modellarida bu chegara "o'ylash" tokenlarini ham
      // o'z ichiga oladi. Past qo'yilsa javob bo'sh yoki yarim qaytadi.
      max_output_tokens: maxTokens,
    });

    const out = readOutput(response, 'Post');
    const text = sanitizeTelegramHtml(out.text);

    const tooShort = text.length < MIN_POST_CHARS;
    if (!out.incomplete && !tooShort) {
      if (language === 'uz') warnForeignScript(text);
      return text;
    }

    log.warn(
      `Post ${out.incomplete ? 'kesilgan' : 'juda qisqa'} ` +
        `(${text.length} belgi, o'ylashga ${out.reasoningTokens} token) — qayta urinilmoqda`
    );
    if (text.length > best.length) best = text;
  }

  // Ikkala urinish ham muammoli bo'ldi
  if (best.length < MIN_POST_CHARS) {
    throw new Error(
      `Post to'liq chiqmadi (${best.length} belgi). "Qayta yozish" tugmasini bosing.`
    );
  }

  log.warn('Post to‘liq emas, eng yaxshi variant qaytarilmoqda');
  if (language === 'uz') warnForeignScript(best);
  return best;
}

// =====================================================================
//  2. Mavzu o'ylab topish (reja bo'yicha avto post uchun)
// =====================================================================

/**
 * Kanal mavzusidan kelib chiqib yangi post mavzusini tanlaydi.
 * Oxirgi mavzular berilsa — ularni takrorlamaydi.
 */
export async function suggestTopic({ channelTopic, recentTopics = [] }) {
  const input = [
    `KANAL MAVZUSI: ${channelTopic}`,
    recentTopics.length
      ? `\nALLAQACHON YOZILGAN (takrorlama):\n${recentTopics.map((t) => `- ${t}`).join('\n')}`
      : '',
    '',
    'Shu kanal uchun yangi post mavzusini tanla.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.responses.create({
    model: config.openaiModel,
    instructions: `Sen Telegram kanali uchun post mavzularini tanlaysan.

Faqat BITTA mavzuni qaytar — 3-8 so'zdan iborat, aniq va qiziqarli.
O'zbek tilida, lotin alifbosida.

Qoidalar:
- Umumiy emas, aniq bo'lsin. "Trading haqida" ❌ / "Stop-loss qo'yishning 3 xatosi" ✅
- Berilgan ro'yxatdagi mavzularga o'xshamasin
- Hech qanday izoh, raqam, tire yoki qo'shtirnoq qo'shma
- Faqat mavzu matnini qaytar`,
    input,
    // Mavzu qisqa bo'lsa ham, model avval "o'ylaydi" — o'sha tokenlar
    // ham shu chegaradan yeyiladi. 120 qo'yilsa bo'sh javob qaytadi.
    max_output_tokens: 2000,
  });

  const topic = readOutput(response, 'Mavzu')
    .text.trim()
    .replace(/^["'\-\s]+|["'\s]+$/g, '')
    .split('\n')[0]; // model bir nechta variant bersa — birinchisini ol

  if (topic.length < 3) throw new Error('Mavzu juda qisqa chiqdi');

  return topic.slice(0, 200);
}

// =====================================================================
//  3. Kontent reja — bir chaqiruvda N ta mavzu
// =====================================================================

/**
 * Kanal mavzusidan kelib chiqib N kunlik mavzular ro'yxatini tuzadi.
 *
 * Bitta chaqiruvda hammasi chiqadi — 30 ta alohida so'rov emas.
 * Matn yozilmaydi: u post chiqish payti yoziladi (yangi va arzon).
 *
 * @returns {Promise<string[]>}
 */
export async function generatePlan({
  channelTopic,
  count,
  tone = 'professional',
  language = 'uz',
  recentTopics = [],
  avoid = [],
}) {
  const skip = [...recentTopics, ...avoid];

  const input = [
    `KANAL MAVZUSI: ${channelTopic}`,
    `KERAK: ${count} ta mavzu`,
    skip.length
      ? `\nBULARNI TAKRORLAMA:\n${skip.map((t) => `- ${t}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const instructions = `Sen Telegram kanali uchun kontent reja tuzasan.

TIL: ${language === 'uz' ? "O'zbek tili, FAQAT lotin alifbosida. Kirill va turkcha harflar mutlaqo ishlatilmasin." : language}

VAZIFA: berilgan songa teng mavzu ro'yxatini tuz.

QOIDALAR:
- Har bir mavzu alohida qatorda
- Raqam, tire, nuqta, qo'shtirnoq QO'YMA — faqat mavzu matni
- Har biri 3-8 so'z
- Umumiy emas, ANIQ bo'lsin:
    "Trading haqida" ❌
    "Stop-loss qo'yishning 3 xatosi" ✅
- Mavzular bir-birini takrorlamasin
- Oson mavzudan murakkabga qarab tartibla — o'quvchi ketma-ket
  o'qisa, bilimi bosqichma-bosqich oshsin (ta'lim kursi kabi)
- Xilma-xil bo'lsin: ta'rif, xato, qiyoslash, amaliy maslahat, misol

FAQAT ro'yxatni qaytar. Sarlavha, izoh, raqam yozma.`;

  for (const maxTokens of PLAN_TOKEN_LIMITS) {
    const response = await client.responses.create({
      model: config.openaiModel,
      instructions,
      input,
      max_output_tokens: maxTokens,
    });

    const out = readOutput(response, 'Reja');
    const topics = parseTopicList(out.text);

    if (!out.incomplete && topics.length >= count) {
      if (language === 'uz') topics.forEach((t) => warnForeignScript(t));
      return topics.slice(0, count);
    }

    log.warn(
      `Reja to'liq emas: ${topics.length}/${count} mavzu ` +
        `(o'ylashga ${out.reasoningTokens} token) — qayta urinilmoqda`
    );

    // Oxirgi urinish bo'lsa, bori bilan kifoyalanamiz
    if (maxTokens === PLAN_TOKEN_LIMITS.at(-1) && topics.length > 0) {
      return topics.slice(0, count);
    }
  }

  throw new Error('Reja tuzilmadi — qayta urinib ko‘ring');
}

/** AI ro'yxatini tozalaydi: raqam, tire, qo'shtirnoq olib tashlanadi */
function parseTopicList(raw) {
  return String(raw)
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^\s*\d+[.):\-]\s*/, '') // "1. " / "2) " / "3- "
        .replace(/^[-•*–—]\s*/, '') // "- " / "• "
        .replace(/^["'«»]+|["'«»]+$/g, '')
        .trim()
    )
    .filter((t) => t.length >= 3 && t.length <= 200)
    .filter((t) => !/^[#<]/.test(t)); // hashtag yoki HTML qoldig'i emas
}

// =====================================================================
//  4. Tozalash — AI xato teg bersa Telegram xato bermasin
// =====================================================================

/**
 * AI qancha yaxshi ko'rsatma olsa ham, ba'zan markdown yoki
 * ruxsat etilmagan teg chiqarib qo'yadi. Bu funksiya shuni tuzatadi.
 */
export function sanitizeTelegramHtml(raw) {
  let t = String(raw).trim();

  // --- Markdown qoldiqlarini HTML ga aylantirish ---
  t = t.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');
  t = t.replace(/__(.+?)__/gs, '<b>$1</b>');
  // Diqqat: # dan keyin BO'SH JOY talab qilinadi. Aks holda #hashtag
  // markdown sarlavha deb qabul qilinib, # belgisi yo'qoladi.
  t = t.replace(/(^|\n)#{1,6}[ \t]+(.+)/g, '$1<b>$2</b>');

  // --- Blok teglarni qatorga aylantirish ---
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|h[1-6])>/gi, '\n');
  t = t.replace(/<li[^>]*>\s*/gi, '• ');
  t = t.replace(/<\/li>/gi, '\n');

  // --- Ruxsat etilmagan teglarni olib tashlash ---
  t = t.replace(/<\/?([a-zA-Z0-9-]+)[^>]*>/g, (match, tag) =>
    ALLOWED_TAGS.test(tag) ? match : ''
  );

  // --- Yolg'iz & ni escape qilish (HTML ni buzmasligi uchun) ---
  t = t.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

  // --- Ortiqcha bo'sh qatorlar ---
  t = t.replace(/[ \t]+$/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n');

  // --- Telegram chegarasi ---
  if (t.length > 4000) t = t.slice(0, 4000).trim();

  return t.trim();
}

/** Telegram HTML ni rad etsa — zapas variant: hamma tegni olib tashlash */
export function stripHtml(html) {
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
