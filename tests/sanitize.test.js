import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTelegramHtml, stripHtml } from '../src/ai.js';

// --- Hashtag vs markdown sarlavha (bu yerda xato bo'lgan edi) ---

test('hashtag o‘zgarmaydi — # dan keyin bo‘sh joy yo‘q', () => {
  const out = sanitizeTelegramHtml('Post matni\n\n#Trading #Investitsiya');
  assert.ok(out.includes('#Trading'), 'birinchi hashtag yo‘qolmasligi kerak');
  assert.ok(out.includes('#Investitsiya'));
  assert.ok(!out.includes('<b>Trading'), 'hashtag <b> ga aylanmasligi kerak');
});

test('markdown sarlavha <b> ga aylanadi — # dan keyin bo‘sh joy bor', () => {
  assert.equal(sanitizeTelegramHtml('# Sarlavha'), '<b>Sarlavha</b>');
  assert.equal(sanitizeTelegramHtml('### Kichik'), '<b>Kichik</b>');
});

// --- Markdown qoldiqlari ---

test('**qalin** va __qalin__ <b> ga aylanadi', () => {
  assert.equal(sanitizeTelegramHtml('**matn**'), '<b>matn</b>');
  assert.equal(sanitizeTelegramHtml('__matn__'), '<b>matn</b>');
});

// --- Taqiqlangan teglar ---

test('Telegram qabul qilmaydigan teglar olib tashlanadi', () => {
  const out = sanitizeTelegramHtml('<div><p>matn</p></div><h1>sarlavha</h1>');
  assert.ok(!/<(div|p|h1)/.test(out), `teg qoldi: ${out}`);
  assert.ok(out.includes('matn'));
  assert.ok(out.includes('sarlavha'));
});

test('ruxsat etilgan teglar saqlanadi', () => {
  const input =
    '<b>q</b> <i>k</i> <u>t</u> <s>ch</s> <code>c</code> ' +
    '<blockquote>iq</blockquote> <a href="https://a.uz">link</a>';
  const out = sanitizeTelegramHtml(input);
  for (const tag of ['<b>', '<i>', '<u>', '<s>', '<code>', '<blockquote>']) {
    assert.ok(out.includes(tag), `${tag} yo‘qoldi`);
  }
  assert.ok(out.includes('<a href="https://a.uz">'), 'havola saqlanmadi');
});

// --- Blok teglar qatorga aylanadi ---

test('<br> va <li> qator/bullet ga aylanadi', () => {
  assert.equal(sanitizeTelegramHtml('bir<br>ikki'), 'bir\nikki');
  const out = sanitizeTelegramHtml('<ul><li>bir</li><li>ikki</li></ul>');
  assert.ok(out.includes('• bir'), out);
  assert.ok(out.includes('• ikki'), out);
});

// --- & escape ---

test('yolg‘iz & escape qilinadi, mavjud entity tegilmaydi', () => {
  assert.equal(sanitizeTelegramHtml('non & suv'), 'non &amp; suv');
  assert.equal(sanitizeTelegramHtml('non &amp; suv'), 'non &amp; suv');
  assert.equal(sanitizeTelegramHtml('&lt;teg&gt;'), '&lt;teg&gt;');
});

// --- Bo'sh qatorlar ---

test('uch va undan ko‘p bo‘sh qator ikkitaga qisqaradi', () => {
  assert.equal(sanitizeTelegramHtml('a\n\n\n\n\nb'), 'a\n\nb');
});

test('qator oxiridagi bo‘sh joylar tozalanadi', () => {
  assert.equal(sanitizeTelegramHtml('a   \nb'), 'a\nb');
});

// --- Uzunlik chegarasi ---

test('4000 belgidan uzun post qirqiladi', () => {
  const out = sanitizeTelegramHtml('x'.repeat(5000));
  assert.ok(out.length <= 4000, `uzunlik: ${out.length}`);
});

// --- stripHtml (zapas variant) ---

test('stripHtml hamma tegni olib tashlaydi va entity larni qaytaradi', () => {
  assert.equal(stripHtml('<b>qalin</b> matn'), 'qalin matn');
  assert.equal(stripHtml('non &amp; suv'), 'non & suv');
});
