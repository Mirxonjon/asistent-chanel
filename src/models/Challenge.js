import mongoose from 'mongoose';

/**
 * Bitta challenge — ya'ni bitta kontent reja.
 *
 * Avval reja Channel ichida yashardi va yangisi tuzilganda eskisi
 * yo'q bo'lib ketardi. Endi har bir challenge alohida yozuv:
 * tugagandan keyin ham tarixda qoladi, ro'yxatdan ko'rish mumkin.
 */
const challengeSchema = new mongoose.Schema(
  {
    ownerId: { type: Number, required: true },
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Channel',
      required: true,
    },

    /** Challenge mavzusi (kanalnikidan boshqa bo'lishi mumkin) */
    topic: { type: String, required: true },

    /** Kanal mavzusining o'zi ishlatilganmi */
    usesChannelTopic: { type: Boolean, default: false },

    days: Number,
    postsPerDay: Number,
    totalTopics: { type: Number, default: 0 },

    /**
     * draft     — tuzilgan, tasdiqlanmagan. Postlar chiqmaydi.
     * active    — tasdiqlangan, ishlayapti.
     * paused    — vaqtincha to'xtatilgan.
     * completed — hamma post joylandi.
     * archived  — o'rniga yangisi tuzilgan yoki qo'lda arxivlangan.
     */
    state: {
      type: String,
      enum: ['draft', 'active', 'paused', 'completed', 'archived'],
      default: 'draft',
    },

    startsAt: Date, // birinchi post vaqti
    endsAt: Date,   // oxirgi post vaqti

    confirmedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

// "Challengelarim" ro'yxati — eng yangisi tepada
challengeSchema.index({ ownerId: 1, createdAt: -1 });
challengeSchema.index({ channelId: 1, createdAt: -1 });

export const Challenge = mongoose.model('Challenge', challengeSchema);
