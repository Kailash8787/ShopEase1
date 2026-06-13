const Database = require('better-sqlite3');
const db = new Database('shop.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    password TEXT,
    email TEXT,
    role TEXT,
    balance REAL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT,
    price REAL,
    category TEXT,
    stock INTEGER,
    emoji TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    productId INTEGER,
    quantity INTEGER,
    total REAL,
    status TEXT,
    date TEXT,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER,
    author TEXT,
    text TEXT,
    rating INTEGER,
    date TEXT
  );
`);

const insertUser = db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)');
insertUser.run(1,'alice','alice123','alice@shopease.com','user',500);
insertUser.run(2,'bob','bob12345','bob@shopease.com','user',200);
insertUser.run(3,'carol','carol9999','carol@shopease.com','user',750);
insertUser.run(4,'admin','shopAdmin@99','admin@shopease.com','admin',0);

const insertProduct = db.prepare('INSERT OR IGNORE INTO products VALUES (?,?,?,?,?,?,?)');
insertProduct.run(1,'Wireless Headphones',59.99,'Electronics',40,'🎧','Premium sound with active noise cancellation and 30-hour battery life.');
insertProduct.run(2,'Running Shoes',89.99,'Footwear',25,'👟','Lightweight mesh upper with responsive cushioning for daily training.');
insertProduct.run(3,'Coffee Maker',39.99,'Kitchen',60,'☕','12-cup programmable brewer with keep-warm plate and auto shut-off.');
insertProduct.run(4,'Yoga Mat',24.99,'Sports',80,'🧘','6mm thick non-slip mat with alignment lines, eco-friendly TPE.');
insertProduct.run(5,'Desk Lamp',19.99,'Home',55,'💡','LED lamp with 3 colour temperatures and touch-dimmer control.');
insertProduct.run(6,'Travel Backpack',49.99,'Bags',35,'🎒','30L waterproof backpack with laptop sleeve and hidden pockets.');

const insertOrder = db.prepare('INSERT OR IGNORE INTO orders VALUES (?,?,?,?,?,?,?,?)');
insertOrder.run(1,1,1,1,59.99,'delivered','2026-03-10',null);
insertOrder.run(2,2,3,2,79.98,'shipped','2026-03-14',null);
insertOrder.run(3,3,2,1,89.99,'pending','2026-03-16',null);

const insertReview = db.prepare('INSERT OR IGNORE INTO reviews VALUES (?,?,?,?,?,?)');
insertReview.run(1,1,'Alice','Absolutely love these headphones — crystal clear sound!',5,'2026-03-12');
insertReview.run(2,1,'Bob','Great value for the price. Would buy again.',4,'2026-03-13');

console.log('✅ SQLite database ready');
module.exports = db;