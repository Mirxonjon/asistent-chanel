import mongoose from 'mongoose';
import { config } from '../config.js';

/**
 * Ulangan kanal. ownerId - eng muhim maydon:
 * har bir so'rov shu bo'yicha filtrlanadi, shuning uchun
 * foydalanuvchi faqat o'z kanallarini ko'radi va boshqara oladi.
 */
const channelSchema = new mongoose.Schema(
  {
    ownerId: { type: Number, required: true }, // User.telegramId
    chatId: { type: String, required: true },  // "-1001234567890"
    title: String,
    username: String,                          // "@kanal_nomi" (bo'lsa)

    // ---- Kontent sozlamalari ----
    topic: { type: String, required: true },   // "Trading, investitsiya, bozor tahlili"

    /**
     * Kontent reja (challenge) qaysi mavzu bo'yicha tuzilgan.
     * null  = kanal mavzusining o'zi ishlatiladi.
     * Masalan kanal "Trading" bo'lsa-yu, 30 kunlik challenge
     * faqat "Texnik tahlil asoslari" bo'yicha bo'lishi mumkin.
     */
    planTopic: { type: String, default: null },
    tone: {
      type: String,
      enum: ['professional', 'sodda', 'qiziqarli'],
      default: 'professional',
    },
    language: { type: String, default: 'uz' },

    // ---- Reja ----
    postsPerDay: { type: Number, default: 0 }, // 0 = avto post o'chirilgan
    times: { type: [String], default: [] },    // ["09:00", "14:00", "20:00"]
    timezone: { type: String, default: () => config.defaultTimezone },

    autoPublish: { type: Boolean, default: false }, // false = avval preview
    active: { type: Boolean, default: true },

    /**
     * Hozir ishlab turgan challenge.
     * Holat (draft/active/paused) o'sha Challenge yozuvida saqlanadi.
     */
    activeChallengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Challenge',
      default: null,
    },

    // ---- Scheduler uchun ----
    // Keyingi post vaqti oldindan hisoblab qo'yiladi. Shu sabab cron
    // har daqiqada hamma kanalni skanerlamaydi - indeksga bitta qaraydi.
    nextRunAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Foydalanuvchining kanallari ro'yxati
channelSchema.index({ ownerId: 1 });

// Bitta foydalanuvchi bitta kanalni ikki marta ulay olmaydi
channelSchema.index({ ownerId: 1, chatId: 1 }, { unique: true });

// Scheduler so'rovi: find({ active: true, nextRunAt: { $lte: now } })
// Compound indeks - kanal soni qancha bo'lishidan qat'i nazar bir xil tezlik.
channelSchema.index({ active: 1, nextRunAt: 1 });

export const Channel = mongoose.model('Channel', channelSchema);
