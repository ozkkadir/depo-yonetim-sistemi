const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get('/', (req, res) => res.send('DepoPro Advanced API Hazır!'));

// --- GELİŞMİŞ VERİTABANI KURULUMU ---
app.get('/api/setup-db', async (req, res) => {
  try {
    const setupQuery = `
      -- Önce temizlik
      DROP TABLE IF EXISTS account_transactions, accounts, inventory, product_series_map, products, series, settings_currencies, settings_units, settings_languages, colors, categories, brands CASCADE;

      -- 1. AYAR TABLOLARI
      CREATE TABLE settings_languages (lang_code VARCHAR(5) PRIMARY KEY, lang_name VARCHAR(50));
      CREATE TABLE settings_units (unit_id SERIAL PRIMARY KEY, unit_name VARCHAR(20));
      CREATE TABLE settings_currencies (
        currency_code VARCHAR(3) PRIMARY KEY, 
        currency_name VARCHAR(50), 
        exchange_rate DECIMAL(10, 4) DEFAULT 1.0
      );

      -- 2. TANIM TABLOLARI
      CREATE TABLE brands (brand_id SERIAL PRIMARY KEY, brand_name VARCHAR(100));
      CREATE TABLE categories (category_id SERIAL PRIMARY KEY, category_name VARCHAR(100));
      CREATE TABLE colors (color_id SERIAL PRIMARY KEY, color_name VARCHAR(50), hex_code VARCHAR(7));
      
      -- 3. ÜRÜN VE SERİ YAPISI
      CREATE TABLE series (
          series_id SERIAL PRIMARY KEY, 
          series_name VARCHAR(100), 
          brand_id INT REFERENCES brands(brand_id),
          technical_drawing_url VARCHAR(255) -- Seri bazlı teknik çizim
      );
      
      CREATE TABLE products (
          product_id SERIAL PRIMARY KEY,
          product_code VARCHAR(50) UNIQUE,
          product_name VARCHAR(150),
          category_id INT REFERENCES categories(category_id),
          brand_id INT REFERENCES brands(brand_id),
          image_url VARCHAR(255),
          technical_drawing_url VARCHAR(255), -- Ürün bazlı teknik çizim
          description TEXT
      );

      -- Ürün ve Seri Arasında Çoktan Çoğa İlişki (Bir ürün birden fazla seriye ait olabilir)
      CREATE TABLE product_series_map (
          map_id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          series_id INT REFERENCES series(series_id) ON DELETE CASCADE
      );

      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          color_id INT REFERENCES colors(color_id),
          quantity DECIMAL(10, 2) DEFAULT 0,
          unit_id INT REFERENCES settings_units(unit_id),
          critical_stock INT DEFAULT 10,
          buying_price DECIMAL(10, 2) DEFAULT 0,
          selling_price DECIMAL(10, 2) DEFAULT 0,
          currency_code VARCHAR(3) REFERENCES settings_currencies(currency_code) DEFAULT 'TRY'
      );

      -- 4. CARİ SİSTEMİ
      CREATE TABLE accounts (
          account_id SERIAL PRIMARY KEY,
          account_name VARCHAR(150) NOT NULL,
          account_type VARCHAR(20), 
          tax_no VARCHAR(50),
          phone VARCHAR(20),
          email VARCHAR(100),
          address TEXT,
          current_balance DECIMAL(12, 2) DEFAULT 0
      );

      -- ÖRNEK VERİLERİ YÜKLE
      INSERT INTO settings_units (unit_name) VALUES ('Adet'), ('Boy'), ('Metre'), ('Kg');
      INSERT INTO settings_currencies (currency_code, currency_name, exchange_rate) VALUES ('TRY', 'Türk Lirası', 1.0), ('USD', 'Amerikan Doları', 32.50), ('EUR', 'Euro', 35.20);
      INSERT INTO brands (brand_name) VALUES ('Albert Genau'), ('Pimapen'), ('Winsa'), ('Asaş');
      INSERT INTO categories (category_name) VALUES ('Profil'), ('Aksesuar'), ('Conta'), ('Menteşe');
      INSERT INTO colors (color_name, hex_code) VALUES ('Eloksal', '#C0C0C0'), ('Antrasit', '#2F4F4F'), ('Ham', '#F5F5DC'), ('Siyah', '#000000');
      
      INSERT INTO series (series_name, brand_id) VALUES ('Statü', 1), ('Tiara 08', 1), ('Comfort', 2);
      
      -- Ürün 1: Profil
      INSERT INTO products (product_code, product_name, category_id, brand_id, image_url, technical_drawing_url) 
      VALUES ('KP-100', 'Cam Balkon Köşe Dönüş Profili', 1, 1, 'https://placehold.co/100x100?text=Profil', 'https://placehold.co/200x100?text=Kesit');
      
      -- Ürünü Serilere Bağla (Hem Statü hem Tiara uyumlu olsun)
      INSERT INTO product_series_map (product_id, series_id) VALUES (1, 1), (1, 2);
      
      -- Stok Varyantları
      INSERT INTO inventory (product_id, color_id, quantity, unit_id, selling_price, currency_code) VALUES (1, 1, 120, 2, 250, 'TRY'); -- Eloksal
      INSERT INTO inventory (product_id, color_id, quantity, unit_id, selling_price, currency_code) VALUES (1, 2, 45, 2, 280, 'TRY'); -- Antrasit

      -- Cari
      INSERT INTO accounts (account_name, account_type, phone, current_balance) VALUES ('Örnek Yapı Market', 'Musteri', '05551112233', 15000);
    `;
    await pool.query(setupQuery);
    res.send("<h1>Gelişmiş Veritabanı Kuruldu!</h1>");
  } catch (err) { res.status(500).send(`Hata: ${err.message}`); }
});

// --- ROTALAR ---

// Ürünleri Listele (Detaylı JSON yapısı)
app.get('/api/products', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.product_id as id, 
        p.product_code as code, 
        p.product_name as name, 
        p.image_url as image,
        p.technical_drawing_url as technical,
        b.brand_name as brand, 
        c.category_name as category,
        (
          SELECT json_agg(s.series_name) 
          FROM product_series_map psm 
          JOIN series s ON psm.series_id = s.series_id 
          WHERE psm.product_id = p.product_id
        ) as series,
        COALESCE(
          json_agg(json_build_object(
            'inv_id', i.inventory_id,
            'color', co.color_name,
            'stock', i.quantity,
            'unit', u.unit_name,
            'critical', i.critical_stock,
            'price', i.selling_price,
            'currency', i.currency_code
          )) FILTER (WHERE co.color_name IS NOT NULL), '[]'
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
  } catch (err) { res.status(500).json(err); }
});

// Ürün Silme
app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE product_id = $1', [req.params.id]);
    res.json({ message: 'Ürün silindi' });
  } catch (err) { res.status(500).json(err); }
});

// Stok Güncelleme
app.put('/api/inventory/:id', async (req, res) => {
  const { quantity } = req.body;
  try {
    await pool.query('UPDATE inventory SET quantity = $1 WHERE inventory_id = $2', [quantity, req.params.id]);
    res.json({ message: 'Stok güncellendi' });
  } catch (err) { res.status(500).json(err); }
});

// Diğer Tanım Rotaları
app.get('/api/brands', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM brands'); res.json(rows); } catch (err) { res.status(500).json(err); }
});
app.get('/api/accounts', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM accounts ORDER BY account_name'); res.json(rows); } catch (err) { res.status(500).json(err); }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda.`));
