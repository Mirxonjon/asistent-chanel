import { connectDb, disconnectDb } from '../src/db.js';
import { Channel } from '../src/models/Channel.js';

await connectDb();

const plan = await Channel.find({
  active: true,
  postsPerDay: { $gt: 0 },
  nextRunAt: { $ne: null, $lte: new Date() },
}).explain('executionStats');

const stats = plan.executionStats;
const winning = JSON.stringify(plan.queryPlanner.winningPlan);

console.log('\n=== Scheduler so\'rovining reja tahlili ===\n');
console.log('Indeks ishlatildi:      ', winning.includes('IXSCAN') ? 'HA (IXSCAN)' : 'YO\'Q (COLLSCAN!)');
console.log('Indeks nomi:            ', (winning.match(/"indexName":"([^"]+)"/) ?? [, '-'])[1]);
console.log('Ko\'rilgan indeks yozuvi:', stats.totalKeysExamined);
console.log('Ko\'rilgan hujjat:       ', stats.totalDocsExamined);
console.log('Qaytarilgan:            ', stats.nReturned);
console.log('Vaqt:                   ', stats.executionTimeMillis, 'ms');

if (winning.includes('COLLSCAN')) {
  console.log('\n❌ MUAMMO: butun kolleksiya skanerlanmoqda. Indeks ishlamayapti.');
  process.exitCode = 1;
} else {
  console.log('\n✅ Indeksli. Kanal soni oshsa ham tezlik o\'zgarmaydi.');
}

await disconnectDb();
