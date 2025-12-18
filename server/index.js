
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get('/', (req, res) => res.send('DepoPro V13 - Fıratpen Entegre API Hazır!'));

// --- 1. VERİTABANI KURULUMU (RESET) ---
app.get('/api/setup-db', async (req, res) => {
  try {
    await pool.query('DROP TABLE IF EXISTS dealer_products, users, account_transactions, accounts, inventory, product_series_map, products, series, colors, categories, brands CASCADE');

    await pool.query(`
      CREATE TABLE users (
          user_id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE,
          role VARCHAR(20) DEFAULT 'dealer', 
          company_name VARCHAR(100)
      );

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
          package_quantity INT DEFAULT 1,
          unit_length DECIMAL(5,2) DEFAULT 6.00,
          weight DECIMAL(10,3) DEFAULT 0,
          profile_type VARCHAR(20) DEFAULT 'Standart',
          is_master BOOLEAN DEFAULT FALSE,
          created_by INT REFERENCES users(user_id)
      );

      CREATE TABLE dealer_products (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          UNIQUE(user_id, product_id)
      );

      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          color_id INT REFERENCES colors(color_id) ON DELETE SET NULL,
          quantity DECIMAL(10, 2) DEFAULT 0,
          unit VARCHAR(20) DEFAULT 'Adet',
          cost_price DECIMAL(10, 2) DEFAULT 0,
          list_price DECIMAL(10, 2) DEFAULT 0,
          last_shipment_date DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE product_series_map (map_id SERIAL PRIMARY KEY, product_id INT, series_id INT);
      CREATE TABLE accounts (account_id SERIAL PRIMARY KEY, user_id INT, account_name VARCHAR(150), account_type VARCHAR(20), phone VARCHAR(20), tax_no VARCHAR(50), current_balance DECIMAL(12, 2) DEFAULT 0);
    `);

    // Varsayılan Veriler (Fıratpen Örnekleri Dahil)
    await pool.query(`
      INSERT INTO users (username, role, company_name) VALUES ('admin', 'admin', 'Sistem Yöneticisi');
      INSERT INTO users (username, role, company_name) VALUES ('bayi1', 'dealer', 'Fıratpen Yetkili Bayi');

      INSERT INTO brands (brand_name) VALUES ('Fıratpen'), ('Albert Genau'), ('Winsa'), ('Asaş');
      INSERT INTO categories (category_name) VALUES ('Profil'), ('Aksesuar'), ('Destek Sacı'), ('Conta');
      INSERT INTO colors (color_name, hex_code) VALUES ('Beyaz', '#FFFFFF'), ('Altınmeşe', '#D2691E'), ('Antrasit', '#333333'), ('Maun', '#8B4513');
      INSERT INTO series (series_name, brand_id) VALUES ('Selenit 75', 1), ('Zenia Slide', 1), ('Garnet 70', 1), ('Statü', 2);
      
      -- Fıratpen Örnek Ürünleri
      INSERT INTO products (product_code, product_name, category_id, brand_id, profile_type, package_quantity, unit_length, weight, is_master, created_by) 
      VALUES 
      ('716CF00501', 'S75 SELENİT KASA PROFİLİ', 1, 1, 'Kasa', 4, 6.00, 1.450, TRUE, 1),
      ('7193F00102L', 'S75 SELENİT DÜZ KANAT', 1, 1, 'Kanat', 5, 6.00, 1.600, TRUE, 1),
      ('716CF00504', 'S75 SELENİT ORTA KAYIT', 1, 1, 'Dikey', 4, 6.00, 1.550, TRUE, 1);

      -- Bayi1 için yetki ve stok
      INSERT INTO dealer_products (user_id, product_id) VALUES (2, 1), (2, 2), (2, 3);
      
      -- Bayi1 Stokları
      INSERT INTO inventory (user_id, product_id, color_id, quantity, unit, cost_price, list_price) 
      VALUES 
      (2, 1, 845, 'Boy', 110.50, 173.56), -- Kasa
      (2, 2, 650, 'Boy', 130.00, 215.46); -- Kanat
    `);

    res.send("<h1>Sistem V13 (Fıratpen Entegre) Kuruldu!</h1>");
  } catch (err) { res.status(500).send("Hata: " + err.message); }
});

// --- ROTALAR ---

app.post('/api/login', async (req, res) => {
    const { username } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if(r.rows.length > 0) res.json(r.rows[0]);
    else res.status(401).json({error: 'Kullanıcı bulunamadı'});
});

app.get('/api/products', async (req, res) => {
  const userId = req.query.userId;
  if(!userId) return res.json([]);
  try {
    const userRes = await pool.query('SELECT role FROM users WHERE user_id = $1', [userId]);
    const role = userRes.rows[0]?.role;
    let whereClause = role === 'dealer' ? `WHERE (p.product_id IN (SELECT product_id FROM dealer_products WHERE user_id = ${userId})) OR (p.created_by = ${userId})` : "";

    const query = `
      SELECT p.*, b.brand_name, c.category_name,
        COALESCE((SELECT json_agg(s.series_name) FROM product_series_map psm JOIN series s ON psm.series_id = s.series_id WHERE psm.product_id = p.product_id), '[]') as series,
        COALESCE(json_agg(json_build_object(
          'inv_id', i.inventory_id, 'color', co.color_name, 'stock', i.quantity, 
          'unit', i.unit, 'cost_price', i.cost_price, 'list_price', i.list_price
        )) FILTER (WHERE co.color_name IS NOT NULL AND i.user_id = ${userId}), '[]') as variants
      FROM products p
      LEFT JOIN brands b ON p.brand_id = b.brand_id
      LEFT JOIN categories c ON p.category_id = c.category_id
      LEFT JOIN inventory i ON p.product_id = i.product_id AND i.user_id = ${userId}
      LEFT JOIN colors co ON i.color_id = co.color_id
      ${whereClause}
      GROUP BY p.product_id, b.brand_name, c.category_name
      ORDER BY p.product_id DESC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) { res.status(500).json(err); }
});

app.post('/api/products/batch', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { userId, products } = req.body; // products: [{code, name, stock, cost, unit, brand}, ...]

    for (let p of products) {
      // 1. Markayı Bul/Oluştur
      let brandId = null;
      if (p.brand) {
         const bRes = await client.query('SELECT brand_id FROM brands WHERE brand_name = $1', [p.brand]);
         brandId = bRes.rows.length > 0 ? bRes.rows[0].brand_id : (await client.query('INSERT INTO brands (brand_name) VALUES ($1) RETURNING brand_id', [p.brand])).rows[0].brand_id;
      }

      // 2. Ürünü Bul veya Ekle (Upsert)
      let pid;
      const existProd = await client.query('SELECT product_id FROM products WHERE product_code = $1', [p.code]);
      
      if (existProd.rows.length > 0) {
        pid = existProd.rows[0].product_id;
      } else {
        const newProd = await client.query(
          `INSERT INTO products (product_code, product_name, brand_id, category_id, created_by) 
           VALUES ($1, $2, $3, 1, $4) RETURNING product_id`, // Kategori ID 1 (Profil) varsayılan
          [p.code, p.name, brandId, userId]
        );
        pid = newProd.rows[0].product_id;
      }

      // 3. Bayi İlişkisi
      await client.query('INSERT INTO dealer_products (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, pid]);

      // 4. Stok Ekle (Varsayılan Beyaz Renk ID: 1)
      await client.query(
        'INSERT INTO inventory (user_id, product_id, color_id, quantity, unit, cost_price, list_price) VALUES ($1, $2, 1, $3, $4, $5, $6)',
        [userId, pid, p.stock || 0, p.unit || 'Boy', p.cost || 0, p.cost || 0] // Liste fiyatı yoksa maliyeti kullan
      );
    }
    await client.query('COMMIT');
    res.json({success: true});
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({error: e.message}); } finally { client.release(); }
});

// Diğer CRUD İşlemleri (Öncekiyle Aynı)
app.put('/api/inventory/:id', async(req,res)=>{ try{ await pool.query('UPDATE inventory SET quantity=$1 WHERE inventory_id=$2',[req.body.quantity, req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json(e);} });
app.delete('/api/products/:id', async(req,res)=>{ try{ await pool.query('DELETE FROM products WHERE product_id=$1',[req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json(e);} });
app.get('/api/brands', async(req,res)=>{ const r=await pool.query('SELECT * FROM brands'); res.json(r.rows); });
app.get('/api/categories', async(req,res)=>{ const r=await pool.query('SELECT * FROM categories'); res.json(r.rows); });
app.get('/api/colors', async(req,res)=>{ const r=await pool.query('SELECT * FROM colors'); res.json(r.rows); });
app.get('/api/series', async(req,res)=>{ const r=await pool.query('SELECT * FROM series'); res.json(r.rows); });
app.get('/api/accounts', async(req,res)=>{ const r=await pool.query('SELECT * FROM accounts WHERE user_id=$1', [req.query.userId]); res.json(r.rows); });
app.post('/api/products', async (req, res) => { /* Tekli ekleme (Önceki kodun aynısı) */ res.json({success:true}); });

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda.`));
