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

app.get('/', (req, res) => res.send('DepoPro Ultimate API Hazır!'));

// --- 1. VERİTABANI KURULUMU (RESET) ---
// Frontend'den "Veritabanını Sıfırla" denince burası çalışır.
app.get('/api/setup-db', async (req, res) => {
  try {
    // Önce temizlik (Her şeyi sil)
    await pool.query('DROP TABLE IF EXISTS account_transactions, accounts, inventory, product_series_map, products, series, colors, categories, brands CASCADE');

    // Tabloları oluştur
    await pool.query(`
      CREATE TABLE brands (brand_id SERIAL PRIMARY KEY, brand_name VARCHAR(100));
      CREATE TABLE categories (category_id SERIAL PRIMARY KEY, category_name VARCHAR(100));
      CREATE TABLE colors (color_id SERIAL PRIMARY KEY, color_name VARCHAR(50), hex_code VARCHAR(7));
      CREATE TABLE series (series_id SERIAL PRIMARY KEY, series_name VARCHAR(100), brand_id INT REFERENCES brands(brand_id) ON DELETE CASCADE);
      
      CREATE TABLE products (
          product_id SERIAL PRIMARY KEY,
          product_code VARCHAR(50),
          product_name VARCHAR(150),
          category_id INT REFERENCES categories(category_id) ON DELETE SET NULL,
          brand_id INT REFERENCES brands(brand_id) ON DELETE SET NULL,
          image_url TEXT,
          technical_drawing_url TEXT,
          package_quantity INT DEFAULT 1, -- Koli/Paket içi adet
          unit_length DECIMAL(5,2) DEFAULT 0 -- Profil boy uzunluğu (metre)
      );

      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          color_id INT REFERENCES colors(color_id) ON DELETE SET NULL,
          quantity DECIMAL(10, 2) DEFAULT 0,
          unit VARCHAR(20) DEFAULT 'Adet',
          buying_price DECIMAL(10, 2) DEFAULT 0,
          selling_price DECIMAL(10, 2) DEFAULT 0
      );

      CREATE TABLE product_series_map (
          map_id SERIAL PRIMARY KEY, 
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE, 
          series_id INT REFERENCES series(series_id) ON DELETE CASCADE
      );
      
      CREATE TABLE accounts (
          account_id SERIAL PRIMARY KEY, 
          account_name VARCHAR(150), 
          account_type VARCHAR(20), 
          phone VARCHAR(20), 
          tax_no VARCHAR(50),
          current_balance DECIMAL(12, 2) DEFAULT 0
      );
    `);

    // Varsayılan Veriler
    await pool.query(`
      INSERT INTO brands (brand_name) VALUES ('Albert Genau'), ('Pimapen'), ('Winsa'), ('Asaş');
      INSERT INTO categories (category_name) VALUES ('Profil'), ('Aksesuar'), ('Tekerlek'), ('Menteşe');
      INSERT INTO colors (color_name, hex_code) VALUES ('Eloksal', '#C0C0C0'), ('Antrasit', '#333333'), ('Siyah', '#000000'), ('Ham', '#F5F5DC'), ('Beyaz', '#FFFFFF');
      INSERT INTO series (series_name, brand_id) VALUES ('Statü', 1), ('Tiara 08', 1), ('Nirvana', 2);
      
      -- Örnek: KP-100 Profili (1 Pakette 5 Boy, 1 Boy 6 Metre)
      INSERT INTO products (product_code, product_name, category_id, brand_id, package_quantity, unit_length) 
      VALUES ('KP-100', 'Köşe Dönüş Profili', 1, 1, 5, 6.00);
      
      INSERT INTO inventory (product_id, color_id, quantity, unit, buying_price, selling_price) 
      VALUES (1, 1, 120, 'Boy', 150, 250);

      INSERT INTO accounts (account_name, account_type, phone, current_balance) VALUES ('Örnek Yapı Market', 'Musteri', '05551112233', 5000);
    `);

    res.send("<h1>Sistem Başarıyla Kuruldu (V5 Tam Sürüm)</h1>");
  } catch (err) { res.status(500).send("Hata: " + err.message); }
});

// --- ROTALAR ---

// Ürün Listele
app.get('/api/products', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.*, b.brand_name, c.category_name,
        COALESCE((SELECT json_agg(s.series_name) FROM product_series_map psm JOIN series s ON psm.series_id = s.series_id WHERE psm.product_id = p.product_id), '[]') as series,
        COALESCE(json_agg(json_build_object(
          'inv_id', i.inventory_id, 'color', co.color_name, 'stock', i.quantity, 
          'unit', i.unit, 'buying_price', i.buying_price, 'selling_price', i.selling_price
        )) FILTER (WHERE co.color_name IS NOT NULL), '[]') as variants
      FROM products p
      LEFT JOIN brands b ON p.brand_id = b.brand_id
      LEFT JOIN categories c ON p.category_id = c.category_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      LEFT JOIN colors co ON i.color_id = co.color_id
      GROUP BY p.product_id, b.brand_name, c.category_name
      ORDER BY p.product_id DESC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) { res.status(500).json(err); }
});

// Ürün Ekle (Detaylı)
app.post('/api/products', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { code, name, brand_id, category_id, image_url, tech_url, package_qty, unit_len, series_ids, variants } = req.body;

    const pRes = await client.query(
      `INSERT INTO products (product_code, product_name, brand_id, category_id, image_url, technical_drawing_url, package_quantity, unit_length) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING product_id`,
      [code, name, brand_id, category_id, image_url, tech_url, package_qty || 1, unit_len || 0]
    );
    const pid = pRes.rows[0].product_id;

    if(series_ids?.length) {
      for(let sid of series_ids) await client.query('INSERT INTO product_series_map VALUES (DEFAULT, $1, $2)', [pid, sid]);
    }

    if(variants?.length) {
      for(let v of variants) {
        if(!v.color_id) continue;
        await client.query(
          'INSERT INTO inventory (product_id, color_id, quantity, unit, buying_price, selling_price) VALUES ($1, $2, $3, $4, $5, $6)',
          [pid, v.color_id, v.quantity, v.unit, v.buying_price, v.selling_price]
        );
      }
    }
    await client.query('COMMIT');
    res.json({success:true});
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); } finally { client.release(); }
});

// Ürün Silme / Stok Güncelleme
app.delete('/api/products/:id', async(req,res)=>{ try{ await pool.query('DELETE FROM products WHERE product_id=$1',[req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json(e);} });
app.put('/api/inventory/:id', async(req,res)=>{ try{ await pool.query('UPDATE inventory SET quantity=$1 WHERE inventory_id=$2',[req.body.quantity, req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json(e);} });

// Tanım Rotaları
app.get('/api/brands', async(req,res)=>{ const r=await pool.query('SELECT * FROM brands ORDER BY brand_name'); res.json(r.rows); });
app.post('/api/brands', async(req,res)=>{ await pool.query('INSERT INTO brands (brand_name) VALUES ($1)',[req.body.brand_name]); res.json({ok:true}); });
app.delete('/api/brands/:id', async(req,res)=>{ await pool.query('DELETE FROM brands WHERE brand_id=$1',[req.params.id]); res.json({ok:true}); });

app.get('/api/series', async(req,res)=>{ const r=await pool.query('SELECT s.*, b.brand_name FROM series s JOIN brands b ON s.brand_id=b.brand_id ORDER BY s.series_name'); res.json(r.rows); });
app.post('/api/series', async(req,res)=>{ await pool.query('INSERT INTO series (series_name, brand_id) VALUES ($1,$2)',[req.body.series_name, req.body.brand_id]); res.json({ok:true}); });
app.delete('/api/series/:id', async(req,res)=>{ await pool.query('DELETE FROM series WHERE series_id=$1',[req.params.id]); res.json({ok:true}); });

app.get('/api/categories', async(req,res)=>{ const r=await pool.query('SELECT * FROM categories'); res.json(r.rows); });
app.get('/api/colors', async(req,res)=>{ const r=await pool.query('SELECT * FROM colors'); res.json(r.rows); });

// Cari Hesaplar
app.get('/api/accounts', async(req,res)=>{ const r=await pool.query('SELECT * FROM accounts ORDER BY account_name'); res.json(r.rows); });
app.post('/api/accounts', async(req,res)=>{ 
  const { account_name, account_type, phone, tax_no } = req.body;
  await pool.query('INSERT INTO accounts (account_name, account_type, phone, tax_no) VALUES ($1, $2, $3, $4)', [account_name, account_type, phone, tax_no]); 
  res.json({ok:true}); 
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda.`));
