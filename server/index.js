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

app.get('/', (req, res) => res.send('DepoPro V7 - Grid & Filtre API Hazır!'));

// --- VERİTABANI KURULUMU (RESET) ---
app.get('/api/setup-db', async (req, res) => {
  try {
    // Temizlik
    await pool.query('DROP TABLE IF EXISTS account_transactions, accounts, inventory, product_series_map, products, series, colors, categories, brands CASCADE');

    // Tablolar
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
          package_quantity INT DEFAULT 1,
          unit_length DECIMAL(5,2) DEFAULT 6.00,
          profile_type VARCHAR(20) DEFAULT 'Standart'
      );

      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          color_id INT REFERENCES colors(color_id) ON DELETE SET NULL,
          quantity DECIMAL(10, 2) DEFAULT 0,
          unit VARCHAR(20) DEFAULT 'Adet',
          cost_price DECIMAL(10, 2) DEFAULT 0,
          list_price DECIMAL(10, 2) DEFAULT 0,
          last_shipment_date DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE product_series_map (map_id SERIAL PRIMARY KEY, product_id INT REFERENCES products(product_id) ON DELETE CASCADE, series_id INT REFERENCES series(series_id) ON DELETE CASCADE);
      
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
      
      INSERT INTO products (product_code, product_name, category_id, brand_id, profile_type, package_quantity, unit_length) 
      VALUES ('KP-100', 'Tiara Kanat Profili', 1, 1, 'Kanat', 5, 6.00);
      
      INSERT INTO inventory (product_id, color_id, quantity, unit, cost_price, list_price) VALUES (1, 1, 120, 'Boy', 150, 250);
      
      INSERT INTO accounts (account_name, account_type, phone, current_balance) VALUES ('Örnek Yapı Market', 'Musteri', '05551112233', 15000);
    `);

    res.send("<h1>Sistem V7 (Grid & Filtre) Kuruldu!</h1>");
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
          'unit', i.unit, 'cost_price', i.cost_price, 'list_price', i.list_price,
          'last_date', i.last_shipment_date
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

// Toplu Ürün Ekleme (CSV/Excel İçin)
app.post('/api/products/batch', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const products = req.body; // [{code, name, brand, ...}, ...]

    for (let p of products) {
      // Marka ve Kategori ID'lerini bul veya oluştur
      let brandId = null;
      if (p.brand) {
        const bRes = await client.query('SELECT brand_id FROM brands WHERE brand_name = $1', [p.brand]);
        if (bRes.rows.length > 0) brandId = bRes.rows[0].brand_id;
        else {
           const newB = await client.query('INSERT INTO brands (brand_name) VALUES ($1) RETURNING brand_id', [p.brand]);
           brandId = newB.rows[0].brand_id;
        }
      }

      let catId = null;
      if (p.category) {
        const cRes = await client.query('SELECT category_id FROM categories WHERE category_name = $1', [p.category]);
        if (cRes.rows.length > 0) catId = cRes.rows[0].category_id;
        else {
           const newC = await client.query('INSERT INTO categories (category_name) VALUES ($1) RETURNING category_id', [p.category]);
           catId = newC.rows[0].category_id;
        }
      }

      // Ürünü Ekle
      const prodRes = await client.query(
        `INSERT INTO products (product_code, product_name, brand_id, category_id, package_quantity, unit_length, profile_type) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         ON CONFLICT (product_code) DO UPDATE SET product_name = EXCLUDED.product_name 
         RETURNING product_id`,
        [p.code, p.name, brandId, catId, p.package_qty || 1, p.unit_len || 6, p.profile_type || 'Standart']
      );
      const pid = prodRes.rows[0].product_id;

      // Stoğu Ekle (Varsayılan Eloksal - ID 1)
      await client.query(
        'INSERT INTO inventory (product_id, color_id, quantity, unit, cost_price, list_price) VALUES ($1, 1, $2, $3, $4, $5)',
        [pid, p.stock || 0, p.unit || 'Adet', p.cost || 0, p.list || 0]
      );
    }

    await client.query('COMMIT');
    res.json({success: true, count: products.length});
  } catch (e) { 
    await client.query('ROLLBACK'); 
    res.status(500).json({error: e.message}); 
  } finally { client.release(); }
});

// Tekil Ürün Ekle
app.post('/api/products', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { code, name, brand_id, category_id, image_url, tech_url, package_qty, unit_len, profile_type, series_ids, variants } = req.body;

    const pRes = await client.query(
      `INSERT INTO products (product_code, product_name, brand_id, category_id, image_url, technical_drawing_url, package_quantity, unit_length, profile_type) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING product_id`,
      [code, name, brand_id, category_id, image_url, tech_url, package_qty || 1, unit_len || 0, profile_type || 'Standart']
    );
    const pid = pRes.rows[0].product_id;

    if(series_ids?.length) for(let sid of series_ids) await client.query('INSERT INTO product_series_map VALUES (DEFAULT, $1, $2)', [pid, sid]);

    if(variants?.length) {
      for(let v of variants) {
        if(!v.color_id) continue;
        await client.query(
          'INSERT INTO inventory (product_id, color_id, quantity, unit, cost_price, list_price, last_shipment_date) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)',
          [pid, v.color_id, v.quantity, v.unit, v.cost_price, v.list_price]
        );
      }
    }
    await client.query('COMMIT');
    res.json({success:true});
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({error:e.message}); } finally { client.release(); }
});

// Güncelleme ve Silme
app.put('/api/inventory/:id', async(req,res)=>{ 
  try { await pool.query('UPDATE inventory SET quantity=$1 WHERE inventory_id=$2',[req.body.quantity, req.params.id]); res.json({ok:true}); } 
  catch(e){ res.status(500).json(e); } 
});

app.delete('/api/products/:id', async(req,res)=>{ try{ await pool.query('DELETE FROM products WHERE product_id=$1',[req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json(e);} });
app.delete('/api/brands/:id', async(req,res)=>{ try{ await pool.query('DELETE FROM brands WHERE brand_id=$1',[req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json(e);} });
app.delete('/api/series/:id', async(req,res)=>{ try{ await pool.query('DELETE FROM series WHERE series_id=$1',[req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json(e);} });

// Tanım ve Listeler
app.post('/api/brands', async(req,res)=>{ await pool.query('INSERT INTO brands (brand_name) VALUES ($1)',[req.body.brand_name]); res.json({ok:true}); });
app.post('/api/series', async(req,res)=>{ await pool.query('INSERT INTO series (series_name, brand_id) VALUES ($1,$2)',[req.body.series_name, req.body.brand_id]); res.json({ok:true}); });
app.post('/api/accounts', async(req,res)=>{ await pool.query('INSERT INTO accounts (account_name, account_type, phone, tax_no) VALUES ($1, $2, $3, $4)', [req.body.account_name, req.body.account_type, req.body.phone, req.body.tax_no]); res.json({ok:true}); });

app.get('/api/brands', async(req,res)=>{ const r=await pool.query('SELECT * FROM brands ORDER BY brand_name'); res.json(r.rows); });
app.get('/api/series', async(req,res)=>{ const r=await pool.query('SELECT s.*, b.brand_name FROM series s JOIN brands b ON s.brand_id=b.brand_id ORDER BY s.series_name'); res.json(r.rows); });
app.get('/api/categories', async(req,res)=>{ const r=await pool.query('SELECT * FROM categories'); res.json(r.rows); });
app.get('/api/colors', async(req,res)=>{ const r=await pool.query('SELECT * FROM colors'); res.json(r.rows); });
app.get('/api/accounts', async(req,res)=>{ const r=await pool.query('SELECT * FROM accounts ORDER BY account_name'); res.json(r.rows); });

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda.`));
