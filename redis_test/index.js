const redis = require('redis');
const REDIS_PORT = 6379
const REDIS_URL = "redis-test.i187of.ng.0001.use1.cache.amazonaws.com"

const redis_client = redis.createClient(REDIS_PORT,REDIS_URL);

// Redis
redis_client.on("error", (err) => {
  console.error(err);
});

redis_client.on("ready", ()=> {
  console.log("Redis is Ready");
});