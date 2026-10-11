import mongoose from 'mongoose';
import { config } from './config.js';

let connected = false;
let shuttingDown = false;

export async function connectDb() {
  mongoose.connection.on('error', (err) => {
    console.error('⚠️  MongoDB xato:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    // Bu dastlabki ulanish paytida ham chiqadi - shuning uchun faqat
    // haqiqatan ulangandan keyin uzilsa ogohlantiramiz.
    if (connected && !shuttingDown) {
      console.warn('⚠️  MongoDB uzildi, qayta ulanmoqda...');
    }
  });

  try {
    await mongoose.connect(config.mongoUrl, {
      serverSelectionTimeoutMS: 10000,
    });
    connected = true;
  } catch (err) {
    // Eng ko'p uchraydigan xatolarni tushunarli qilib ko'rsatamiz
    console.error('\n❌ MongoDB ga ulanib bo\'lmadi.');

    if (err.message.includes('ENOTFOUND') || err.code === 'ENOTFOUND') {
      console.error('   Manzil topilmadi - .env dagi MONGODB_URI ni tekshiring.');
    } else if (err.message.includes('ECONNREFUSED')) {
      console.error('   Server javob bermadi. mongod ishga tushganmi?');
      console.error('   Windows: Services -> MongoDB Server -> Start');
    } else if (err.message.includes('Authentication failed')) {
      console.error('   Login yoki parol xato.');
    } else {
      console.error(`   ${err.message}`);
    }

    console.error('');
    process.exit(1);
  }

  const { host, port, name } = mongoose.connection;
  console.log(`✅ MongoDB ulandi  (${host}:${port}/${name})`);
}

export async function disconnectDb() {
  shuttingDown = true;
  await mongoose.connection.close();
}
