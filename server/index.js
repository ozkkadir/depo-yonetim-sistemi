const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware - Frontend'in bize ulaşması için
app.use(cors());
app.use(express.json());

// Veritabanı Bağlantısı (Railway otomatik bağlar)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Basit Test Rotası
app.get('/', (req, res) => {
  res.send('Depo Yönetim Sistemi API Çalışıyor! (v1.0)');
});

// Veritabanı Test Rotası
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as zaman');
    res.json({ 
      durum: "Başarılı", 
      mesaj: "Veritabanına bağlandım!", 
      sunucu_saati: result.rows[0].zaman 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ durum: "Hata", hata: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
