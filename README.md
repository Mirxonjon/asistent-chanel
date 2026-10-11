# Postchi AI — Telegram kanal assistenti

Kanal mavzusidan kelib chiqib post yozadi va kanalga joylaydi.
Ko'p foydalanuvchi: har kim o'z kanal(lar)ini ulaydi va boshqaradi.

## Ishga tushirish

```bash
npm install
cp .env.example .env     # keyin .env ni to'ldiring
npm start
```

### `.env`

| Kalit | Majburiy | Izoh |
|---|---|---|
| `BOT_TOKEN` | ✅ | @BotFather dan |
| `OPENAI_API_KEY` | ✅ | platform.openai.com |
| `OPENAI_MODEL` | — | default `gpt-6-luna` |
| `MONGODB_URI` | ✅ | `MONGO_URL` ham ishlaydi |
| `OWNER_ID` | — | faqat bot egasi statistikasi uchun |
| `DEFAULT_TIMEZONE` | — | default `Asia/Tashkent` |

> ⚠️ `.env.example` git'ga tushadi — unga haqiqiy kalit yozmang.

### Skriptlar

```bash
npm start                      # botni ishga tushirish
npm run dev                    # o'zgarishda avto-qayta yuklash
npm test                       # 29 ta test (sanitizer + vaqt zonasi)
npm run models                 # OpenAI kaliti + mavjud modellar
node scripts/check.js          # MongoDB + indekslar
node scripts/test-post.js      # post sifatini terminalda ko'rish
node scripts/explain-scheduler.js   # scheduler indeksdan foydalanayotganini tekshirish
```

## Foydalanuvchi uchun

| Komanda | Nima qiladi |
|---|---|
| `/start` | boshlash, menyu |
| `/kanal` | yangi kanal ulash |
| `/kanallarim` | ulangan kanallar |
| `/mavzu <matn>` | shu mavzuda post yozish |
| `/reja` | avtomatik post rejasi |
| `/bekor` | amalni bekor qilish |

### Kanal ulash

1. Botni kanalga **admin** qilib qo'shish (**Post Messages** huquqi bilan)
2. Kanaldan biror postni botga **forward** qilish (yoki `@kanal_nomi` yozish)
3. Kanal mavzusini yozish

Bot ikki tomonlama tekshiradi: botning post yuborish huquqi **va**
so'rov yuborgan odamning kanal admini bo'lishi. Ikkinchisi bo'lmasa
istalgan odam begona kanalni o'ziga ulab olardi.

## Arxitektura

```
src/
├─ index.js          ishga tushirish: db + bot + scheduler
├─ config.js         .env o'qish va tekshirish
├─ db.js             MongoDB ulanish + tushunarli xatolar
├─ ai.js             OpenAI → Telegram HTML post + tozalagich
├─ publish.js        kanalga yuborish (HTML rad etilsa — teglarsiz zapas)
├─ time.js           vaqt zonasi hisobi (tashqi kutubxonasiz)
├─ scheduler.js      node-cron: vaqti kelgan kanallarga post
├─ bot.js            Telegraf: menyu, komandalar, holat yo'naltiruvchisi
├─ utils.js          escapeHtml, safeEdit, lines
├─ middleware/
│  └─ auth.js        ctx.user ni topadi/yaratadi + holat saqlash
├─ handlers/
│  ├─ connect.js     kanal ulash + tekshiruvlar
│  ├─ write.js       post yozish + preview tugmalari
│  └─ schedule.js    /reja: son, vaqtlar, zona, rejim
└─ models/
   ├─ User.js        telegramId, state
   ├─ Channel.js     ownerId, topic, times, nextRunAt
   └─ Post.js        text, status, source
```

### Muhim qarorlar

**`ownerId` har bir so'rovda.** Hech qayerda admin ID qattiq yozilmagan.
Har bir `find`/`update` `ownerId: ctx.from.id` bilan filtrlanadi, shuning
uchun foydalanuvchi faqat o'z kanallarini ko'radi.

**`nextRunAt` + indeks.** Scheduler har daqiqada ishlaydi, lekin
`Channel.find({active, nextRunAt: {$lte: now}})` so'rovi
`{active:1, nextRunAt:1}` indeksidan foydalanadi — 0 hujjat o'qiladi,
0 ms. Kanal soni 10 yoki 10 000 bo'lishi farq qilmaydi.
Tekshirish: `node scripts/explain-scheduler.js`

**`nextRunAt` generatsiyadan OLDIN yangilanadi.** Aks holda AI xatosi
bo'lsa cron har daqiqada qayta urinib, OpenAI hisobini bo'shatadi.

**30 daqiqa qoidasi.** Bot uzoq o'chib turgan bo'lsa, o'tib ketgan
postlar ketma-ket yuborilmaydi — o'tkazib yuboriladi (`MAX_LATE_MS`).

**Vaqt zonasi.** `"09:00"` o'zi hech narsani anglatmaydi. Kanalning
`timezone`i bo'yicha aniq UTC momentiga aylantirilib `nextRunAt`da
saqlanadi. Keyin scheduler oddiy taqqoslash qiladi — zona hisobi yo'q.
DST bor zonalar ham to'g'ri ishlaydi (`tests/time.test.js`).

**HTML tozalagich.** Telegram faqat `<b> <i> <u> <s> <code>
<blockquote> <a>` ni qabul qiladi. AI ba'zan markdown yoki `<p>`/`<ul>`
chiqaradi — `sanitizeTelegramHtml` tuzatadi. Shunda ham rad etilsa,
`publish.js` teglarsiz qayta yuboradi: post yo'qolmaydi.

## Narx

`gpt-6-luna`: $0.10 / 1M input, $0.50 / 1M output.
Bitta post ≈ 900 token ≈ **0.03 tiyin**. Kuniga 10 post ≈ oyiga 10 tiyin.

Model almashtirish: `.env` → `OPENAI_MODEL`. Mavjudlarni ko'rish: `npm run models`.

## Hali yozilmagan

- `/postlar` — post tarixi
- `/sozlama` — ohang va til almashtirish (bazada bor, UI yo'q)
- Rasm bilan post
- Foydalanuvchi o'z OpenAI kalitini kiritishi (BYOK)
