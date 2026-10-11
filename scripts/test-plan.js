/**
 * Kontent rejani sinash — bitta AI chaqiruvi bilan N ta mavzu.
 *
 *   node scripts/test-plan.js        → 30 ta
 *   node scripts/test-plan.js 10     → 10 ta
 */
import { generatePlan } from '../src/ai.js';
import { computeSchedule, formatInZone } from '../src/time.js';
import { config } from '../src/config.js';

const CHANNEL_TOPIC = 'Trading, investitsiya va bozor tahlili. Boshlovchilar uchun.';
const TIMES = ['12:00'];
const TZ = 'Asia/Tashkent';

const count = Number(process.argv[2]) || 30;
const t0 = Date.now();

console.log(`\nModel: ${config.openaiModel}`);
console.log(`Kanal: ${CHANNEL_TOPIC}`);
console.log(`Kerak: ${count} ta mavzu\n`);

const topics = await generatePlan({ channelTopic: CHANNEL_TOPIC, count });
const slots = computeSchedule(TIMES, TZ, topics.length);
const ms = Date.now() - t0;

console.log('─'.repeat(64));
topics.forEach((t, i) => {
  const when = slots[i] ? formatInZone(slots[i], TZ) : '—';
  console.log(`${String(i + 1).padStart(2)}. ${when.padEnd(18)} ${t}`);
});
console.log('─'.repeat(64));

// --- Tekshiruvlar ---
const CYR = /[Ѐ-ӿ]/;
const TUR = /[ışğçöüİŞĞÇÖÜ]/;

const problems = [];
if (topics.length !== count) problems.push(`${topics.length}/${count} ta chiqdi`);

const dirty = topics.filter((t) => CYR.test(t) || TUR.test(t));
if (dirty.length) problems.push(`begona alifbo: ${dirty.join(' | ')}`);

const numbered = topics.filter((t) => /^\d+[.)]/.test(t));
if (numbered.length) problems.push(`raqam qolgan: ${numbered.length} ta`);

const dupes = topics.length - new Set(topics.map((t) => t.toLowerCase())).size;
if (dupes) problems.push(`${dupes} ta takror`);

const tooLong = topics.filter((t) => t.split(/\s+/).length > 10);
if (tooLong.length) problems.push(`juda uzun: ${tooLong.length} ta`);

console.log(`\n⏱  ${(ms / 1000).toFixed(1)}s  ·  ${topics.length} ta mavzu`);
if (problems.length) {
  console.log('\n⚠️  Muammolar:');
  problems.forEach((p) => console.log(`   • ${p}`));
} else {
  console.log('✅ Hammasi joyida: son to‘g‘ri, takror yo‘q, alifbo toza');
}
console.log('');
