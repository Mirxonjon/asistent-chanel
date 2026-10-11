# ---------- 1-bosqich: bog'liqliklar ----------
# Alohida bosqich — kod o'zgarganda npm ci qayta ishlamaydi (kesh).
FROM node:24-alpine AS deps

WORKDIR /app

# Faqat manifestlar — shular o'zgarmasa Docker keshdan oladi
COPY package.json package-lock.json ./

# npm ci — lock fayl bo'yicha aniq versiyalar. --omit=dev: test paketlari kerak emas.
RUN npm ci --omit=dev

# ---------- 2-bosqich: ishchi image ----------
FROM node:24-alpine

# Vaqt zonasi — scheduler shunga qarab ishlaydi.
# tzdata bo'lmasa Intl API zonalarni tanimaydi va reja vaqti siljiydi.
RUN apk add --no-cache tzdata
ENV TZ=Asia/Tashkent

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY scripts ./scripts

# node foydalanuvchisi image'da tayyor turadi — root'da ishlatmaymiz
USER node

# Bot tirikmi? Mongo ulanishini tekshiradi.
HEALTHCHECK --interval=60s --timeout=15s --start-period=30s --retries=3 \
  CMD node -e "import('mongoose').then(m=>m.default.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:8000}).then(()=>process.exit(0)).catch(()=>process.exit(1)))"

# Port ochilmaydi — Telegram long-polling, kiruvchi ulanish yo'q.
CMD ["node", "src/index.js"]
