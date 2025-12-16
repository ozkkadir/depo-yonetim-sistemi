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

app.get('/', (req, res) => res.send('DepoPro V4 - Full Detay API Hazır!'));

// --- GELİŞMİŞ VERİTABANI KURULUMU (RESET) ---
// Frontend'deki "Veritabanını Sıfırla" butonu burayı tetikler.
app.get('/api/setup-db', async (req, res) => {
  try {
    const setupQuery = `
      -- 1. Önce eski tabloları temizle
      DROP TABLE IF EXISTS account_transactions, accounts, inventory, product_series_map, products, series, colors, categories, brands CASCADE;

      -- 2. Tanım Tabloları Oluştur
      CREATE TABLE brands (brand_id SERIAL PRIMARY KEY, brand_name VARCHAR(100));
      CREATE TABLE categories (category_id SERIAL PRIMARY KEY, category_name VARCHAR(100));
      CREATE TABLE colors (color_id SERIAL PRIMARY KEY, color_name VARCHAR(50), hex_code VARCHAR(7));
      
      -- 3. Seri Tablosu
      CREATE TABLE series (
          series_id SERIAL PRIMARY KEY, 
          series_name VARCHAR(100), 
          brand_id INT REFERENCES brands(brand_id)
      );
      
      -- 4. Ürün Ana Kartı (Detaylı)
      CREATE TABLE products (
          product_id SERIAL PRIMARY KEY,
          product_code VARCHAR(50) UNIQUE, -- Stok Kodu (Örn: KP-100)
          product_name VARCHAR(150),
          category_id INT REFERENCES categories(category_id),
          brand_id INT REFERENCES brands(brand_id),
          image_url TEXT, -- Ürün Resmi Linki
          technical_drawing_url TEXT, -- Teknik Çizim Linki
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Ürün-Seri Eşleşmesi (Bir ürün birden fazla seriye uyumlu olabilir)
      CREATE TABLE product_series_map (
          map_id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          series_id INT REFERENCES series(series_id) ON DELETE CASCADE
      );

      -- 5. Stok Varyantları (Fiyatlar ve Stok Miktarı Burada)
      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          color_id INT REFERENCES colors(color_id),
          quantity DECIMAL(10, 2) DEFAULT 0,
          unit VARCHAR(20) DEFAULT 'Adet',
          critical_stock INT DEFAULT 10,
          buying_price DECIMAL(10, 2) DEFAULT 0, -- Alış Fiyatı (Maliyet)
          selling_price DECIMAL(10, 2) DEFAULT 0, -- Satış Fiyatı (Liste)
          currency VARCHAR(3) DEFAULT 'TRY'
      );

      -- 6. Cari Hesaplar
      CREATE TABLE accounts (
          account_id SERIAL PRIMARY KEY,
          account_name VARCHAR(150),
          account_type VARCHAR(20), 
          phone VARCHAR(20),
          tax_no VARCHAR(50),
          current_balance DECIMAL(12, 2) DEFAULT 0
      );

      -- 7. Varsayılan (Örnek) Verileri Yükle
      INSERT INTO brands (brand_name) VALUES ('Albert Genau'), ('Pimapen'), ('Winsa'), ('Asaş');
      INSERT INTO categories (category_name) VALUES ('Profil'), ('Aksesuar'), ('Menteşe'), ('Tekerlek');
      INSERT INTO colors (color_name, hex_code) VALUES ('Eloksal', '#C0C0C0'), ('Antrasit', '#2F4F4F'), ('Siyah', '#000000'), ('Ham', '#F5F5DC'), ('Beyaz', '#FFFFFF');
      INSERT INTO series (series_name, brand_id) VALUES ('Statü', 1), ('Tiara 08', 1), ('Comfort', 2);
      
      -- Örnek Ürün Ekleme
      INSERT INTO products (product_code, product_name, category_id, brand_id, image_url) 
      VALUES ('KP-100', 'Köşe Dönüş Profili', 1, 1, 'https://placehold.co/100x100?text=Profil');
      
      -- Örnek Stoğu Ekleme
      INSERT INTO inventory (product_id, color_id, quantity, unit, buying_price, selling_price) 
      VALUES (1, 1, 100, 'Boy', 150.00, 250.00); 

      INSERT INTO accounts (account_name, account_type, phone, current_balance) VALUES ('Örnek Yapı Market', 'Musteri', '05551112233', 5000);
    `;
    
    await pool.query(setupQuery);
    res.send("<h1>Veritabanı Başarıyla Kuruldu (V4)!</h1>");
  } catch (err) { 
    console.error(err);
    res.status(500).send(`Hata: ${err.message}`); 
  }
});

// --- ROTALAR ---

// 1. Ürünleri Listele (Frontend'in beklediği detaylı yapı)
app.get('/api/products', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.*, 
        b.brand_name, 
        c.category_name,
        -- Ürüne bağlı serileri dizi olarak çek
        COALESCE((
          SELECT json_agg(s.series_name) 
          FROM product_series_map psm 
          JOIN series s ON psm.series_id = s.series_id 
          WHERE psm.product_id = p.product_id
        ), '[]') as series,
        -- Ürüne bağlı varyantları (renk, stok, fiyat) çek
        COALESCE(json_agg(json_build_object(
          'inv_id', i.inventory_id, 
          'color', co.color_name, 
          'stock', i.quantity, 
          'unit', i.unit, 
          'critical', i.critical_stock, 
          'buying_price', i.buying_price, 
          'selling_price', i.selling_price
        )) FILTER (WHERE co.color_name IS NOT NULL), '[]') as variants
      FROM products p
      JOIN brands b ON p.brand_id = b.brand_id
      JOIN categories c ON p.category_id = c.category_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      LEFT JOIN colors co ON i.color_id = co.color_id
      GROUP BY p.product_id, b.brand_name, c.category_name;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) { res.status(500).json(err); }
});

// 2. Yeni Ürün Ekle (TRANSACTION ile güvenli kayıt)
// Frontend'deki Modal bu adrese POST atar.
app.post('/api/products', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // İşlemi başlat
    
    // Gelen verileri al
    const { code, name, brand_id, category_id, image_url, tech_url, series_ids, variants } = req.body;

    // A. Ürün Kartını Oluştur
    const prodRes = await client.query(
      `INSERT INTO products (product_code, product_name, brand_id, category_id, image_url, technical_drawing_url) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING product_id`,
      [code, name, brand_id, category_id, image_url, tech_url]
    );
    const productId = prodRes.rows[0].product_id;

    // B. Serilerle Eşleştir (Varsa)
    if (series_ids && series_ids.length > 0) {
      for (let sid of series_ids) {
        await client.query('INSERT INTO product_series_map (product_id, series_id) VALUES ($1, $2)', [productId, sid]);
      }
    }

    // C. Stok Varyantlarını Ekle (Renk, Adet, Fiyat)
    if (variants && variants.length > 0) {
      for (let v of variants) {
        // Boş varyant gelirse atla
        if (!v.color_id) continue;
        
        await client.query(
          `INSERT INTO inventory (product_id, color_id, quantity, unit, buying_price, selling_price) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [productId, v.color_id, v.quantity || 0, v.unit || 'Adet', v.buying_price || 0, v.selling_price || 0]
        );
      }
    }

    await client.query('COMMIT'); // Hata yoksa onayla
    res.json({ message: 'Ürün başarıyla oluşturuldu' });
  } catch (e) {
    await client.query('ROLLBACK'); // Hata varsa her şeyi geri al
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// 3. Ürün Silme
app.delete('/api/products/:id', async (req, res) => {
  try { 
    await pool.query('DELETE FROM products WHERE product_id=$1', [req.params.id]); 
    res.json({msg:'ok'}); 
  } catch(e) { res.status(500).json(e); } 
});

// 4. Stok Miktarı Güncelleme (Hızlı İşlem)
app.put('/api/inventory/:id', async (req, res) => { 
  try { 
    await pool.query('UPDATE inventory SET quantity=$1 WHERE inventory_id=$2', [req.body.quantity, req.params.id]); 
    res.json({msg:'ok'}); 
  } catch(e) { res.status(500).json(e); } 
});

// --- YARDIMCI TANIM ROTALARI ---

// Markalar
app.get('/api/brands', async (req, res) => { try { const { rows } = await pool.query('SELECT * FROM brands ORDER BY brand_name'); res.json(rows); } catch(e) { res.status(500).json(e); } });
app.post('/api/brands', async (req, res) => { try { await pool.query('INSERT INTO brands (brand_name) VALUES ($1)', [req.body.brand_name]); res.json({msg:'ok'}); } catch(e) { res.status(500).json(e); } });
app.delete('/api/brands/:id', async (req, res) => { try { await pool.query('DELETE FROM brands WHERE brand_id=$1', [req.params.id]); res.json({msg:'ok'}); } catch(e) { res.status(500).json(e); } });

// Seriler
app.get('/api/series', async (req, res) => { try { const { rows } = await pool.query('SELECT s.*, b.brand_name FROM series s JOIN brands b ON s.brand_id = b.brand_id ORDER BY s.series_name'); res.json(rows); } catch(e) { res.status(500).json(e); } });
app.post('/api/series', async (req, res) => { try { await pool.query('INSERT INTO series (series_name, brand_id) VALUES ($1, $2)', [req.body.series_name, req.body.brand_id]); res.json({msg:'ok'}); } catch(e) { res.status(500).json(e); } });
app.delete('/api/series/:id', async (req, res) => { try { await pool.query('DELETE FROM series WHERE series_id=$1', [req.params.id]); res.json({msg:'ok'}); } catch(e) { res.status(500).json(e); } });

// Diğerleri (Dropdownlar için)
app.get('/api/categories', async (req, res) => { try { const { rows } = await pool.query('SELECT * FROM categories'); res.json(rows); } catch(e) { res.status(500).json(e); } });
app.get('/api/colors', async (req, res) => { try { const { rows } = await pool.query('SELECT * FROM colors'); res.json(rows); } catch(e) { res.status(500).json(e); } });

// Cari Hesaplar
app.get('/api/accounts', async (req, res) => { try { const { rows } = await pool.query('SELECT * FROM accounts ORDER BY account_name'); res.json(rows); } catch(e) { res.status(500).json(e); } });
app.post('/api/accounts', async (req, res) => { 
  const { account_name, account_type, phone, tax_no } = req.body;
  try { 
    await pool.query('INSERT INTO accounts (account_name, account_type, phone, tax_no) VALUES ($1, $2, $3, $4)', [account_name, account_type, phone, tax_no]); 
    res.json({msg:'ok'}); 
  } catch(e) { res.status(500).json(e); } 
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda.`));
