//require을 통해 node_modules에 있는 express를 가져올 수 있다.
const express = require("express");

//express의 반환값을 저장한다.
const app = express();

const redis = require('redis');
const redisInfo = {
  host : 'redis-test.i187of.ng.0001.use1.cache.amazonaws.com',
  port : 6379
}
const client = redis.createClient(redisInfo);

client.on("error", function (err) {
    console.log("Error " + err);
});

client.on("ready", ()=> {
  console.log("Redis is Ready");
});

client.set("hello", "Node.js");

client.get("hello", function(err, val) {
  console.log(val);
  client.quit();
});


app.get("/", (req, res) => {
  res.send("Test");
});

//3000번 포트로 서버를 오픈한다.
app.listen(3000, () => {
  console.log("Sever On");
})