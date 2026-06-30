const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });
redis.flushall().then(() => {
    console.log('Redis tozalab tashlandi! Eski navbatlar o\'chirildi.');
    process.exit(0);
}).catch(console.error);
