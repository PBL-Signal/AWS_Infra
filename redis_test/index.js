//const redis = require('redis');
const REDIS_PORT = 6379
const REDIS_URL = "redis-test.i187of.ng.0001.use1.cache.amazonaws.com"

//const redis_client = redis.createClient(REDIS_PORT,REDIS_URL);

// Redis
/*
redis_client.on("error", (err) => {
  console.error(err);
});

redis_client.on("ready", ()=> {
  console.log("Redis is Ready");
});

const set_cache = ( key, value ) => {
  redis_client.set( key, value );
  console.log('Redis set Data',key);
}

set_cache("test", "mini");
*/


const httpServer = require("http").createServer();
const Redis = require("ioredis");
const redisClient = new Redis(REDIS_PORT, REDIS_URL);
const io = require("socket.io")(httpServer, {
  cors: {
    origin: "http://localhost:8080",
  },
  adapter: require("socket.io-redis")({
    pubClient: redisClient,
    subClient: redisClient.duplicate(),
  }),
});

const { setupWorker } = require("@socket.io/sticky");

// Redis test 
redisClient.set("test","userID1234");

setupWorker(io);
