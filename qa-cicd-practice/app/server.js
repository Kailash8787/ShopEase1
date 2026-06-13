'use strict';
const { createApp } = require('./index');
const PORT = process.env.PORT || 3000;
const app = createApp();
app.listen(PORT, () => console.log(`E-Commerce API running → http://localhost:${PORT}`));


//server