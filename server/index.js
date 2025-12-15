require('dotenv').config();
// ... diğer importlar ...

// BU SATIRI EKLEYİN:
console.log("-------------------------------------------------");
console.log("KONTROL EDİLİYOR: DATABASE_URL VAR MI?");
console.log("URL DEĞERİ:", process.env.DATABASE_URL ? "DOLU (OKUNDU)" : "BOŞ (YOK!!)");
console.log("-------------------------------------------------");

const pool = new Pool({
  // ...

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Veritabanı Bağlantısı
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- ROTALAR ---

app.get('/', (req, res) => {
  res.send('Depo Yönetim Sistemi API Hazır! Kurulum için /api/setup-db adresine gidin.');
});

// 1. ÖZEL KURULUM ROTASI (Veritabanı Tablolarını Oluşturur)
app.get('/api/setup-db', async (req, res) => {
  try {
    const setupQuery = `
      -- Temizlik (Geliştirme aşamasında tabloları sıfırlar)
      DROP TABLE IF EXISTS stock_logs, account_transactions, inventory, product_series_map, products, series, accounts, account_types, settings_currencies, settings_units, settings_languages, colors, categories, brands, users, roles CASCADE;

      -- Tablo Kurulumları
      CREATE TABLE roles (role_id SERIAL PRIMARY KEY, role_name VARCHAR(50));
      CREATE TABLE brands (brand_id SERIAL PRIMARY KEY, brand_name VARCHAR(100));
      CREATE TABLE categories (category_id SERIAL PRIMARY KEY, category_name VARCHAR(100));
      CREATE TABLE colors (color_id SERIAL PRIMARY KEY, color_name VARCHAR(50), hex_code VARCHAR(7));
      CREATE TABLE settings_units (unit_id SERIAL PRIMARY KEY, unit_name VARCHAR(20));
      CREATE TABLE series (series_id SERIAL PRIMARY KEY, series_name VARCHAR(100), brand_id INT);
      
      CREATE TABLE products (
          product_id SERIAL PRIMARY KEY,
          product_code VARCHAR(50) UNIQUE,
          product_name VARCHAR(150),
          category_id INT,
          brand_id INT,
          image_url VARCHAR(255),
          technical_drawing_url VARCHAR(255)
      );

      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          product_id INT,
          color_id INT,
          quantity DECIMAL(10, 2) DEFAULT 0,
          unit_id INT,
          critical_stock_level INT DEFAULT 10,
          avg_buying_price DECIMAL(10, 2) DEFAULT 0,
          selling_price DECIMAL(10, 2) DEFAULT 0
      );

      -- Örnek Veriler
      INSERT INTO brands (brand_name) VALUES ('Albert Genau'), ('Pimapen');
      INSERT INTO categories (category_name) VALUES ('Profil'), ('Aksesuar');
      INSERT INTO colors (color_name, hex_code) VALUES ('Eloksal', '#C0C0C0'), ('Antrasit', '#2F4F4F'), ('Ham', '#F5F5DC');
      INSERT INTO settings_units (unit_name) VALUES ('Adet'), ('Boy'), ('Metre');
      INSERT INTO series (series_name, brand_id) VALUES ('Statü', 1), ('Tiara 08', 1);

      -- Örnek Ürün: KP-100
      INSERT INTO products (product_code, product_name, category_id, brand_id, image_url) 
      VALUES ('KP-100', 'Cam Balkon Köşe Dönüş Profili', 1, 1, 'https://placehold.co/100x100?text=Profil');
      
      -- KP-100 için Stok (Eloksal - 100 Boy)
      INSERT INTO inventory (product_id, color_id, quantity, unit_id, avg_buying_price, selling_price)
      VALUES (1, 1, 120, 2, 150.00, 225.00);
    `;

    await pool.query(setupQuery);
    res.send("<h1>Kurulum Başarılı!</h1><p>Veritabanı tabloları oluşturuldu ve örnek veriler girildi.</p>");
  } catch (err) {
    console.error(err);
    res.status(500).send(`<h1>Hata Oluştu</h1><p>${err.message}</p>`);
  }
});

// 2. ÜRÜNLERİ LİSTELE (Frontend Burayı Kullanacak)
app.get('/api/products', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.product_id as id, 
        p.product_code as code, 
        p.product_name as name, 
        p.image_url as image,
        b.brand_name as brand, 
        c.category_name as category,
        COALESCE(
          json_agg(json_build_object(
            'color', co.color_name,
            'stock', i.quantity,
            'unit', u.unit_name,
            'buyingPrice', i.avg_buying_price,
            'sellingPrice', i.selling_price
          )) FILTER (WHERE co.color_name IS NOT NULL), 
          '[]'
        ) as variants
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
