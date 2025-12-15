const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Frontend'in Backend'e erişmesine izin ver
app.use(express.json()); // JSON veri alışverişini aç

// Veritabanı Bağlantısı (PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Railway/Render için gerekli
  }
});

// --- API ROTALARI ---

// 1. Test Rotası
app.get('/', (req, res) => {
  res.send('Depo Yönetim Sistemi API Çalışıyor!');
});

// 2. Tüm Ürünleri Getir (Stok ve Renk Detaylarıyla)
app.get('/api/products', async (req, res) => {
  try {
    // Karmaşık bir sorgu: Ürünleri, markaları ve stok varyantlarını birleştirir.
    const query = `
      SELECT 
        p.product_id, p.product_code, p.product_name, p.image_url, p.technical_drawing_url,
        b.brand_name, c.category_name,
        json_agg(json_build_object(
          'color', co.color_name,
          'stock', i.quantity,
          'unit', u.unit_name,
          'buyingPrice', i.avg_buying_price,
          'sellingPrice', i.selling_price
        )) as variants
      FROM products p
      JOIN brands b ON p.brand_id = b.brand_id
      JOIN categories c ON p.category_id = c.category_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      LEFT JOIN colors co ON i.color_id = co.color_id
      LEFT JOIN settings_units u ON i.unit_id = u.unit_id
      GROUP BY p.product_id, b.brand_name, c.category_name;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
});

// 3. Stok Girişi Yap (Güncelleme)
app.post('/api/stock/entry', async (req, res) => {
  const { productId, colorId, quantity, price } = req.body;
  
  try {
    // 1. Mevcut stoğu bul
    const stockCheck = await pool.query(
      'SELECT quantity, avg_buying_price FROM inventory WHERE product_id = $1 AND color_id = $2',
      [productId, colorId]
    );

    if (stockCheck.rows.length === 0) {
      return res.status(404).json({ error: "Stok kaydı bulunamadı" });
    }

    const currentStock = parseFloat(stockCheck.rows[0].quantity);
    const currentAvgPrice = parseFloat(stockCheck.rows[0].avg_buying_price);
    
    // 2. Ağırlıklı Ortalama Maliyet Hesabı
    const newTotalStock = currentStock + parseFloat(quantity);
    const totalValue = (currentStock * currentAvgPrice) + (parseFloat(quantity) * parseFloat(price));
    const newAvgPrice = totalValue / newTotalStock;

    // 3. Güncelle
    await pool.query(
      'UPDATE inventory SET quantity = $1, avg_buying_price = $2 WHERE product_id = $3 AND color_id = $4',
      [newTotalStock, newAvgPrice, productId, colorId]
    );

    res.json({ message: "Stok ve maliyet güncellendi", newStock: newTotalStock, newPrice: newAvgPrice });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
});

// Sunucuyu Başlat
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
