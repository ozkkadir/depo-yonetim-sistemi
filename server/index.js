const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Büyük veri transferleri (PDF/Excel içeriği) için limit artırıldı
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- API KÖK DİZİNİ ---
app.get('/', (req, res) => {
  res.send('DepoPro V14 Ultimate API - Tüm Modüller Aktif');
});

// =================================================================
// 1. VERİTABANI KURULUM VE SIFIRLAMA MODÜLÜ (SETUP DB)
// =================================================================
app.get('/api/setup-db', async (req, res) => {
  try {
    // 1. Önce mevcut tabloları temizle (Sıra önemlidir, Foreign Key hatası almamak için)
    await pool.query(`
      DROP TABLE IF EXISTS dealer_products CASCADE;
      DROP TABLE IF EXISTS account_transactions CASCADE;
      DROP TABLE IF EXISTS accounts CASCADE;
      DROP TABLE IF EXISTS inventory CASCADE;
      DROP TABLE IF EXISTS product_series_map CASCADE;
      DROP TABLE IF EXISTS products CASCADE;
      DROP TABLE IF EXISTS series CASCADE;
      DROP TABLE IF EXISTS colors CASCADE;
      DROP TABLE IF EXISTS categories CASCADE;
      DROP TABLE IF EXISTS brands CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);

    // 2. Tabloları sıfırdan oluştur
    await pool.query(`
      -- KULLANICILAR (SaaS Altyapısı)
      CREATE TABLE users (
          user_id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          role VARCHAR(20) DEFAULT 'dealer', -- 'admin' veya 'dealer'
          company_name VARCHAR(150),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- TANIMLAR (Marka, Kategori, Renk)
      CREATE TABLE brands (
          brand_id SERIAL PRIMARY KEY, 
          brand_name VARCHAR(100) NOT NULL
      );

      CREATE TABLE categories (
          category_id SERIAL PRIMARY KEY, 
          category_name VARCHAR(100) NOT NULL
      );

      CREATE TABLE colors (
          color_id SERIAL PRIMARY KEY, 
          color_name VARCHAR(50) NOT NULL, 
          hex_code VARCHAR(10)
      );

      -- SERİLER (Markaya bağlıdır)
      CREATE TABLE series (
          series_id SERIAL PRIMARY KEY, 
          series_name VARCHAR(100) NOT NULL, 
          brand_id INT REFERENCES brands(brand_id) ON DELETE CASCADE
      );
      
      -- ÜRÜNLER (ANA KART)
      CREATE TABLE products (
          product_id SERIAL PRIMARY KEY,
          product_code VARCHAR(100), -- Stok Kodu (Benzersiz olabilir ama bayi bazlı değişebilir)
          product_name VARCHAR(255),
          category_id INT REFERENCES categories(category_id) ON DELETE SET NULL,
          brand_id INT REFERENCES brands(brand_id) ON DELETE SET NULL,
          image_url TEXT,
          technical_drawing_url TEXT,
          
          -- BİRİM VE FİZİKSEL ÖZELLİKLER
          package_quantity INT DEFAULT 1,      -- Paket içi adet
          unit_length DECIMAL(10,2) DEFAULT 0, -- Boy uzunluğu (metre)
          weight DECIMAL(10,3) DEFAULT 0,      -- Birim ağırlık (kg)
          profile_type VARCHAR(50) DEFAULT 'Standart', -- Kasa, Kanat, Dikey (Analiz için)
          
          -- SAAS ÖZELLİKLERİ
          is_master BOOLEAN DEFAULT FALSE,     -- Admin tarafından eklenen genel ürün mü?
          created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- BAYİ ÜRÜN SEÇİMİ (Hangi bayi hangi ürünü satıyor?)
      CREATE TABLE dealer_products (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          UNIQUE(user_id, product_id)
      );

      -- STOK VE FİYATLAR (Bayiye özeldir)
      CREATE TABLE inventory (
          inventory_id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
          color_id INT REFERENCES colors(color_id) ON DELETE SET NULL,
          
          quantity DECIMAL(12, 2) DEFAULT 0, -- Stok Miktarı
          unit VARCHAR(20) DEFAULT 'Adet',   -- Stok Birimi (Boy, Adet, Koli)
          
          cost_price DECIMAL(12, 2) DEFAULT 0, -- Alış Fiyatı (Maliyet)
          list_price DECIMAL(12, 2) DEFAULT 0, -- Liste Fiyatı (Satış)
          
          last_shipment_date DATE DEFAULT CURRENT_DATE
      );

      -- ÜRÜN-SERİ EŞLEŞMESİ (Bir ürün birden fazla seride kullanılabilir)
      CREATE TABLE product_series_map (
          map_id SERIAL PRIMARY KEY, 
          product_id INT REFERENCES products(product_id) ON DELETE CASCADE, 
          series_id INT REFERENCES series(series_id) ON DELETE CASCADE
      );
      
      -- CARİ HESAPLAR
      CREATE TABLE accounts (
          account_id SERIAL PRIMARY KEY, 
          user_id INT REFERENCES users(user_id) ON DELETE CASCADE, -- Hangi bayinin carisi?
          account_name VARCHAR(200) NOT NULL, 
          account_type VARCHAR(50), -- Müşteri, Tedarikçi
          phone VARCHAR(50), 
          tax_no VARCHAR(50), 
          current_balance DECIMAL(15, 2) DEFAULT 0, -- Bakiye
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Varsayılan (Demo) Verileri Yükle
    await pool.query(`
      -- Kullanıcılar
      INSERT INTO users (username, role, company_name) VALUES ('admin', 'admin', 'Sistem Yöneticisi');
      INSERT INTO users (username, role, company_name) VALUES ('bayi1', 'dealer', 'Fıratpen Yetkili Bayi');

      -- Markalar
      INSERT INTO brands (brand_name) VALUES ('Fıratpen'), ('Albert Genau'), ('Winsa'), ('Asaş'), ('Pimapen');
      
      -- Kategoriler
      INSERT INTO categories (category_name) VALUES ('Profil'), ('Aksesuar'), ('Destek Sacı'), ('Conta'), ('Menteşe'), ('Kıl Fitil');
      
      -- Renkler
      INSERT INTO colors (color_name, hex_code) VALUES ('Beyaz', '#FFFFFF'), ('Altınmeşe', '#D2691E'), ('Antrasit', '#333333'), ('Maun', '#8B4513'), ('Eloksal', '#C0C0C0');
      
      -- Seriler
      INSERT INTO series (series_name, brand_id) VALUES ('Selenit 75', 1), ('Zenia Slide', 1), ('Garnet 70', 1), ('Statü', 2), ('Tiara 08', 2);
      
      -- Örnek Ürünler (Master Data)
      INSERT INTO products (product_code, product_name, category_id, brand_id, profile_type, package_quantity, unit_length, weight, is_master, created_by) 
      VALUES 
      ('716CF00501', 'S75 SELENİT KASA PROFİLİ', 1, 1, 'Kasa', 4, 6.00, 1.450, TRUE, 1),
      ('7193F00102L', 'S75 SELENİT DÜZ KANAT', 1, 1, 'Kanat', 5, 6.00, 1.600, TRUE, 1),
      ('716CF00504', 'S75 SELENİT ORTA KAYIT', 1, 1, 'Dikey', 4, 6.00, 1.550, TRUE, 1);

      -- Bayi1 bu ürünleri satıyor (Abonelik)
      INSERT INTO dealer_products (user_id, product_id) VALUES (2, 1), (2, 2), (2, 3);
      
      -- Bayi1 Stokları (Renk ID 1: Beyaz, ID 3: Antrasit)
      INSERT INTO inventory (user_id, product_id, color_id, quantity, unit, cost_price, list_price) 
      VALUES 
      (2, 1, 1, 845, 'Boy', 110.50, 173.56), -- Kasa Beyaz
      (2, 2, 3, 650, 'Boy', 130.00, 215.46); -- Kanat Antrasit
      
      -- Cari Hesap
      INSERT INTO accounts (user_id, account_name, account_type, phone, current_balance) 
      VALUES (2, 'Ahmet İnşaat Ltd. Şti.', 'Musteri', '0555 123 45 67', 150000.00);
    `);

    res.send(`
      <h1>Sistem V14 Başarıyla Kuruldu!</h1>
      <p>Tüm tablolar (Users, Products, Inventory, Accounts...) oluşturuldu.</p>
      <p>Demo veriler yüklendi.</p>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send(`<h1>HATA OLUŞTU</h1><pre>${err.message}</pre>`);
  }
});

// =================================================================
// 2. ÜRÜN YÖNETİMİ (GET, POST, DELETE)
// =================================================================

// Ürünleri Listele (Filtreli ve Detaylı)
app.get('/api/products', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([]); // Güvenlik: UserID yoksa boş dön

  try {
    // Kullanıcı rolünü bul
    const userRes = await pool.query('SELECT role FROM users WHERE user_id = $1', [userId]);
    const role = userRes.rows[0]?.role;

    // Bayi ise sadece kendi ürünlerini görsün
    let whereClause = "";
    if (role === 'dealer') {
        whereClause = `WHERE (p.product_id IN (SELECT product_id FROM dealer_products WHERE user_id = ${userId})) OR (p.created_by = ${userId})`;
    }

    const query = `
      SELECT 
        p.*, 
        b.brand_name, 
        c.category_name,
        -- Serileri array olarak çek
        COALESCE((
          SELECT json_agg(s.series_name) 
          FROM product_series_map psm 
          JOIN series s ON psm.series_id = s.series_id 
          WHERE psm.product_id = p.product_id
        ), '[]') as series,
        -- Stok varyantlarını detaylı JSON olarak çek
        COALESCE(json_agg(json_build_object(
          'inv_id', i.inventory_id, 
          'color_id', i.color_id,
          'color', co.color_name, 
          'stock', i.quantity, 
          'unit', i.unit, 
          'cost_price', i.cost_price, 
          'list_price', i.list_price,
          'last_date', i.last_shipment_date
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Yeni Ürün Ekle (Tekli)
app.post('/api/products', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { userId, code, name, brand_id, category_id, image_url, tech_url, package_qty, unit_len, weight, profile_type, series_ids, variants } = req.body;

    // Ürün Kartını Oluştur
    const prodRes = await client.query(
      `INSERT INTO products (product_code, product_name, brand_id, category_id, image_url, technical_drawing_url, package_quantity, unit_length, weight, profile_type, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING product_id`,
      [code, name, brand_id, category_id, image_url, tech_url, package_qty || 1, unit_len || 6, weight || 0, profile_type || 'Standart', userId]
    );
    const pid = prodRes.rows[0].product_id;

    // Bayi ile ilişkilendir
    await client.query('INSERT INTO dealer_products (user_id, product_id) VALUES ($1, $2)', [userId, pid]);

    // Serileri Eşle
    if (series_ids && series_ids.length > 0) {
      for (let sid of series_ids) {
        await client.query('INSERT INTO product_series_map (product_id, series_id) VALUES ($1, $2)', [pid, sid]);
      }
    }

    // Stokları Ekle
    if (variants && variants.length > 0) {
      for (let v of variants) {
        if (!v.color_id) continue;
        await client.query(
          `INSERT INTO inventory (user_id, product_id, color_id, quantity, unit, cost_price, list_price) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, pid, v.color_id, v.quantity || 0, v.unit || 'Adet', v.cost_price || 0, v.list_price || 0]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Ürün başarıyla eklendi' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Toplu Ürün Ekleme (Excel/PDF Import İçin - GÜÇLENDİRİLMİŞ)
app.post('/api/products/batch', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { userId, products } = req.body;

    for (let p of products) {
      // 1. Markayı Bul veya Oluştur
      let brandId = null;
      if (p.brand) {
         const bRes = await client.query('SELECT brand_id FROM brands WHERE brand_name = $1', [p.brand]);
         if (bRes.rows.length > 0) {
            brandId = bRes.rows[0].brand_id;
         } else {
            const newB = await client.query('INSERT INTO brands (brand_name) VALUES ($1) RETURNING brand_id', [p.brand]);
            brandId = newB.rows[0].brand_id;
         }
      }

      // 2. Ürünü Bul veya Ekle (Upsert Mantığı)
      let pid;
      const existProd = await client.query('SELECT product_id FROM products WHERE product_code = $1', [p.code]);
      
      if (existProd.rows.length > 0) {
        pid = existProd.rows[0].product_id;
        // Mevcut ürünse adını güncelle (İsteğe bağlı)
        await client.query('UPDATE products SET product_name = $1 WHERE product_id = $2', [p.name, pid]);
      } else {
        const newProd = await client.query(
          `INSERT INTO products (product_code, product_name, brand_id, category_id, created_by) 
           VALUES ($1, $2, $3, 1, $4) RETURNING product_id`, // Kategori 1 (Profil) varsayılan
          [p.code, p.name, brandId, userId]
        );
        pid = newProd.rows[0].product_id;
      }

      // 3. Bayi İlişkisi Kur
      await client.query('INSERT INTO dealer_products (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, pid]);

      // 4. Stok Ekle/Güncelle (Varsayılan Renk ID: 1 Beyaz)
      // Önce bu ürün ve renk için stok var mı bak
      const existInv = await client.query('SELECT inventory_id FROM inventory WHERE user_id=$1 AND product_id=$2 AND color_id=1', [userId, pid]);
      
      if (existInv.rows.length > 0) {
        // Varsa güncelle
        await client.query('UPDATE inventory SET quantity = $1, cost_price = $2, list_price = $3 WHERE inventory_id = $4',
            [p.stock, p.cost, p.cost, existInv.rows[0].inventory_id]);
      } else {
        // Yoksa ekle
        await client.query(
            'INSERT INTO inventory (user_id, product_id, color_id, quantity, unit, cost_price, list_price) VALUES ($1, $2, 1, $3, $4, $5, $6)',
            [userId, pid, p.stock || 0, p.unit || 'Boy', p.cost || 0, p.cost || 0]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, count: products.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Ürün Silme
app.delete('/api/products/:id', async (req, res) => {
    try {
        // İlgili tüm veriler CASCADE ile silinir
        await pool.query('DELETE FROM products WHERE product_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Ürün Düzenleme (PUT)
app.put('/api/products/:id', async (req, res) => {
    // Basitlik için sadece temel bilgileri güncelleme
    const { code, name, brand_id, category_id, package_qty, unit_len, weight, profile_type } = req.body;
    try {
        await pool.query(
            `UPDATE products SET product_code=$1, product_name=$2, brand_id=$3, category_id=$4, package_quantity=$5, unit_length=$6, weight=$7, profile_type=$8 WHERE product_id=$9`,
            [code, name, brand_id, category_id, package_qty, unit_len, weight, profile_type, req.params.id]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =================================================================
// 3. STOK VE CARİ YÖNETİMİ
// =================================================================

// Hızlı Stok Güncelleme
app.put('/api/inventory/:id', async (req, res) => {
    const { quantity } = req.body;
    try {
        await pool.query('UPDATE inventory SET quantity = $1 WHERE inventory_id = $2', [quantity, req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cari Ekleme
app.post('/api/accounts', async (req, res) => {
    const { userId, account_name, account_type, phone, tax_no } = req.body;
    try {
        await pool.query(
            'INSERT INTO accounts (user_id, account_name, account_type, phone, tax_no) VALUES ($1, $2, $3, $4, $5)',
            [userId, account_name, account_type, phone, tax_no]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// =================================================================
// 4. YARDIMCI VERİLER (DROPDOWNS)
// =================================================================

app.post('/api/login', async (req, res) => {
    const { username } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if(r.rows.length > 0) res.json(r.rows[0]);
    else res.status(401).json({error: 'Kullanıcı bulunamadı'});
});

app.get('/api/brands', async (req, res) => {
    const r = await pool.query('SELECT * FROM brands ORDER BY brand_name');
    res.json(r.rows);
});
app.post('/api/brands', async (req, res) => {
    await pool.query('INSERT INTO brands (brand_name) VALUES ($1)', [req.body.brand_name]);
    res.json({success: true});
});
app.delete('/api/brands/:id', async (req, res) => {
    await pool.query('DELETE FROM brands WHERE brand_id=$1', [req.params.id]);
    res.json({success: true});
});

app.get('/api/series', async (req, res) => {
    const r = await pool.query('SELECT s.*, b.brand_name FROM series s JOIN brands b ON s.brand_id = b.brand_id ORDER BY s.series_name');
    res.json(r.rows);
});
app.post('/api/series', async (req, res) => {
    await pool.query('INSERT INTO series (series_name, brand_id) VALUES ($1, $2)', [req.body.series_name, req.body.brand_id]);
    res.json({success: true});
});
app.delete('/api/series/:id', async (req, res) => {
    await pool.query('DELETE FROM series WHERE series_id=$1', [req.params.id]);
    res.json({success: true});
});

app.get('/api/categories', async (req, res) => {
    const r = await pool.query('SELECT * FROM categories');
    res.json(r.rows);
});

app.get('/api/colors', async (req, res) => {
    const r = await pool.query('SELECT * FROM colors');
    res.json(r.rows);
});

app.get('/api/accounts', async (req, res) => {
    const userId = req.query.userId;
    const r = await pool.query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY account_name', [userId]);
    res.json(r.rows);
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor.`));
