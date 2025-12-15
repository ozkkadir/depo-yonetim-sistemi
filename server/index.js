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

app.get('/', (req, res) => res.send('Depo & Cari Yönetim API Hazır!'));

// --- 1. VERİTABANI KURULUMU (Tam Kapsamlı) ---
app.get('/api/setup-db', async (req, res) => {
  try {
    const setupQuery = `
      -- Temizlik
      DROP TABLE IF EXISTS account_transactions, accounts, inventory, products, series, settings_units, colors, categories, brands CASCADE;

      -- 1. Tanım Tabloları
      CREATE TABLE brands (brand_id SERIAL PRIMARY KEY, brand_name VARCHAR(100));
      CREATE TABLE categories (category_id SERIAL PRIMARY KEY, category_name VARCHAR(100));
      CREATE TABLE colors (color_id SERIAL PRIMARY KEY, color_name VARCHAR(50), hex_code VARCHAR(7));
      CREATE TABLE settings_units (unit_id SERIAL PRIMARY KEY, unit_name VARCHAR(20));
      
      -- 2. Ürün ve Seri Tabloları
      CREATE TABLE series (
          series_id SERIAL PRIMARY KEY, 
          series_name VARCHAR(100), 
          brand_id INT REFERENCES brands(brand_id)
      );
      
      CREATE TABLE products (
          product_id SERIAL PRIMARY KEY,
          product_code VARCHAR(50) UNIQUE,
          product_name VARCHAR(150),
          category_id INT REFERENCES categories(category_id),
          brand_id INT REFERENCES brands(brand_id),
          image_url VARCHAR(255)
      );

      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(product_id),
          color_id INT REFERENCES colors(color_id),
          quantity DECIMAL(10, 2) DEFAULT 0,
          unit_id INT REFERENCES settings_units(unit_id),
          selling_price DECIMAL(10, 2) DEFAULT 0
      );

      -- 3. CARİ (HESAP) TABLOLARI
      CREATE TABLE accounts (
          account_id SERIAL PRIMARY KEY,
          account_name VARCHAR(150) NOT NULL,
          account_type VARCHAR(20) DEFAULT 'Musteri', -- 'Musteri', 'Tedarikci'
          tax_no VARCHAR(50),
          phone VARCHAR(20),
          email VARCHAR(100),
          current_balance DECIMAL(12, 2) DEFAULT 0 -- Pozitif: Bize Borçlu, Negatif: Biz Borçluyuz
      );

      CREATE TABLE account_transactions (
          transaction_id SERIAL PRIMARY KEY,
          account_id INT REFERENCES accounts(account_id),
          transaction_type VARCHAR(20), -- 'Satis', 'Tahsilat', 'Odeme', 'Alis'
          amount DECIMAL(12, 2) NOT NULL,
          description TEXT,
          transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- ÖRNEK VERİLER --
      
      -- Tanımlar
      INSERT INTO brands (brand_name) VALUES ('Albert Genau'), ('Pimapen'), ('Winsa');
      INSERT INTO categories (category_name) VALUES ('Profil'), ('Aksesuar');
      INSERT INTO colors (color_name, hex_code) VALUES ('Eloksal', '#C0C0C0'), ('Antrasit', '#2F4F4F');
      INSERT INTO settings_units (unit_name) VALUES ('Adet'), ('Boy'), ('Metre');
      
      -- Ürünler
      INSERT INTO products (product_code, product_name, category_id, brand_id, image_url) 
      VALUES ('KP-100', 'Cam Balkon Köşe Dönüş', 1, 1, 'https://placehold.co/100x100?text=Profil');
      INSERT INTO inventory (product_id, color_id, quantity, unit_id, selling_price) VALUES (1, 1, 120, 2, 225.00);

      -- Cariler
      INSERT INTO accounts (account_name, account_type, phone, current_balance) 
      VALUES 
      ('Ahmet Cam Balkon', 'Musteri', '05551112233', 15000.00), 
      ('Mehmet Yapı Market', 'Musteri', '05324445566', 2500.50),
      ('Alüminyum Tedarik A.Ş.', 'Tedarikci', '02128889900', -50000.00);

    `;
    await pool.query(setupQuery);
    res.send("<h1>Kurulum Başarılı (Cari Modülü Dahil)!</h1>");
  } catch (err) {
    console.error(err);
    res.status(500).send(`Hata: ${err.message}`);
  }
});

// --- ROTALAR ---

// Ürün Listesi
app.get('/api/products', async (req, res) => {
  try {
    const query = `
      SELECT p.product_id as id, p.product_code as code, p.product_name as name, p.image_url as image,
      b.brand_name as brand, c.category_name as category,
      COALESCE(json_agg(json_build_object('color', co.color_name, 'stock', i.quantity, 'unit', u.unit_name, 'sellingPrice', i.selling_price)) FILTER (WHERE co.color_name IS NOT NULL), '[]') as variants
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CARİ ROTALARI (YENİ)
// Hesapları Listele
app.get('/api/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM accounts ORDER BY account_name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Yeni Hesap Ekle
app.post('/api/accounts', async (req, res) => {
  const { account_name, account_type, phone, tax_no } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO accounts (account_name, account_type, phone, tax_no) VALUES ($1, $2, $3, $4) RETURNING *',
      [account_name, account_type, phone, tax_no]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tanımlar
app.get('/api/brands', async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM brands'); res.json(rows); } catch (err) { res.status(500).json(err); }
});
app.get('/api/series', async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM series'); res.json(rows); } catch (err) { res.status(500).json(err); }
});
app.post('/api/series', async (req, res) => {
  const { series_name, brand_id } = req.body;
  try { const r = await pool.query('INSERT INTO series (series_name, brand_id) VALUES ($1, $2) RETURNING *', [series_name, brand_id]); res.json(r.rows[0]); } catch (e) { res.status(500).json(e); }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda.`));
